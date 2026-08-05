import { getArticleBySlug, getCategories, getTags } from "@/lib/articles"
import {
  toArticleDetailData,
  toCategoryData,
  toTagData,
  renderBlogTheme,
  blogNotFoundHtml,
} from "@/lib/blog"
import { getActiveTheme } from "@/lib/theme/theme"
import { getCustomRoutes, normalizeRoute } from "@/lib/theme/custom-pages"
import { renderCustomPage } from "@/lib/theme/content-renderer"
import { getSiteConfig } from "@/lib/site-config"

export const runtime = "nodejs"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params

  const theme = await getActiveTheme()
  if (theme) {
    const route = normalizeRoute(`/blog/${slug}`)
    const customRoutes = getCustomRoutes(theme.html)
    if (customRoutes.includes(route)) {
      const siteConfig = await getSiteConfig()
      const html = renderCustomPage(
        theme.html,
        route,
        theme.contentConfig ?? {},
        siteConfig
      )
      return new Response(html, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      })
    }
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
