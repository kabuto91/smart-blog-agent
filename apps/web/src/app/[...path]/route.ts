import { getCustomPageHtml, renderResponse } from "@/lib/blog-cache"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** 兜底路由：命中主题自定义页则渲染，否则 404。 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params
  const route = `/${(path ?? []).join("/")}`

  return renderResponse(getCustomPageHtml(route))
}
