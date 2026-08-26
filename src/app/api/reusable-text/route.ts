import {
  getReusableTexts,
  upsertReusableText,
  deleteReusableText,
} from "@/lib/reusable-text"

export const runtime = "nodejs"

export async function GET() {
  try {
    const lib = await getReusableTexts()
    return Response.json(lib)
  } catch (error) {
    const msg = error instanceof Error ? error.message : "未知错误"
    return Response.json({ error: msg }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const key: string = typeof body?.key === "string" ? body.key : ""
    if (!key) {
      return Response.json({ error: "key 不能为空" }, { status: 400 })
    }

    let lib
    if (body?.action === "delete") {
      lib = await deleteReusableText(key)
    } else if (typeof body?.text === "string") {
      lib = await upsertReusableText(key, body.text)
    } else {
      return Response.json({ error: "text 或 action 参数缺失" }, { status: 400 })
    }

    return Response.json(lib)
  } catch (error) {
    const msg = error instanceof Error ? error.message : "未知错误"
    return Response.json({ error: msg }, { status: 500 })
  }
}