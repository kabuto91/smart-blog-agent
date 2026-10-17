import { getCollectionsHtml, renderResponse } from "@/lib/blog-cache"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  return renderResponse(getCollectionsHtml())
}
