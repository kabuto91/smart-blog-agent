import type { AIMessageChunk } from "@langchain/core/messages"
import { HumanMessage } from "@langchain/core/messages"
import { getActiveTheme } from "@/lib/theme/theme"
import { extractContentConfig } from "@/lib/theme/content-extractor"
import {
  ensureAvatarOverflow,
  renderContent,
} from "@/lib/theme/content-renderer"
import { mergeThemePage } from "@/lib/theme/theme-splitter"
import { getSiteConfig } from "@/lib/site-config"
import { extractHtmlFromContent } from "@/agents/theme-agent"
import { createLLM } from "@/lib/llm/client"
import type { ContentConfig } from "@/lib/types/content-config"
import { createSSEStream, SSE_HEADERS } from "@/lib/stream/sse"

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
  return `请为链接 ${url || "/"} 生成对应的页面内容区域（路径解析为「${name}」）。根据链接路径推断页面用途并设计合适的页面内容，用中文填充内容。

【重要】你只需要输出页面的正文内容 HTML，不要包含：
- 不要包含 <!DOCTYPE html>、<html>、<head>、<body> 标签
- 不要包含 <style> 标签或任何 CSS 样式定义
- 不要包含 <header>、<footer>、<nav> 等导航元素（这些由主题统一提供）

输出格式：
直接输出一个 <section> 或 <div> 包裹的内容区域，例如：
<section class="custom-page">
  <h1>页面标题</h1>
  <p>页面内容...</p>
</section>

要求：
1. 严格遵循下面当前主题 HTML 的视觉风格（配色、字体、排版、间距、背景质感、动效与微交互等），使新页面与主题融为一体。
2. 使用主题 HTML 中已有的 CSS 类名来保持视觉风格一致。
3. 可以使用 data-content 属性标记可编辑的文本区域。

当前主题 HTML 结构参考：
\`\`\`html
${themeHtml}
\`\`\``
}

export async function POST(request: Request) {
  let body: GenerateRequest
  try {
    body = (await request.json()) as GenerateRequest
  } catch {
    return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 })
  }

  const route = body.url?.trim()
  if (!route) {
    return Response.json({ error: "请输入链接" }, { status: 400 })
  }

  try {
    const theme = await getActiveTheme()
    if (!theme) {
      return Response.json({ error: "请先创建并启用一个主题" }, { status: 400 })
    }

    const prompt = buildPrompt(route, theme.layoutHtml)
    const llmMessages = [new HumanMessage(prompt)]

    const stream = createSSEStream(async ({ send, close }) => {
      const llm = await createLLM(true)

      let fullContent = ""
      for await (const chunk of await llm.stream(llmMessages)) {
        const aiChunk = chunk as AIMessageChunk
        const content = aiChunk.content

        const sendText = (text: string) => {
          fullContent += text
          send({ type: "text", content: text })
        }

        if (typeof content === "string" && content) {
          sendText(content)
        } else if (Array.isArray(content)) {
          for (const block of content as { type?: string; text?: string }[]) {
            if (block.type === "text" && block.text) sendText(block.text)
          }
        }

        if (aiChunk.tool_calls?.length) {
          for (const tc of aiChunk.tool_calls) {
            send({ type: "tool_call", name: tc.name, args: tc.args })
          }
        }
      }

      // 解析完整输出中的 HTML
      const html = extractHtmlFromContent(fullContent)

      if (!html) {
        console.error(
          "[pages/generate] 未能从模型输出提取 HTML。输出长度:",
          fullContent.length,
          "\n--- 输出尾部 ---\n",
          fullContent.slice(-3000)
        )
      }

      // 从生成的 HTML 提取内容配置（与站点配置匹配）
      let contentConfigJson = ""
      let previewHtml = ""
      let normalizedHtml = html
      if (html) {
        const siteConfig = await getSiteConfig()
        const result = extractContentConfig(html, siteConfig)
        normalizedHtml = ensureAvatarOverflow(result.htmlTemplate)
        contentConfigJson = JSON.stringify(result.contentConfig)

        try {
          const config = (JSON.parse(contentConfigJson) ?? {}) as ContentConfig
          const siteConfig = await getSiteConfig()
          const mergedHtml = mergeThemePage(theme.layoutHtml, normalizedHtml, {
            navClearance: true,
          })
          previewHtml = renderContent(mergedHtml, config, undefined, siteConfig, {
            pageSpecific: true,
          })
        } catch {
          // preview 构建失败时回退到原始生成 HTML
        }
      }

      send({
        type: "done",
        html: normalizedHtml,
        previewHtml,
        contentConfig: contentConfigJson,
      })
      close()
    })

    return new Response(stream, { headers: SSE_HEADERS })
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误"
    return Response.json({ error: message }, { status: 500 })
  }
}