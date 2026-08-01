import { updateTag, deleteTag, isUniqueError } from "@/lib/articles"

export const runtime = "nodejs"

interface PatchRequest {
  name?: string
  slug?: string
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body: PatchRequest = await request.json()
    const data: { name?: string; slug?: string } = {}
    if (body.name !== undefined) data.name = body.name
    if (body.slug !== undefined) data.slug = body.slug
    if (data.name === undefined && data.slug === undefined) {
      return Response.json({ error: "没有需要更新的字段" }, { status: 400 })
    }
    const tag = await updateTag(id, data)
    return Response.json(tag)
  } catch (error) {
    if (isUniqueError(error)) {
      return Response.json(
        { error: "标签名称或 slug 已存在" },
        { status: 409 }
      )
    }
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
    await deleteTag(id)
    return new Response(null, { status: 204 })
  } catch (error) {
    const msg = error instanceof Error ? error.message : "未知错误"
    return Response.json({ error: msg }, { status: 500 })
  }
}
