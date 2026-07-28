import { createLLM } from "@/lib/llm"
import { HumanMessage, SystemMessage, AIMessage } from "@langchain/core/messages"
import { getMessages, addMessage, getLatestHtml } from "@/lib/theme-session"
import { randomUUID } from "crypto"
import type { AIMessageChunk } from "@langchain/core/messages"

export const runtime = "nodejs"

const SYSTEM_PROMPT = `你是一个专业的博客页面设计师。

工作模式：
- 首次生成：根据用户描述生成完整的 HTML 博客页面
- 迭代修改：基于之前的 HTML 和用户的修改意见进行调整，保留不需要修改的部分

输出格式要求（严格遵守）：
1. 先输出你的思考过程，每一步单独一行
2. 然后输出完整的 HTML 页面

思考过程格式示例：
正在分析用户需求...
识别到关键要求：极简风格、白色背景、左侧导航
正在设计页面配色方案...
正在构建 HTML 结构...

然后输出完整的 HTML 页面（包含 DOCTYPE、html、head、body）

HTML 要求：
1. 输出的必须是完整的 HTML 文件，包含 <!DOCTYPE html>、<html>、<head>、<body> 标签
2. 所有样式内联在 <style> 标签中，不依赖外部资源
3. 确保内容有基本的博客结构：标题、正文段落、侧边栏（如有）、页脚
4. 用中文内容填充占位文字
5. 样式要精致、现代，具有良好的排版和留白
6. 如果用户没有特别说明，默认生成一个简约风格的博客页面

直接输出内容，不要有任何额外的解释性文字。`

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

    // Build LLM messages
    const llmMessages: (SystemMessage | HumanMessage | AIMessage)[] = [
      new SystemMessage(SYSTEM_PROMPT),
    ]

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
          // Call LLM with streaming enabled
          const llm = createLLM(true)
          const streamIterable = await llm.stream(llmMessages)

          let fullContent = ""

          for await (const chunk of streamIterable) {
            const messageChunk = chunk as AIMessageChunk
            const content = messageChunk.content

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
          }

          // Parse the complete content to extract HTML
          const htmlMatch = fullContent.match(/<!DOCTYPE[\s\S]*$/i)
          const html = htmlMatch ? htmlMatch[0].trim() : ""

          // Save assistant message with HTML snapshot
          await addMessage(conversationId, "assistant", fullContent, html)

          // Send completion signal with conversation ID
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "done", conversationId, html })}\n\n`)
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
