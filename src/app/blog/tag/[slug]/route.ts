import { getArticlesPage, getCategories, getTags } from "@/lib/articles"
import {
  toArticleData,
  toCategoryData,
  toTagData,
  renderBlogTheme,
  BLOG_PAGE_SIZE,
  blogNotFoundHtml,
} from "@/lib/blog"
import { getActiveTheme } from "@/lib/theme"
import { getCustomRoutes, normalizeRoute } from "@/lib/custom-pages"
import { renderCustomPage } from "@/lib/content-renderer"
import { getSiteConfig } from "@/lib/site-config"

export const runtime = "nodejs"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params

  const theme = await getActiveTheme()
  if (theme) {
    const route = normalizeRoute(`/blog/tag/${slug}`)
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

  const { searchParams } = new URL(request.url)
  const page = Number(searchParams.get("page")) || 1

  const [result, categories, tags] = await Promise.all([
    getArticlesPage({ publishedOnly: true, tagSlug: slug }, page, BLOG_PAGE_SIZE),
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
    articles: result.items.map(toArticleData),
    categories: categories.map(toCategoryData),
    tags: tags.map(toTagData),
    pagination: {
      page: result.page,
      totalPages: result.totalPages,
      basePath: `/blog/tag/${slug}`,
    },
  })
}
