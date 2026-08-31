import { getCollectionBySlug } from "@/lib/collections"
import { getCategories, getTags } from "@/lib/articles"
import {
  toArticleData,
  toCategoryData,
  toTagData,
  renderThemePage,
  renderCustomThemePage,
  blogNotFoundHtml,
  blogNotConfiguredHtml,
} from "@/lib/blog"
import { buildCollectionHeadHtml } from "@/lib/collections-render"

export const runtime = "nodejs"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params

  // 支持主题自定义页覆盖 /collections/:slug 路由
  const customHtml = await renderCustomThemePage(`/collections/${slug}`)
  if (customHtml) {
    return new Response(customHtml, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    })
  }

  const collection = await getCollectionBySlug(slug, { publishedOnly: true })
  if (!collection) {
    return new Response(blogNotFoundHtml, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
      status: 404,
    })
  }

  const [categories, tags] = await Promise.all([
    getCategories(true),
    getTags(),
  ])

  const headHtml = buildCollectionHeadHtml(collection)
  const html = await renderThemePage(
    "list",
    {
      articles: collection.articles.map(toArticleData),
      categories: categories.map(toCategoryData),
      tags: tags.map(toTagData),
      pagination: { page: 1, totalPages: 1, basePath: `/collections/${slug}` },
    },
    { beforeListHtml: headHtml }
  )
  if (html === null) {
    return new Response(blogNotConfiguredHtml, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    })
  }
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  })
}
