import {
  deleteTheme,
  getThemeById,
  updateTheme,
  upsertThemePage,
  deleteThemePage,
  ThemePageInput,
} from "@/lib/theme/theme"

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
  layoutHtml?: string
  contentConfig?: string
  pages?: ThemePageInput[]
  /** 要删除的页面行 id 列表 */
  deletePageIds?: string[]
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body: PatchRequest = await request.json()

    let theme = await getThemeById(id)
    if (!theme) {
      return Response.json({ error: "主题不存在" }, { status: 404 })
    }

    const data: Record<string, string> = {}
    if (body.name !== undefined) data.name = body.name
    if (body.layoutHtml !== undefined) data.layoutHtml = body.layoutHtml
    if (body.contentConfig !== undefined)
      data.contentConfig = body.contentConfig as string

    if (Object.keys(data).length > 0) {
      theme = await updateTheme(id, {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.layoutHtml !== undefined
          ? { layoutHtml: body.layoutHtml }
          : {}),
        ...(body.contentConfig !== undefined
          ? { contentConfig: body.contentConfig }
          : {}),
      })
    }

    if (body.pages && body.pages.length > 0) {
      for (const input of body.pages) {
        await upsertThemePage(id, input)
      }
    }

    if (body.deletePageIds && body.deletePageIds.length > 0) {
      for (const pageId of body.deletePageIds) {
        await deleteThemePage(pageId)
      }
    }

    theme = await getThemeById(id)
    return Response.json(theme)
  } catch (error) {
    const msg = error instanceof Error ? error.message : "未知错误"
    return Response.json({ error: msg }, { status: 500 })
  }
}