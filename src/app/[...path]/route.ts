import { getActiveTheme } from "@/lib/theme"
import { getSiteConfig } from "@/lib/site-config"
import { renderCustomPage } from "@/lib/content-renderer"
import { getCustomRoutes, normalizeRoute } from "@/lib/custom-pages"
import { blogNotFoundHtml, blogNotConfiguredHtml } from "@/lib/blog"

export const runtime = "nodejs"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params
  const route = normalizeRoute(`/${(path ?? []).join("/")}`)

  const theme = await getActiveTheme()
  if (!theme) {
    return new Response(blogNotConfiguredHtml, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    })
  }

  const routes = getCustomRoutes(theme.html)
  if (!routes.includes(route)) {
    return new Response(blogNotFoundHtml, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
      status: 404,
    })
  }

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
