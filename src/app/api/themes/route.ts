import { getThemes, saveTheme } from "@/lib/theme/theme"

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
  html: string
  contentConfig?: string
}

export async function POST(request: Request) {
  try {
    const body: CreateRequest = await request.json()
    if (!body.name || !body.html) {
      return Response.json({ error: "name 和 html 是必填项" }, { status: 400 })
    }
    const theme = await saveTheme(body.name, body.html, body.contentConfig)
    return Response.json(theme, { status: 201 })
  } catch (error) {
    const msg = error instanceof Error ? error.message : "未知错误"
    return Response.json({ error: msg }, { status: 500 })
  }
}
