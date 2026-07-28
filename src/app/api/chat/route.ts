import { createBlogAgent } from "@/agents/blog-agent"
import { HumanMessage } from "@langchain/core/messages"
import type { AIMessageChunk } from "@langchain/core/messages"

export const runtime = "nodejs"

interface ChatRequest {
  message: string
  conversationId?: string
}

export async function POST(request: Request) {
  try {
    const { message, conversationId = "default" } = (await request.json()) as ChatRequest

    if (!message) {
      return Response.json({ error: "消息不能为空" }, { status: 400 })
    }

    const agent = createBlogAgent(conversationId)

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder()

        try {
          const streamIterable = await agent.stream(
            { messages: [new HumanMessage(message)] },
            { configurable: { thread_id: conversationId }, streamMode: "messages" }
          )

          for await (const event of streamIterable) {
            const messageChunk = event[0] as AIMessageChunk

            const content = messageChunk.content
            if (typeof content === "string" && content) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "text", content })}\n\n`))
            }

            if ("tool_calls" in messageChunk && messageChunk.tool_calls?.length) {
              for (const tc of messageChunk.tool_calls) {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ type: "tool_call", name: tc.name, args: tc.args })}\n\n`)
                )
              }
            }
          }

          controller.enqueue(encoder.encode("data: [DONE]\n\n"))
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : "未知错误"
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", error: errorMsg })}\n\n`))
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
