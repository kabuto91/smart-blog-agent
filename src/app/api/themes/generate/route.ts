import { randomUUID } from "crypto"
import type { BaseMessage, AIMessageChunk } from "@langchain/core/messages"
import { addMessage, getLatestSnapshot } from "@/lib/theme/theme-session"
import { getThemeCheckpointer } from "@/lib/theme/checkpoint"
import { getSiteConfig, getUserProfile } from "@/lib/site-config"
import { getUpload } from "@/lib/uploads"
import { analyzeImage } from "@/lib/llm/vision-analyze"
import { isVisionConfigured } from "@/lib/llm/vision-client"
import {
  createThemeGraph,
  type ThemeGraphInput,
} from "@/agents/theme-graph"
import { createSSEStream, SSE_HEADERS } from "@/lib/stream/sse"

export const runtime = "nodejs"

interface GenerateRequest {
  conversationId?: string
  message: string
  targetPage?: "skeleton" | "home" | "list" | "detail"
  imageId?: string
  fastMode?: boolean
  /** 断点续生：resume=true 时携带首次生成下发的 runId，从检查点继续。 */
  runId?: string
  resume?: boolean
}

const PAGE_TYPES = ["home", "list", "detail"] as const

/** 把 graph 节点名映射为前端 text/tool 事件使用的 page 键。 */
const NODE_TO_PAGE: Record<string, string> = {
  skeleton: "skeleton",
  page_home: "home",
  page_list: "list",
  page_detail: "detail",
}

/**
 * 正在执行的 runId 集合（进程内）：防止客户端断线后服务端仍在跑时，
 * 用户点"继续生成"造成同一检查点双跑。
 */
const activeRuns = new Set<string>()

