import { adjustArticleLike } from "@/lib/article-stats"

export const runtime = "nodejs"

interface LikeRequest {
  action?: "like" | "unlike"
}

/** 点赞/取消点赞：切换文章点赞数，并同步站点总点赞数。 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    let body: LikeRequest = {}
    try {
      body = await request.json()
    } catch {
      // 无 body / 非 JSON 时按点赞处理
    }
    const action = body.action === "unlike" ? "unlike" : "like"
    const likeCount = await adjustArticleLike(id, action)
    return Response.json({ id, likeCount })
  } catch (error) {
    const msg = error instanceof Error ? error.message : "未知错误"
    if (msg === "文章不存在") {
      return Response.json({ error: msg }, { status: 404 })
    }
    return Response.json({ error: msg }, { status: 500 })
  }
}