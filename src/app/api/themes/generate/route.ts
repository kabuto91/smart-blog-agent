import type { BaseMessage, AIMessageChunk } from "@langchain/core/messages"
import { HumanMessage } from "@langchain/core/messages"
import {
  addMessage,
  getLatestSnapshot,
} from "@/lib/theme/theme-session"
import { extractContentConfig } from "@/lib/theme/content-extractor"
import { ensureAvatarOverflow } from "@/lib/theme/content-renderer"
import {
  sanitizePageFragment,
  ensureLayoutContract,
  collectThemeClasses,
  validatePageFragment,
} from "@/lib/theme/theme-splitter"
import { getSiteConfig } from "@/lib/site-config"
import {
  createSkeletonAgent,
  createPageAgent,
  buildPagePromptContext,
  extractHtmlFromContent,
  type ThemePageType,
} from "@/agents/theme-agent"
import { getUpload } from "@/lib/uploads"
import { analyzeImage } from "@/lib/llm/vision-analyze"
import { randomUUID } from "crypto"

export const runtime = "nodejs"

interface GenerateRequest {
  conversationId?: string
  message: string
  targetPage?: "skeleton" | ThemePageType
  imageId?: string
}

interface PageResult {
  type: ThemePageType
  html: string
  contentConfig: string
  /** 是否通过与骨架契约的一致性校验 */
  valid: boolean
}

const PAGE_TYPES: ThemePageType[] = ["home", "list", "detail"]

function pageHtmlLabel(pageType: ThemePageType): string {
  switch (pageType) {
    case "home":
      return "首页"
    case "list":
      return "文章列表页"
    case "detail":
      return "文章详情页"
  }
}

type AgentGraph = Awaited<ReturnType<typeof createSkeletonAgent>>

/** 流式运行一个 agent，把文本/工具事件转发到 SSE，并累计完整输出。 */
async function runAgentStream(
  graph: AgentGraph,
  messages: { role: "user" | "assistant"; content: string }[],
  page: "skeleton" | ThemePageType,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder
): Promise<{ content: string; html: string }> {
  const llmMessages = messages.map((m) =>
    m.role === "user"
      ? new HumanMessage(m.content)
      : new HumanMessage(m.content)
  )

  const iterable = await graph.stream(
    { messages: llmMessages },
    { streamMode: "messages" }
  )

  let fullContent = ""
  for await (const event of iterable) {
    const chunk = event[0] as BaseMessage
    if (chunk._getType() !== "ai") continue
    const aiChunk = chunk as AIMessageChunk
    const content = aiChunk.content

    const send = (text: string) => {
      fullContent += text
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ type: "text", page, content: text })}\n\n`
        )
      )
    }

    if (typeof content === "string" && content) {
      send(content)
    } else if (Array.isArray(content)) {
      for (const block of content as { type?: string; text?: string }[]) {
        if (block.type === "text" && block.text) send(block.text)
      }
    }

    if (aiChunk.tool_calls?.length) {
      for (const tc of aiChunk.tool_calls) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "tool_call", page, name: tc.name, args: tc.args })}\n\n`
          )
        )
      }
    }
  }

  const html = extractHtmlFromContent(fullContent)
  return { content: fullContent, html }
}

/** 把某页正文标准化：提取正文、防头像溢出，并生成其 contentConfig。 */
async function extractPageResult(
  pageType: ThemePageType,
  rawHtml: string,
  siteConfig: Record<string, string> | undefined,
  layoutClasses: Set<string>
): Promise<PageResult> {
  let html = extractHtmlFromContent(rawHtml)
  if (!html) html = rawHtml
  html = ensureAvatarOverflow(html)
  const result = extractContentConfig(html, siteConfig)
  const fragment = sanitizePageFragment(result.htmlTemplate)
  const issue = validatePageFragment(fragment, layoutClasses)
  return {
    type: pageType,
    html: fragment,
    contentConfig: JSON.stringify(result.contentConfig),
    valid: issue.ok,
  }
}

