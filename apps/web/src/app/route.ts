import { getHomeHtml, renderResponse } from "@/lib/blog-cache"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** 站点根路径：渲染主题首页（支持 ?page= 文章流翻页）。 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const page = Number(searchParams.get("page")) || 1
  return renderResponse(getHomeHtml(page))
}
