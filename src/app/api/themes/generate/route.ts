import { randomUUID } from "crypto"
import type { BaseMessage, AIMessageChunk } from "@langchain/core/messages"
import { addMessage, getLatestSnapshot } from "@/lib/theme/theme-session"
import { getSiteConfig } from "@/lib/site-config"
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
}

const PAGE_TYPES = ["home", "list", "detail"] as const

/** 把 graph 节点名映射为前端 text/tool 事件使用的 page 键。 */
const NODE_TO_PAGE: Record<string, string> = {
  skeleton: "skeleton",
  page_home: "home",
  page_list: "list",
  page_detail: "detail",
}

export async function POST(request: Request) {
  let body: GenerateRequest
  try {
    body = (await request.json()) as GenerateRequest
  } catch {
    return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 })
  }

  const { conversationId: providedId, message, targetPage, imageId, fastMode } = body
  if (!message?.trim()) {
    return Response.json({ error: "请输入消息内容" }, { status: 400 })
  }

  try {
    let finalMessage = message
    let visionSkipped = false

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

    const conversationId = providedId || randomUUID()
    await addMessage(conversationId, "user", finalMessage)

    const snapshot = await getLatestSnapshot(conversationId)
    const siteConfig = await getSiteConfig()

    // 迭代模式：已有骨架，仅重生成目标页面；否则走完整流程（骨架会读取 prevLayout 保持风格）。
    const iteration = Boolean(
      snapshot?.layout && targetPage && targetPage !== "skeleton"
    )
    const input: ThemeGraphInput = {
      userRequest: finalMessage,
      conversationId,
      iteration,
      targetPage: targetPage ?? "skeleton",
      layoutHtml: snapshot?.layout ?? "",
      prevLayout: snapshot?.layout ?? "",
      pages: snapshot?.pages ?? {},
      siteConfig,
    }

    const stream = createSSEStream(async ({ send, close }) => {
      if (visionSkipped) {
        send({
          type: "warn",
          message: "未配置视觉模型，已忽略所选参考图片的视觉分析",
        })
      }
      const graph = await createThemeGraph({
        emitter: {
          stage: (stage, label, status, detail) =>
            send({ type: "stage", stage, label, status, detail }),
          tool: (page, name, args) =>
            send({ type: "tool_call", page, name, args }),
          warn: (warnMessage) => send({ type: "warn", message: warnMessage }),
          metrics: (metrics) => send({ type: "metrics", metrics }),
        },
        // 快速模式：跳过 AI 质量评审、修订上限 1 轮；质量优先走完整流程。
        judgeEnabled: !fastMode,
        maxAttempts: fastMode ? 1 : 2,
      })

      // 每次生成用独立 thread_id，避免 checkpointer 复用上次执行状态。
      const threadId = randomUUID()
      const iterable = await graph.stream(input, {
        streamMode: "messages",
        configurable: { thread_id: threadId },
      })

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
        layoutHtml?: string
        contentConfig?: string
        pages?: Record<string, string>
        pageConfigs?: Record<string, string>
      }

      for (const t of PAGE_TYPES) {
        send({
          type: "page",
          conversationId,
          page: {
            type: t,
            html: values.pages?.[t] ?? "",
            contentConfig: values.pageConfigs?.[t] ?? "{}",
          },
        })
      }

      send({
        type: "done",
        conversationId,
        layoutHtml: values.layoutHtml ?? "",
        contentConfig: values.contentConfig ?? "{}",
      })

      close()
    })

    return new Response(stream, { headers: SSE_HEADERS })
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误"
    return Response.json({ error: message }, { status: 500 })
  }
}