import { getCollectionById, setCollectionArticles } from "@/lib/collections"

export const runtime = "nodejs"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const collection = await getCollectionById(id)
    if (!collection) {
      return Response.json({ error: "合集不存在" }, { status: 404 })
    }
    return Response.json(collection)
  } catch (error) {
    const msg = error instanceof Error ? error.message : "未知错误"
    return Response.json({ error: msg }, { status: 500 })
  }
}

interface ReorderRequest {
  articleIds: string[]
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body: ReorderRequest = await request.json()
    const articleIds = Array.isArray(body.articleIds) ? body.articleIds : []
    await setCollectionArticles(id, articleIds)
    const collection = await getCollectionById(id)
    return Response.json(collection)
  } catch (error) {
    const msg = error instanceof Error ? error.message : "未知错误"
    return Response.json({ error: msg }, { status: 500 })
  }
}
