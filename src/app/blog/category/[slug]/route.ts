import { getArticlesPage, getCategories, getTags } from "@/lib/articles"
import {
  toArticleData,
  toCategoryData,
  toTagData,
  renderBlogTheme,
  renderCustomThemePage,
  BLOG_PAGE_SIZE,
  blogNotFoundHtml,
} from "@/lib/blog"

export const runtime = "nodejs"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params

  const customHtml = await renderCustomThemePage(`/blog/category/${slug}`)
  if (customHtml) {
    return new Response(customHtml, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    })
  }

  const { searchParams } = new URL(request.url)
  const page = Number(searchParams.get("page")) || 1

  const [result, categories, tags] = await Promise.all([
    getArticlesPage({ publishedOnly: true, categorySlug: slug }, page, BLOG_PAGE_SIZE),
    getCategories(true),
    getTags(),
  ])

  const category = categories.find((c) => c.slug === slug)
  if (!category) {
    return new Response(blogNotFoundHtml, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
      status: 404,
    })
  }

  return renderBlogTheme({
    articles: result.items.map(toArticleData),
    categories: categories.map(toCategoryData),
    tags: tags.map(toTagData),
    pagination: {
      page: result.page,
      totalPages: result.totalPages,
      basePath: `/blog/category/${slug}`,
    },
  })
}
