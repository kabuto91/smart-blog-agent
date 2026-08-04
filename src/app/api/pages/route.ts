import { getActiveTheme, updateTheme } from "@/lib/theme"
import {
  buildCustomPageSection,
  insertCustomPageSection,
  mergeContentConfig,
  normalizeRoute,
} from "@/lib/custom-pages"

export const runtime = "nodejs"

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

    const sectionHtml = buildCustomPageSection(route, payload.html)

    const updatedHtml = insertCustomPageSection(theme.html, route, sectionHtml)

    const updated = await updateTheme(theme.id, {
      html: updatedHtml,
      contentConfig: mergeContentConfig(
        theme.contentConfig as string | null,
        payload.contentConfig
      ),
    })

    return Response.json(updated, { status: 200 })
  } catch (error) {
    const msg = error instanceof Error ? error.message : "未知错误"
    return Response.json({ error: msg }, { status: 500 })
  }
}
