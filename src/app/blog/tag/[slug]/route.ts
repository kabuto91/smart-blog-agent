import { getArticles, getCategories, getTags } from "@/lib/articles"
import {
  toArticleData,
  toCategoryData,
  toTagData,
  renderBlogTheme,
  blogNotFoundHtml,
} from "@/lib/blog"

export const runtime = "nodejs"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const [articles, categories, tags] = await Promise.all([
    getArticles({ publishedOnly: true, tagSlug: slug }),
    getCategories(true),
    getTags(),
  ])

  const tag = tags.find((t) => t.slug === slug)
  if (!tag) {
    return new Response(blogNotFoundHtml, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
      status: 404,
    })
  }

  return renderBlogTheme({
    articles: articles.map(toArticleData),
    categories: categories.map(toCategoryData),
    tags: tags.map(toTagData),
  })
}
