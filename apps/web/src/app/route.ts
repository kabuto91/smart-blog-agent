import { getHomeHtml, renderResponse } from "@/lib/blog-cache"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** 站点根路径：直接渲染主题首页。 */
export async function GET() {
  return renderResponse(getHomeHtml())
}
