import { getArticleBySlug, getCategories, getTags } from "@/lib/articles"
import {
  toArticleDetailData,
  toCategoryData,
  toTagData,
  renderBlogTheme,
  renderCustomThemePage,
  blogNotFoundHtml,
} from "@/lib/blog"

export const runtime = "nodejs"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params

  const customHtml = await renderCustomThemePage(`/blog/${slug}`)
  if (customHtml) {
    return new Response(customHtml, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    })
  }

  const article = await getArticleBySlug(slug)

  if (!article || !article.published) {
    return new Response(blogNotFoundHtml, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
      status: 404,
    })
  }

  const [categories, tags] = await Promise.all([
    getCategories(true),
    getTags(),
  ])

  return renderBlogTheme({
    articles: [toArticleDetailData(article)],
    categories: categories.map(toCategoryData),
    tags: tags.map(toTagData),
  })
}
