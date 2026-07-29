import { renderContent } from "@/lib/content-renderer"
import { getSiteConfig } from "@/lib/site-config"
import type { ContentConfig } from "@/lib/types/content-config"

export const runtime = "nodejs"

interface RenderRequest {
  htmlTemplate: string
  contentConfig?: ContentConfig
}

export async function POST(request: Request) {
  try {
    const body: RenderRequest = await request.json()

    if (!body.htmlTemplate) {
      return Response.json({ error: "htmlTemplate is required" }, { status: 400 })
    }

    const siteConfig = await getSiteConfig()
    const renderedHtml = renderContent(
      body.htmlTemplate,
      body.contentConfig ?? {},
      undefined,
      siteConfig
    )

    return Response.json({ html: renderedHtml })
  } catch (error) {
    const msg = error instanceof Error ? error.message : "未知错误"
    return Response.json({ error: msg }, { status: 500 })
  }
}
