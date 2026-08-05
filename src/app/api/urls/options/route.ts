import { getUrlOptions } from "@/lib/theme/url-options"

export const runtime = "nodejs"

export async function GET() {
  try {
    const options = await getUrlOptions()
    return Response.json(options)
  } catch (error) {
    const msg = error instanceof Error ? error.message : "未知错误"
    return Response.json({ error: msg }, { status: 500 })
  }
}
