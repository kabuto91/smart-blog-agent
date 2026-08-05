import { deleteTheme, getThemeById } from "@/lib/theme/theme"
import { prisma } from "@/lib/db/client"

export const runtime = "nodejs"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const theme = await getThemeById(id)
    if (!theme) {
      return Response.json({ error: "主题不存在" }, { status: 404 })
    }
    return Response.json(theme)
  } catch (error) {
    const msg = error instanceof Error ? error.message : "未知错误"
    return Response.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    await deleteTheme(id)
    return new Response(null, { status: 204 })
  } catch (error) {
    const msg = error instanceof Error ? error.message : "未知错误"
    return Response.json({ error: msg }, { status: 500 })
  }
}

interface PatchRequest {
  name?: string
  html?: string
  contentConfig?: string
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body: PatchRequest = await request.json()
    const data: Record<string, string | null> = {}
    if (body.name !== undefined) data.name = body.name
    if (body.html !== undefined) data.html = body.html
    if (body.contentConfig !== undefined) data.contentConfig = body.contentConfig

    const theme = await prisma.theme.update({
      where: { id },
      data,
    })
    return Response.json(theme)
  } catch (error) {
    const msg = error instanceof Error ? error.message : "未知错误"
    return Response.json({ error: msg }, { status: 500 })
  }
}