export async function POST(request: Request) {
  let body: GenerateRequest
  try {
    body = (await request.json()) as GenerateRequest
  } catch {
    return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 })
  }

  const {
    conversationId: providedId,
    message,
    targetPage,
    imageId,
    fastMode,
    runId,
    resume,
  } = body
  const resumeRun = Boolean(resume && runId)
  if (!resumeRun && !message?.trim()) {
    return Response.json({ error: "请输入消息内容" }, { status: 400 })
  }

  try {
    // ── 新生成：图片分析、用户消息落库、读取快照构建 input；resume 全部跳过（原始 input 已在检查点里）──
    let finalMessage = message ?? ""
    let visionSkipped = false
    const conversationId = providedId || randomUUID()
    let input: ThemeGraphInput | null = null

    if (!resumeRun) {
      if (imageId) {
        const upload = await getUpload(imageId)
        if (upload) {
          if (!(await isVisionConfigured())) {
            visionSkipped = true
            finalMessage =
              "[未配置视觉模型，已忽略所选参考图片的视觉分析]\n[用户需求]\n" +
              message
          } else {
            try {
              const analysis = await analyzeImage(upload.data, upload.mimeType)
              finalMessage = `[图片分析结果]\n${analysis}\n\n[用户需求]\n${message}`
            } catch {
              // 如果视觉模型配置有问题，忽略图片分析，仅使用用户消息
            }
          }
        }
      }

      await addMessage(conversationId, "user", finalMessage)

      const snapshot = await getLatestSnapshot(conversationId)
      const siteConfig = await getSiteConfig()
      const { profile, enabled } = await getUserProfile()

      // 迭代模式：已有骨架，仅重生成目标页面；否则走完整流程（骨架会读取 prevLayout 保持风格）。
      const iteration = Boolean(
        snapshot?.layout && targetPage && targetPage !== "skeleton"
      )
      input = {
        userRequest: finalMessage,
        conversationId,
        iteration,
        targetPage: targetPage ?? "skeleton",
        layoutHtml: snapshot?.layout ?? "",
        prevLayout: snapshot?.layout ?? "",
        pages: snapshot?.pages ?? {},
        siteConfig,
        userProfile: enabled ? profile : "",
      }
    }

    const stream = createSSEStream(async ({ send, close }) => {
      if (visionSkipped) {
        send({
          type: "warn",
          message: "未配置视觉模型，已忽略所选参考图片的视觉分析",
        })
      }
      // 检查点持久化到 SQLite：进程重启/断线后仍可按 thread_id 恢复。
      const checkpointer = getThemeCheckpointer()
      const graph = await createThemeGraph({
        checkpointer,
        emitter: {
          stage: (stage, label, status, detail) =>
            send({ type: "stage", stage, label, status, detail }),
          tool: (page, name, args) =>
            send({ type: "tool_call", page, name, args }),
          warn: (warnMessage) => send({ type: "warn", message: warnMessage }),
          metrics: (metrics) => send({ type: "metrics", metrics }),
        },
        // 快速模式：跳过 AI 质量评审、修订上限 1 轮；质量优先走完整流程。
        // resume 时前端需回传与首次生成一致的 fastMode（影响图路由结构）。
        judgeEnabled: !fastMode,
        maxAttempts: fastMode ? 1 : 2,
      })

      // 新生成用新 runId 并下发给前端持久化；resume 复用原 runId 作为 thread_id。
      const threadId = resumeRun ? runId! : randomUUID()
      if (!resumeRun)
        send({ type: "run", runId: threadId, conversationId })

      if (activeRuns.has(threadId)) {
        send({
          type: "error",
          error: "本次生成仍在后台执行中，请稍候再刷新查看结果",
        })
        close()
        return
      }
      activeRuns.add(threadId)

      try {
        if (resumeRun) {
          let hasProgress = false
          try {
            const st = await graph.getState({
              configurable: { thread_id: threadId },
            })
            hasProgress =
              (st?.next?.length ?? 0) > 0 || Boolean(st?.values?.layoutHtml)
          } catch {
            hasProgress = false
          }
          if (!hasProgress) {
            send({
              type: "error",
              error: "无法恢复本次生成（检查点不存在或已过期），请重新生成",
              fatal: true,
            })
            close()
            return
          }
          send({ type: "warn", message: "从断点继续生成，已完成的步骤不会重跑" })
        }

        // resume：input 传 null，LangGraph 从最后检查点继续（只重跑失败/未执行的节点）。
        // durability=sync：每个 superstep 同步落盘，保证断线后已完成页面不重跑。
        const iterable = await graph.stream(
          (resumeRun ? null : input) as ThemeGraphInput,
          {
            streamMode: "messages",
            durability: "sync",
            configurable: { thread_id: threadId },
          }
        )

        for await (const event of iterable) {
          const [chunk, metadata] = event as [
            BaseMessage,
            { langgraph_node?: string },
          ]
          if (chunk._getType() !== "ai") continue
          const page = NODE_TO_PAGE[metadata?.langgraph_node ?? ""]
          if (!page) continue

          const aiChunk = chunk as AIMessageChunk
          const content = aiChunk.content

          const sendText = (text: string) =>
            send({ type: "text", page, content: text })

          if (typeof content === "string" && content) {
            sendText(content)
          } else if (Array.isArray(content)) {
            for (const block of content as { type?: string; text?: string }[]) {
              if (block.type === "text" && block.text) sendText(block.text)
            }
          }

          if (aiChunk.tool_calls?.length) {
            for (const tc of aiChunk.tool_calls) {
              send({ type: "tool_call", page, name: tc.name, args: tc.args })
            }
          }
        }

        const finalState = await graph.getState({
          configurable: { thread_id: threadId },
        })
        const values = finalState.values as {
          conversationId?: string
          layoutHtml?: string
          contentConfig?: string
          pages?: Record<string, string>
          pageConfigs?: Record<string, string>
        }
        // resume 时前端可能没拿到首次生成的 conversationId，以检查点里的为准。
        const finalConversationId = values.conversationId || conversationId

        for (const t of PAGE_TYPES) {
          send({
            type: "page",
            conversationId: finalConversationId,
            page: {
              type: t,
              html: values.pages?.[t] ?? "",
              contentConfig: values.pageConfigs?.[t] ?? "{}",
            },
          })
        }

        send({
          type: "done",
          conversationId: finalConversationId,
          layoutHtml: values.layoutHtml ?? "",
          contentConfig: values.contentConfig ?? "{}",
        })

        // 成功收尾后检查点不再需要，清理避免膨胀；失败路径保留供 resume。
        await checkpointer.deleteThread(threadId).catch(() => {})
        close()
      } finally {
        activeRuns.delete(threadId)
      }
    })

    return new Response(stream, { headers: SSE_HEADERS })
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误"
    return Response.json({ error: message }, { status: 500 })
  }
}