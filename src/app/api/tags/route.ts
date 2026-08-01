import { getTags, createTag, isUniqueError } from "@/lib/articles"

export const runtime = "nodejs"

export async function GET() {
  try {
    const tags = await getTags()
    return Response.json(tags)
  } catch (error) {
    const msg = error instanceof Error ? error.message : "未知错误"
    return Response.json({ error: msg }, { status: 500 })
  }
}

interface CreateRequest {
  name: string
  slug?: string
}

export async function POST(request: Request) {
  try {
    const body: CreateRequest = await request.json()
    if (!body.name?.trim()) {
      return Response.json({ error: "标签名称是必填项" }, { status: 400 })
    }
    const tag = await createTag(body.name.trim(), body.slug)
    return Response.json(tag, { status: 201 })
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
