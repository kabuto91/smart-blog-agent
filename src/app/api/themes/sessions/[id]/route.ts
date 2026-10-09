import { deleteSession, getMessages } from "@/lib/theme/theme-session"
import { getSiteConfig } from "@/lib/site-config"
import { extractContentConfig } from "@/lib/theme/content-extractor"

export const runtime = "nodejs"

function parseJson(raw: string | null): unknown {
  if (!raw) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

/**
 * 读取会话历史快照：客户端刷新/断线后无需重新生成即可恢复已落库的主题。
 * 页面级 contentConfig 未单独落库，这里用同一套提取逻辑从页面 HTML 还原。
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const rows = await getMessages(id)
    if (rows.length === 0) {
      return Response.json({ error: "会话不存在" }, { status: 404 })
    }

    const siteConfig = await getSiteConfig()
    const messages = rows.map((row) => {
      if (!row.htmlSnapshot) {
        return {
          id: row.id,
          role: row.role,
          content: row.content,
          createdAt: row.createdAt.toISOString(),
        }
      }
      let pagesMap: Record<string, string> = {}
      try {
        pagesMap = row.pageSnapshots
          ? (JSON.parse(row.pageSnapshots) as Record<string, string>)
          : {}
      } catch {
        pagesMap = {}
      }
      return {
        id: row.id,
        role: row.role,
        content: row.content,
        createdAt: row.createdAt.toISOString(),
        layoutHtml: row.htmlSnapshot,
        contentConfig: row.contentConfig ?? undefined,
        pages: Object.entries(pagesMap).map(([type, html]) => ({
          type,
          html,
          contentConfig: JSON.stringify(
            extractContentConfig(html, siteConfig).contentConfig
          ),
        })),
        metrics: parseJson(row.metrics),
      }
    })

    return Response.json({ conversationId: id, messages })
  } catch (error) {
    const msg = error instanceof Error ? error.message : "未知错误"
    return Response.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    await deleteSession(id)
    return new Response(null, { status: 204 })
  } catch (error) {
    const msg = error instanceof Error ? error.message : "未知错误"
    return Response.json({ error: msg }, { status: 500 })
  }
}