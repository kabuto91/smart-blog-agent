import { HumanMessage, AIMessage } from "@langchain/core/messages"
import type { BaseMessage, AIMessageChunk } from "@langchain/core/messages"
import { getMessages, addMessage, getLatestHtml } from "@/lib/theme/theme-session"
import { extractContentConfig } from "@/lib/theme/content-extractor"
import { ensureAvatarOverflow } from "@/lib/theme/content-renderer"
import { splitGeneratedTheme } from "@/lib/theme/theme-splitter"
import { getSiteConfig } from "@/lib/site-config"
import { createThemeAgent, extractHtmlFromContent } from "@/agents/theme-agent"
import { randomUUID } from "crypto"

export const runtime = "nodejs"

interface GenerateRequest {
  conversationId?: string
  message: string
}

export async function POST(request: Request) {
  try {
    const { conversationId: providedId, message } = (await request.json()) as GenerateRequest

    if (!message?.trim()) {
      return Response.json({ error: "请输入消息内容" }, { status: 400 })
    }

    const conversationId = providedId || randomUUID()

    // Save user message
    await addMessage(conversationId, "user", message)

    // Load history messages
    const historyMessages = await getMessages(conversationId)

    // Get latest HTML for context
    const latestHtml = await getLatestHtml(conversationId)

    // Build LLM messages (the theme agent injects its own system prompt)
    const llmMessages: (HumanMessage | AIMessage)[] = []

    // Add history (skip the just-added user message)
    const historyForLlm = historyMessages.slice(0, -1)
    for (const msg of historyForLlm) {
      if (msg.role === "user") {
        llmMessages.push(new HumanMessage(msg.content))
      } else if (msg.role === "assistant") {
        // Include HTML context in assistant messages
        const content = msg.htmlSnapshot
          ? `${msg.content}\n\n之前生成的 HTML：\n\`\`\`html\n${msg.htmlSnapshot}\n\`\`\``
          : msg.content
        llmMessages.push(new AIMessage(content))
      }
    }

    // Add current user message with HTML context if exists
    let currentMessage = message
    if (latestHtml) {
      currentMessage = `${message}\n\n当前页面的 HTML：\n\`\`\`html\n${latestHtml}\n\`\`\``
    }
    llmMessages.push(new HumanMessage(currentMessage))

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
              // Send each chunk to the client
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

          // Extract content config from generated HTML (match against site config)
          let contentConfigJson = ""
          let layoutHtml = ""
          let pages: { type: string; html: string }[] = []
          if (html) {
            const siteConfig = await getSiteConfig()
            const result = extractContentConfig(html, siteConfig)
            const normalizedHtml = ensureAvatarOverflow(result.htmlTemplate)
            const split = splitGeneratedTheme(normalizedHtml)
            layoutHtml = split.layoutHtml
            pages = split.pages
            contentConfigJson = JSON.stringify(result.contentConfig)
          }

          // Save assistant message with HTML snapshot and content config
          await addMessage(conversationId, "assistant", fullContent, html, contentConfigJson)

          // Send completion signal with conversation ID, layout and page bodies
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "done", conversationId, layoutHtml, pages, contentConfig: contentConfigJson })}\n\n`)
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