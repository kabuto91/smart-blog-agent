import { fetchAllJuejinTags } from "@/lib/juejin-tags"
import { replaceAllTagsWith } from "@/lib/articles"

export const runtime = "nodejs"

/**
 * 从掘金抓取全部官方标签并整体替换本地 tags 表。
 * 会清除所有标签及文章与标签的关联（破坏性操作，由后台按钮显式触发）。
 */
export async function POST() {
  try {
    const tags = await fetchAllJuejinTags()
    const names = tags.map((t) => t.name)

    const { imported, deleted } = await replaceAllTagsWith(names)

    return Response.json({
      imported,
      deleted,
      total: tags.length,
      message: `已导入 ${imported} 个掘金标签，清除了 ${deleted} 条旧关联`,
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : "未知错误"
    return Response.json({ error: msg }, { status: 500 })
  }
}