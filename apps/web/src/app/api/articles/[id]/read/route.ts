import { bumpArticleRead } from "@smart-blog/core/lib/article-stats"

export const runtime = "nodejs"

export const dynamic = "force-dynamic"

/** 阅读量 +1：由详情页客户端脚本调用，返回最新阅读数与点赞数。 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const counts = await bumpArticleRead(id)
    return Response.json({ id, ...counts })
  } catch (error) {
    const msg = error instanceof Error ? error.message : "未知错误"
    return Response.json({ error: msg }, { status: 500 })
  }
}
