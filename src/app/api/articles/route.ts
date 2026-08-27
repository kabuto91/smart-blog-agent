import {
  getArticles,
  createArticle,
  isUniqueError,
} from "@/lib/articles"

export const runtime = "nodejs"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const articles = await getArticles({
      categorySlug: searchParams.get("category") || undefined,
      tagSlug: searchParams.get("tag") || undefined,
      search: searchParams.get("search") || undefined,
      publishedOnly: searchParams.get("published") === "true",
    })
    return Response.json(articles)
  } catch (error) {
    const msg = error instanceof Error ? error.message : "未知错误"
    return Response.json({ error: msg }, { status: 500 })
  }
}

interface CreateRequest {
  title: string
  slug: string
  content: string
  excerpt?: string
  coverImage?: string | null
  published?: boolean
  categoryId?: string | null
  tagIds?: string[]
}

export async function POST(request: Request) {
  try {
    const body: CreateRequest = await request.json()
    if (!body.title?.trim() || !body.slug?.trim()) {
      return Response.json({ error: "标题和 slug 是必填项" }, { status: 400 })
    }
    const article = await createArticle({
      title: body.title.trim(),
      slug: body.slug.trim(),
      content: body.content ?? "",
      excerpt: body.excerpt,
      coverImage: body.coverImage,
      published: body.published,
      categoryId: body.categoryId,
      tagIds: body.tagIds,
    })
    return Response.json(article, { status: 201 })
  } catch (error) {
    if (isUniqueError(error)) {
      return Response.json({ error: "slug 已存在，请更换" }, { status: 409 })
    }
    const msg = error instanceof Error ? error.message : "未知错误"
    return Response.json({ error: msg }, { status: 500 })
  }
}
