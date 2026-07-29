import { getSiteConfig, updateSiteConfig } from "@/lib/site-config"

export const runtime = "nodejs"

export async function GET() {
  try {
    const config = await getSiteConfig()
    return Response.json(config)
  } catch {
    return Response.json({})
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json()
    if (typeof body !== "object" || body === null) {
      return Response.json({ error: "请求体必须是一个 JSON 对象" }, { status: 400 })
    }

    const config: Record<string, string> = {}
    for (const [key, value] of Object.entries(body)) {
      config[key] = String(value)
    }

    await updateSiteConfig(config)
    return Response.json({ success: true, config })
  } catch (error) {
    const msg = error instanceof Error ? error.message : "未知错误"
    return Response.json({ error: msg }, { status: 500 })
  }
}
