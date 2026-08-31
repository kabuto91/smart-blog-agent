import { getCollections } from "@/lib/collections"
import {
  renderThemePage,
  renderCustomThemePage,
  blogNotConfiguredHtml,
} from "@/lib/blog"
import { buildCollectionsGridHtml } from "@/lib/collections-render"

export const runtime = "nodejs"

export async function GET() {
  // 支持主题自定义页覆盖 /collections 路由
  const customHtml = await renderCustomThemePage("/collections")
  if (customHtml) {
    return new Response(customHtml, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    })
  }

  // 仅展示含已发布文章的合集
  const collections = await getCollections(true)
  const gridHtml = buildCollectionsGridHtml(
    collections.map((c) => ({
      name: c.name,
      slug: c.slug,
      description: c.description,
      articleCount: c.articleCount,
    }))
  )

  const html = await renderThemePage(
    "list",
    { pagination: { page: 1, totalPages: 1, basePath: "/collections" } },
    { beforeListHtml: gridHtml, stripEmptyLists: true }
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
