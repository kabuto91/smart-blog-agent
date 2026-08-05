import { getActiveTheme } from "@/lib/theme/theme"
import { renderCustomThemePage, blogNotFoundHtml, blogNotConfiguredHtml } from "@/lib/blog"

export const runtime = "nodejs"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params
  const route = `/${(path ?? []).join("/")}`

  const theme = await getActiveTheme()
  if (!theme) {
    return new Response(blogNotConfiguredHtml, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    })
  }

  const html = await renderCustomThemePage(route)
  if (!html) {
    return new Response(blogNotFoundHtml, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
      status: 404,
    })
  }

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  })
}