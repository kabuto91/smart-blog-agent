import { getJuejinToken, saveJuejinToken } from "@/lib/site-config"

export const runtime = "nodejs"

/** 读取掘金登录 Cookie 字符串。 */
export async function GET() {
  const token = await getJuejinToken()
  return Response.json({ token })
}

interface SaveTokenRequest {
  token?: unknown
}

/** 保存掘金登录 Cookie 字符串。传空串清除。 */
export async function PUT(request: Request) {
  let body: SaveTokenRequest
  try {
    body = (await request.json()) as SaveTokenRequest
  } catch {
    return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 })
  }
  if (typeof body.token !== "string") {
    return Response.json({ error: "token 必须是字符串" }, { status: 400 })
  }
  const token = body.token.trim()
  await saveJuejinToken(token)
  return Response.json({ success: true, configured: Boolean(token) })
}
