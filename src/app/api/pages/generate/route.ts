import type { BaseMessage, AIMessageChunk } from "@langchain/core/messages"
import { HumanMessage } from "@langchain/core/messages"
import { getActiveTheme } from "@/lib/theme"
import { extractContentConfig } from "@/lib/content-extractor"
import {
  ensureAvatarOverflow,
  renderCustomPagePreview,
} from "@/lib/content-renderer"
import { buildCustomPageSection, insertCustomPageSection } from "@/lib/custom-pages"
import { getSiteConfig } from "@/lib/site-config"
import type { ContentConfig } from "@/lib/types/content-config"
import { createThemeAgent, extractHtmlFromContent } from "@/agents/theme-agent"

export const runtime = "nodejs"

interface GenerateRequest {
  url: string
}

function pageNameFromUrl(url: string): string {
  const clean = url.split("?")[0].replace(/\/+$/, "")
  const seg = clean.split("/").filter(Boolean).pop()
  if (seg) return `页面 ${seg}`
  return "自定义页面"
}

function buildPrompt(url: string, themeHtml: string): string {
  const name = pageNameFromUrl(url)
  return `请为链接 ${url || "/"} 生成对应的页面（路径解析为「${name}」）。根据链接路径推断页面用途并设计合适的页面内容，用中文填充内容。

要求：
1. 严格遵循下面当前主题 HTML 的视觉风格（配色、字体、排版、间距、背景质感、动效与微交互等），使新页面与主题融为一体，不要另起炉灶。
2. 只生成该页面独有的正文内容，不要重复生成导航（nav）、页脚（footer）和页头（header），这些会由主题统一提供。
3. 直接输出完整的 HTML 页面（包含 <!DOCTYPE html>、<head> 内联样式、<body> 内容）。

当前主题 HTML：
\`\`\`html
${themeHtml}
\`\`\``
}

export async function POST(request: Request) {
  try {
    const { url } = (await request.json()) as GenerateRequest
    const route = url?.trim()
    if (!route) {
      return Response.json({ error: "请输入链接" }, { status: 400 })
    }

    const theme = await getActiveTheme()
    if (!theme) {
      return Response.json({ error: "请先创建并启用一个主题" }, { status: 400 })
    }

    const prompt = buildPrompt(route, theme.html)
    const llmMessages = [new HumanMessage(prompt)]

    // Create streaming response
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder()

        try {
          const graph = await createThemeAgent()

          const streamIterable = await graph.stream(
            { messages: llmMessages },
            { streamMode: "messages" }
          )

          let fullContent = ""

          for await (const event of streamIterable) {
            const messageChunk = event[0] as BaseMessage

            if (messageChunk._getType() !== "ai") continue

            const aiChunk = messageChunk as AIMessageChunk
            const content = aiChunk.content

            if (typeof content === "string" && content) {
              fullContent += content
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: "text", content })}\n\n`)
              )
            } else if (Array.isArray(content)) {
              for (const block of content) {
                if (block.type === "text" && block.text) {
                  fullContent += block.text
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({ type: "text", content: block.text })}\n\n`)
                  )
                }
              }
            }

            if (aiChunk.tool_calls?.length) {
              for (const tc of aiChunk.tool_calls) {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ type: "tool_call", name: tc.name, args: tc.args })}\n\n`)
                )
              }
            }
          }

          // Parse the complete content to extract HTML
          const html = extractHtmlFromContent(fullContent)

          if (!html) {
            console.error(
              "[pages/generate] 未能从模型输出提取 HTML。输出长度:",
              fullContent.length,
              "\n--- 输出尾部 ---\n",
              fullContent.slice(-3000)
            )
          }

          // Extract content config from generated HTML (match against site config)
          let contentConfigJson = ""
          let previewHtml = ""
          let normalizedHtml = html
          if (html) {
            const siteConfig = await getSiteConfig()
            const result = extractContentConfig(html, siteConfig)
            normalizedHtml = ensureAvatarOverflow(result.htmlTemplate)
            contentConfigJson = JSON.stringify(result.contentConfig)

            try {
              const sectionHtml = buildCustomPageSection(route, normalizedHtml)
              const mergedHtml = insertCustomPageSection(
                theme.html,
                route,
                sectionHtml
              )
              const config = (JSON.parse(contentConfigJson) ?? {}) as ContentConfig
              previewHtml = renderCustomPagePreview(
                mergedHtml,
                route,
                config,
                siteConfig
              )
            } catch {
              // preview building failed, fall back to raw generated html
            }
          }

          // Send completion signal with generated HTML and content config
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "done", html: normalizedHtml, previewHtml, contentConfig: contentConfigJson })}\n\n`)
          )
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : "未知错误"
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "error", error: errorMsg })}\n\n`)
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
