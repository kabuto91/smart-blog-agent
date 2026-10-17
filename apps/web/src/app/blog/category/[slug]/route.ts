import { getCategoryHtml, renderResponse } from "@/lib/blog-cache"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const { searchParams } = new URL(request.url)
  const page = Number(searchParams.get("page")) || 1

  return renderResponse(getCategoryHtml(slug, page))
}
