import { getActiveTheme, upsertThemePage } from "@/lib/theme/theme"
import { normalizeRoute } from "@/lib/theme/custom-pages"

export const runtime = "nodejs"

function pageNameFromRoute(route: string): string {
  const seg = route.split("/").filter(Boolean).pop()
  if (seg) return `页面 ${seg}`
  return "自定义页面"
}

interface SavePageRequest {
  url: string
  html: string
  contentConfig?: string
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as SavePageRequest
    const route = normalizeRoute(payload.url ?? "")

    if (!payload.html || route === "/") {
      return Response.json({ error: "url 和 html 是必填项" }, { status: 400 })
    }

    const theme = await getActiveTheme()
    if (!theme) {
      return Response.json({ error: "请先创建并启用一个主题" }, { status: 400 })
    }

    const page = await upsertThemePage(theme.id, {
      type: "custom",
      route,
      name: pageNameFromRoute(route),
      html: payload.html,
      contentConfig: payload.contentConfig ?? null,
    })

    return Response.json(page, { status: 200 })
  } catch (error) {
    const msg = error instanceof Error ? error.message : "未知错误"
    return Response.json({ error: msg }, { status: 500 })
  }
}