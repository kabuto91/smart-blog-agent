import { getHomeHtml, renderResponse } from "@/lib/blog-cache"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** /blog：与根路径一致地渲染主题首页（兼容主题内指向 /blog 的链接，支持 ?page= 翻页）。 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const page = Number(searchParams.get("page")) || 1
  return renderResponse(getHomeHtml(page))
}