/** 运行单个页面 agent 并流式转发，返回该页结果；未通过契约校验时自动重试一次。 */
async function runPageAgent(
  pageType: ThemePageType,
  userMessage: string,
  context: string,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  siteConfig: Record<string, string> | undefined,
  layoutClasses: Set<string>
): Promise<PageResult> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const graph = await createPageAgent(pageType, context)
    const { html } = await runAgentStream(
      graph,
      [{ role: "user", content: userMessage }],
      pageType,
      controller,
      encoder
    )
    const result = await extractPageResult(pageType, html, siteConfig, layoutClasses)
    if (result.valid || attempt === 2) {
      if (!result.valid) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: "warn",
              message: `「${pageHtmlLabel(pageType)}」存在样式一致性风险，已尽力修复`,
            })}\n\n`
          )
        )
      }
      return result
    }
  }
  // 不可达
  return { type: pageType, html: "", contentConfig: "{}", valid: false }
}

export async function POST(request: Request) {
  try {
    const { conversationId: providedId, message, targetPage, imageId } =
      (await request.json()) as GenerateRequest

    if (!message?.trim()) {
      return Response.json({ error: "请输入消息内容" }, { status: 400 })
    }

    let finalMessage = message

    if (imageId) {
      const upload = await getUpload(imageId)
      if (upload) {
        try {
          const analysis = await analyzeImage(upload.data, upload.mimeType)
          finalMessage = `[图片分析结果]\n${analysis}\n\n[用户需求]\n${message}`
        } catch {
          // 如果视觉模型配置有问题，忽略图片分析，仅使用用户消息
        }
      }
    }

    const conversationId = providedId || randomUUID()
    await addMessage(conversationId, "user", finalMessage)

    const snapshot = await getLatestSnapshot(conversationId)
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder()

        try {
          const siteConfig = await getSiteConfig()

          // 迭代场景：已有骨架，仅重生成目标页面。
          if (snapshot?.layout && targetPage && targetPage !== "skeleton") {
            const pageType = targetPage
            const contractedLayout = ensureLayoutContract(snapshot.layout)
            const context = buildPagePromptContext(contractedLayout)
            const layoutClasses = collectThemeClasses(contractedLayout)
            const prev = snapshot.pages[pageType]
            const userMessage = prev
              ? `${finalMessage}\n\n当前「${pageHtmlLabel(pageType)}」正文状态：\n\`\`\`html\n${prev}\n\`\`\``
              : finalMessage

            const result = await runPageAgent(
              pageType,
              userMessage,
              context,
              controller,
              encoder,
              siteConfig,
              layoutClasses
            )

            const nextPages: Record<string, string> = {
              ...snapshot.pages,
              [pageType]: result.html,
            }
            const layoutForMerge = ensureAvatarOverflow(contractedLayout)
            // 迭代只改页面正文，布局（含导航）未变：重新从布局提取配置，
            // 避免把导航/布局配置整体丢弃为 {}
            const layoutConfigJson = JSON.stringify(
              extractContentConfig(contractedLayout, siteConfig).contentConfig
            )
            await addMessage(
              conversationId,
              "assistant",
              userMessage,
              layoutForMerge,
              layoutConfigJson,
              JSON.stringify(nextPages)
            )

            for (const t of PAGE_TYPES) {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    type: "page",
                    conversationId,
                    page: {
                      type: t,
                      html: nextPages[t] ?? "",
                      contentConfig: t === pageType ? result.contentConfig : "{}",
                    },
                  })}\n\n`
                )
              )
            }

            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: "done",
                  conversationId,
                  layoutHtml: layoutForMerge,
                  contentConfig: layoutConfigJson,
                })}\n\n`
              )
            )
            return
          }

          // ---------- 骨架阶段 ----------
          const skeletonGraph = await createSkeletonAgent()
          const skeletonInput = [
            { role: "user" as const, content: finalMessage },
            ...(snapshot?.layout
              ? [
                  {
                    role: "assistant" as const,
                    content: `之前的骨架：\n\`\`\`html\n${snapshot.layout}\n\`\`\``,
                  },
                ]
              : []),
          ]
          const skeletonOut = await runAgentStream(
            skeletonGraph,
            skeletonInput,
            "skeleton",
            controller,
            encoder
          )
          if (!skeletonOut.html) {
            throw new Error("骨架生成失败：未能提取 HTML")
          }
          const layoutHtml = ensureAvatarOverflow(
            ensureLayoutContract(skeletonOut.html)
          )
          const layoutClasses = collectThemeClasses(layoutHtml)

          // 提取骨架的 contentConfig（包含导航栏配置）
          const skeletonConfig = extractContentConfig(layoutHtml, siteConfig)
          const skeletonContentConfig = JSON.stringify(skeletonConfig.contentConfig)

          // ---------- 并行页面阶段 ----------
          const bodyContext = buildPagePromptContext(layoutHtml)
          const pages = await Promise.all(
            PAGE_TYPES.map((pt) =>
              runPageAgent(
                pt,
                finalMessage,
                bodyContext,
                controller,
                encoder,
                siteConfig,
                layoutClasses
              )
            )
          )

          const pageMap: Record<string, string> = {}
          const pageConfigMap: Record<string, string> = {}
          for (const p of pages) {
            pageMap[p.type] = p.html
            pageConfigMap[p.type] = p.contentConfig
          }

          await addMessage(
            conversationId,
            "assistant",
            "已生成主题骨架与三个页面",
            layoutHtml,
            skeletonContentConfig,
            JSON.stringify(pageMap)
          )

          for (const t of PAGE_TYPES) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: "page",
                  conversationId,
                  page: {
                    type: t,
                    html: pageMap[t] ?? "",
                    contentConfig: pageConfigMap[t] ?? "{}",
                  },
                })}\n\n`
              )
            )
          }

          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: "done",
                conversationId,
                layoutHtml,
                contentConfig: skeletonContentConfig,
              })}\n\n`
            )
          )
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : "未知错误"
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "error", error: errorMsg })}\n\n`
            )
          )
        } finally {
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : "未知错误"
    return Response.json({ error: msg }, { status: 500 })
  }
}