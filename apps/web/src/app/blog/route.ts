import { getHomeHtml, renderResponse } from "@/lib/blog-cache"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** /blog：与根路径一致地渲染主题首页（兼容主题内指向 /blog 的链接）。 */
export async function GET() {
  return renderResponse(getHomeHtml())
}
