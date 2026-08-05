import { renderContent } from "@/lib/theme/content-renderer"
import { mergeThemePage } from "@/lib/theme/theme-splitter"
import { getSiteConfig } from "@/lib/site-config"
import type { ContentConfig } from "@/lib/types/content-config"

export const runtime = "nodejs"

interface RenderRequest {
  /** 兼容旧调用：完整 HTML 模板 */
  htmlTemplate?: string
  /** 新调用：共享布局 */
  layoutHtml?: string
  /** 新调用：页面正文（插入布局占位处） */
  pageHtml?: string
  contentConfig?: ContentConfig
}

export async function POST(request: Request) {
  try {
    const body: RenderRequest = await request.json()

    let template = body.htmlTemplate
    if (!template && body.layoutHtml) {
      template = mergeThemePage(body.layoutHtml, body.pageHtml ?? "")
    }

    if (!template) {
      return Response.json(
        { error: "htmlTemplate or layoutHtml is required" },
        { status: 400 }
      )
    }

    const siteConfig = await getSiteConfig()
    const renderedHtml = renderContent(
      template,
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