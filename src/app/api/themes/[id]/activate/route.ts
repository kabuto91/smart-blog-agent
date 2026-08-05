import { activateTheme } from "@/lib/theme/theme"

export const runtime = "nodejs"

export async function PUT(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const theme = await activateTheme(id)
    return Response.json(theme)
  } catch (error) {
    const msg = error instanceof Error ? error.message : "未知错误"
    return Response.json({ error: msg }, { status: 500 })
  }
}
