import { updateJuejinArticleId } from "@/lib/articles"

export const runtime = "nodejs"

interface BindRequest {
  articleId: string
  /** 掘金文章 post id，或完整掘金文章链接（会自动提取 id）。 */
  juejinArticleId: string
}

/** 从掘金文章链接中提取 post id，例如 https://juejin.cn/post/123456 或 /spost/123456。 */
function extractPostId(input: string): string {
  const trimmed = input.trim()
  const m = trimmed.match(/\/(?:post|spost)\/(\d+)/)
  if (m) return m[1]
  if (/^\d+$/.test(trimmed)) return trimmed
  return ""
}

export async function POST(request: Request) {
  try {
    const body: BindRequest = await request.json()
    if (!body.articleId) {
      return Response.json({ error: "缺少 articleId" }, { status: 400 })
    }
    const postId = extractPostId(body.juejinArticleId || "")
    if (!postId) {
      return Response.json(
        { error: "请提供有效的掘金文章链接或文章 id（如 https://juejin.cn/post/123456）" },
        { status: 400 }
      )
    }
    const ok = await updateJuejinArticleId(body.articleId, postId)
    if (!ok) {
      return Response.json({ error: "文章不存在" }, { status: 404 })
    }
    return Response.json({ success: true, juejinArticleId: postId })
  } catch (error) {
    const msg = error instanceof Error ? error.message : "未知错误"
    return Response.json({ error: msg }, { status: 500 })
  }
}
