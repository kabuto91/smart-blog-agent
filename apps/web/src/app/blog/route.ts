import { getArchiveHtml, getHomeHtml, renderResponse } from "@/lib/blog-cache"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** /blog：与根路径一致地渲染主题首页（兼容主题内指向 /blog 的链接）；旧 ?page=N 链接转交归档列表。 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const page = Number(searchParams.get("page")) || 1
  if (page > 1) return renderResponse(getArchiveHtml(page))
  return renderResponse(getHomeHtml())
}
