import { renderContent } from "@smart-blog/core/lib/theme/content-renderer"
import type { PageType } from "@smart-blog/core/lib/theme/content-renderer"
import { buildPreviewDynamicData } from "@smart-blog/core/lib/theme/preview-data"
import { mergeThemePage } from "@smart-blog/core/lib/theme/theme-splitter"
import { getSiteConfig } from "@smart-blog/core/lib/site-config"
import { getReusableTexts } from "@smart-blog/core/lib/reusable-text"
import type { ContentConfig } from "@smart-blog/core/lib/types/content-config"

export const runtime = "nodejs"

interface RenderRequest {
  /** 兼容旧调用：完整 HTML 模板 */
  htmlTemplate?: string
  /** 新调用：共享布局 */
  layoutHtml?: string
  /** 新调用：页面正文（插入布局占位处） */
  pageHtml?: string
  contentConfig?: ContentConfig
  /** 拆分式主题：跳过启发式剪枝（默认随调用方式自动推断） */
  pageSpecific?: boolean
  /**
   * 预览的页面类型：传值时按线上口径注入真实的文章/标签/分类数据，
   * 避免动态区块渲染为空导致预览布局塌陷（生成的主题片段常不含示例文案）。
   */
  pageType?: PageType
}

export async function POST(request: Request) {
  try {
    const body: RenderRequest = await request.json()

    let template = body.htmlTemplate
    let isSplit = body.pageSpecific
    if (!template && body.layoutHtml) {
      template = mergeThemePage(body.layoutHtml, body.pageHtml ?? "")
      isSplit = isSplit ?? true
    }

    if (!template) {
      return Response.json(
        { error: "htmlTemplate or layoutHtml is required" },
        { status: 400 }
      )
    }

    // 含 [data-page-host] 的模板已是"布局+单页正文"的拆分形态，跳过后启发式剪枝。
    if (isSplit === undefined && template.includes("data-page-host")) {
      isSplit = true
    }

    const siteConfig = await getSiteConfig()
    const reusableTexts = await getReusableTexts()
    const dynamicData = body.pageType
      ? await buildPreviewDynamicData(body.pageType)
      : undefined
    const renderedHtml = renderContent(
      template,
      body.contentConfig ?? {},
      dynamicData,
      siteConfig,
      { pageSpecific: !!isSplit },
      reusableTexts
    )

    return Response.json({ html: renderedHtml })
  } catch (error) {
    const msg = error instanceof Error ? error.message : "未知错误"
    return Response.json({ error: msg }, { status: 500 })
  }
}