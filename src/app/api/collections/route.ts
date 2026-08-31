import {
  getCollections,
  createCollection,
  isUniqueError,
} from "@/lib/collections"

export const runtime = "nodejs"

export async function GET() {
  try {
    const collections = await getCollections()
    return Response.json(collections)
  } catch (error) {
    const msg = error instanceof Error ? error.message : "未知错误"
    return Response.json({ error: msg }, { status: 500 })
  }
}

interface CreateRequest {
  name: string
  slug?: string
  description?: string | null
  coverImage?: string | null
}

export async function POST(request: Request) {
  try {
    const body: CreateRequest = await request.json()
    if (!body.name?.trim()) {
      return Response.json({ error: "合集名称是必填项" }, { status: 400 })
    }
    const collection = await createCollection({
      name: body.name.trim(),
      slug: body.slug,
      description: body.description,
      coverImage: body.coverImage,
    })
    return Response.json(collection, { status: 201 })
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
