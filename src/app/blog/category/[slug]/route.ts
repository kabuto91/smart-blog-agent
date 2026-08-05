import { getArticlesPage, getCategories, getTags } from "@/lib/articles"
import {
  toArticleData,
  toCategoryData,
  toTagData,
  renderBlogTheme,
  BLOG_PAGE_SIZE,
  blogNotFoundHtml,
} from "@/lib/blog"
import { getActiveTheme } from "@/lib/theme/theme"
import { getCustomRoutes, normalizeRoute } from "@/lib/theme/custom-pages"
import { renderCustomPage } from "@/lib/theme/content-renderer"
import { getSiteConfig } from "@/lib/site-config"

export const runtime = "nodejs"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params

  const theme = await getActiveTheme()
  if (theme) {
    const route = normalizeRoute(`/blog/category/${slug}`)
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
