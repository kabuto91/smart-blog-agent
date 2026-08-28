import {
  getFeaturedArticleIds,
  saveFeaturedArticleIds,
} from "@/lib/site-config"

export const runtime = "nodejs"

/** 读取精选文章 ID 列表。 */
export async function GET() {
  try {
    const ids = await getFeaturedArticleIds()
    return Response.json({ ids })
  } catch (error) {
    const msg = error instanceof Error ? error.message : "未知错误"
    return Response.json({ error: msg }, { status: 500 })
  }
}

interface PutRequest {
  ids?: string[]
}

/** 保存精选文章 ID 列表（按顺序）。 */
export async function PUT(request: Request) {
  try {
    const body: PutRequest = await request.json()
    const ids = Array.isArray(body.ids)
      ? body.ids.filter((x) => typeof x === "string")
      : []
    await saveFeaturedArticleIds(ids)
    return Response.json({ ids })
  } catch (error) {
    const msg = error instanceof Error ? error.message : "未知错误"
    return Response.json({ error: msg }, { status: 500 })
  }
}