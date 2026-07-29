import { getSiteStats } from "@/lib/stats"

export const runtime = "nodejs"

export async function GET() {
  try {
    const stats = await getSiteStats()
    return Response.json({
      "total-views": String(stats.totalViews),
      "total-articles": String(stats.totalArticles),
      "total-likes": String(stats.totalLikes),
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : "未知错误"
    return Response.json({ error: msg }, { status: 500 })
  }
}
