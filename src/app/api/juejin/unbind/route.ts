import { updateJuejinArticleId } from "@/lib/articles"

export const runtime = "nodejs"

interface UnbindRequest {
  articleId: string
}

export async function POST(request: Request) {
  try {
    const body: UnbindRequest = await request.json()
    if (!body.articleId) {
      return Response.json({ error: "缺少 articleId" }, { status: 400 })
    }
    const ok = await updateJuejinArticleId(body.articleId, null)
    if (!ok) {
      return Response.json({ error: "文章不存在" }, { status: 404 })
    }
    return Response.json({ success: true, juejinArticleId: null })
  } catch (error) {
    const msg = error instanceof Error ? error.message : "未知错误"
    return Response.json({ error: msg }, { status: 500 })
  }
}
