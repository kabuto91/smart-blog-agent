import type { AIMessageChunk } from "@langchain/core/messages"
import {
  buildArticleMessages,
  type ArticleGenMode,
} from "@/agents/article-agent"
import { createLLM } from "@/lib/llm/client"
import { createSSEStream, SSE_HEADERS } from "@/lib/stream/sse"

export const runtime = "nodejs"

interface GenerateArticleRequest {
  title?: string
  excerpt?: string
  content?: string
  instruction?: string
  mode?: ArticleGenMode
  includeMeta?: boolean
}

export async function POST(request: Request) {
  let body: GenerateArticleRequest
  try {
    body = (await request.json()) as GenerateArticleRequest
  } catch {
    return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 })
  }

  const title = (body.title ?? "").trim()
  const instruction = (body.instruction ?? "").trim()
  if (!title && !instruction) {
    return Response.json(
      { error: "请填写文章标题或写作要求" },
      { status: 400 }
    )
  }
  const mode: ArticleGenMode = body.mode === "generate" ? "generate" : "continue"

  const stream = createSSEStream(async ({ send, close }) => {
    const llm = await createLLM(true)
    const messages = buildArticleMessages({
      title,
      excerpt: body.excerpt,
      content: body.content,
      instruction,
      mode,
      includeMeta: body.includeMeta,
    })

    for await (const chunk of await llm.stream(messages)) {
      const aiChunk = chunk as AIMessageChunk
      const content = aiChunk.content

      if (typeof content === "string" && content) {
        send({ type: "text", content })
      } else if (Array.isArray(content)) {
        for (const block of content as { type?: string; text?: string }[]) {
          if (block.type === "text" && block.text) {
            send({ type: "text", content: block.text })
          }
        }
      }
    }

    send({ type: "done" })
    close()
  })

  return new Response(stream, { headers: SSE_HEADERS })
}
