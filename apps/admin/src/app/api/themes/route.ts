import { getThemes, saveTheme, ThemePageInput } from "@smart-blog/core/lib/theme/theme"
import { ensureLayoutContract } from "@smart-blog/core/lib/theme/theme-splitter"
import { checkThemeIntegrity } from "@/lib/theme/theme-selfcheck"

export const runtime = "nodejs"

export async function GET() {
  try {
    const themes = await getThemes()
    return Response.json(themes)
  } catch (error) {
    const msg = error instanceof Error ? error.message : "未知错误"
    return Response.json({ error: msg }, { status: 500 })
  }
}

interface CreateRequest {
  name: string
  layoutHtml: string
  pages?: ThemePageInput[]
  contentConfig?: string
}

export async function POST(request: Request) {
  try {
    const body: CreateRequest = await request.json()
    if (!body.name || !body.layoutHtml) {
      return Response.json(
        { error: "name 和 layoutHtml 是必填项" },
        { status: 400 }
      )
    }

    const layoutHtml = ensureLayoutContract(body.layoutHtml)

    // 保存前硬闸门：渲染后自检存在 blocker 时拒绝保存。
    // （生成管线已有 gate 节点兜底，这里是第二道防线 —— 防止历史遗留
    //   或其它入口写入未经自检的主题。）
    const pages: Record<string, string> = {}
    for (const p of body.pages ?? []) {
      if (p.html) pages[p.type] = p.html
    }
    const report = checkThemeIntegrity(layoutHtml, pages)
    if (!report.ok) {
      return Response.json(
        {
          error: "主题未通过渲染后自检，已拒绝保存",
          blockers: report.blockers.map((b) => ({
            scope: b.scope,
            message: b.message,
          })),
        },
        { status: 422 }
      )
    }

    const theme = await saveTheme(
      body.name,
      layoutHtml,
      body.pages ?? [],
      body.contentConfig
    )
    return Response.json(theme, { status: 201 })
  } catch (error) {
    const msg = error instanceof Error ? error.message : "未知错误"
    return Response.json({ error: msg }, { status: 500 })
  }
}
