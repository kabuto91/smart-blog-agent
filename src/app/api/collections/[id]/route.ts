import {
  updateCollection,
  deleteCollection,
  isUniqueError,
} from "@/lib/collections"

export const runtime = "nodejs"

interface PatchRequest {
  name?: string
  slug?: string
  description?: string | null
  coverImage?: string | null
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body: PatchRequest = await request.json()
    const collection = await updateCollection(id, {
      name: body.name,
      slug: body.slug,
      description: body.description,
      coverImage: body.coverImage,
    })
    return Response.json(collection)
  } catch (error) {
    if (isUniqueError(error)) {
      return Response.json(
        { error: "合集名称或 slug 已存在" },
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
    await deleteCollection(id)
    return new Response(null, { status: 204 })
  } catch (error) {
    const msg = error instanceof Error ? error.message : "未知错误"
    return Response.json({ error: msg }, { status: 500 })
  }
}
