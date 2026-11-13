import { getArchiveHtml, getHomeHtml, renderResponse } from "@/lib/blog-cache"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** 站点根路径：渲染主题首页；旧 ?page=N 链接转交归档列表（首页不再分页）。 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const page = Number(searchParams.get("page")) || 1
  if (page > 1) return renderResponse(getArchiveHtml(page))
  return renderResponse(getHomeHtml())
}
