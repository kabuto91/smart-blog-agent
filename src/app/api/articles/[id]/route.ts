import { getArticleById, updateArticle, deleteArticle, isUniqueError } from "@/lib/articles"

export const runtime = "nodejs"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const article = await getArticleById(id)
    if (!article) {
      return Response.json({ error: "文章不存在" }, { status: 404 })
    }
    return Response.json(article)
  } catch (error) {
    const msg = error instanceof Error ? error.message : "未知错误"
    return Response.json({ error: msg }, { status: 500 })
  }
}

interface PatchRequest {
  title?: string
  slug?: string
  content?: string
  excerpt?: string
  coverImage?: string | null
  published?: boolean
  categoryId?: string | null
  tagIds?: string[]
  collectionIds?: string[]
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body: PatchRequest = await request.json()
    const article = await updateArticle(id, {
      title: body.title,
      slug: body.slug,
      content: body.content,
      excerpt: body.excerpt,
      coverImage: body.coverImage,
      published: body.published,
      categoryId: body.categoryId,
      tagIds: body.tagIds,
      collectionIds: body.collectionIds,
    })
    if (!article) {
      return Response.json({ error: "文章不存在" }, { status: 404 })
    }
    return Response.json(article)
  } catch (error) {
    if (isUniqueError(error)) {
      return Response.json({ error: "slug 已存在，请更换" }, { status: 409 })
    }
    const msg = error instanceof Error ? error.message : "未知错误"
    return Response.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    await deleteArticle(id)
    return new Response(null, { status: 204 })
  } catch (error) {
    const msg = error instanceof Error ? error.message : "未知错误"
    return Response.json({ error: msg }, { status: 500 })
  }
}
