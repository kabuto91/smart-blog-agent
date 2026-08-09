import { getThemes, saveTheme, ThemePageInput } from "@/lib/theme/theme"
import { ensureLayoutContract } from "@/lib/theme/theme-splitter"

export const runtime = "nodejs"

export async function GET() {
  try {
    const themes = await getThemes()
    return Response.json(themes)
  } catch (error) {
    const msg = error instanceof Error ? error.message : "未知错误"
    return Response.json({ error: msg }, { status: 500 })
  }
}

interface CreateRequest {
  name: string
  layoutHtml: string
  pages?: ThemePageInput[]
  contentConfig?: string
}

export async function POST(request: Request) {
  try {
    const body: CreateRequest = await request.json()
    if (!body.name || !body.layoutHtml) {
      return Response.json(
        { error: "name 和 layoutHtml 是必填项" },
        { status: 400 }
      )
    }
    const theme = await saveTheme(
      body.name,
      ensureLayoutContract(body.layoutHtml),
      body.pages ?? [],
      body.contentConfig
    )
    return Response.json(theme, { status: 201 })
  } catch (error) {
    const msg = error instanceof Error ? error.message : "未知错误"
    return Response.json({ error: msg }, { status: 500 })
  }
}
