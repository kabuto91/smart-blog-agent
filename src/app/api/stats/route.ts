import { getSiteStats } from "@/lib/stats"
import { STAT_KEYS, STAT_FIELDS } from "@/lib/field-registry"

export const runtime = "nodejs"

export async function GET() {
  try {
    const stats = await getSiteStats()
    const config: Record<string, string> = {}
    for (const key of STAT_KEYS) {
      config[key] = String(stats[STAT_FIELDS[key].statKey])
    }
    return Response.json(config)
  } catch (error) {
    const msg = error instanceof Error ? error.message : "未知错误"
    return Response.json({ error: msg }, { status: 500 })
  }
}
