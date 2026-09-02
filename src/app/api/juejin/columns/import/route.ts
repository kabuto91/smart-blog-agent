import { prisma } from "@/lib/db/client"
import {
  bindCollectionJuejinColumn,
  createCollection,
  findCollectionByJuejinColumnId,
} from "@/lib/collections"
import { fetchOwnColumns } from "@/lib/juejin-columns"
import { getJuejinToken } from "@/lib/site-config"

export const runtime = "nodejs"

/**
 * 从掘金拉取当前用户全部专栏，导入为本地合集：
 *  - 本地已有同名合集 → 绑定其 juejinColumnId；
 *  - 否则新建本地合集并绑定。
 * 返回导入/绑定统计。
 */
export async function POST() {
  try {
    const cookie = await getJuejinToken()
    if (!cookie) {
      return Response.json(
        { error: "未配置掘金 Cookie，请先在「个人管理」中配置掘金登录 Cookie" },
        { status: 400 }
      )
    }

    const columns = await fetchOwnColumns(cookie)
    let imported = 0
    let bound = 0

    for (const col of columns) {
      // 已绑定该专栏的合集已存在 → 跳过
      const byColumn = await findCollectionByJuejinColumnId(col.columnId)
      if (byColumn) {
        bound++
        continue
      }
      // 同名合集存在 → 绑定
      const byName = await prisma.collection.findFirst({
        where: { name: col.title },
        select: { id: true },
      })
      if (byName) {
        await bindCollectionJuejinColumn(byName.id, col.columnId)
        bound++
        continue
      }
      // 否则新建合集并绑定
      const created = await createCollection({
        name: col.title,
        description: col.abstract,
      })
      await bindCollectionJuejinColumn(created.id, col.columnId)
      imported++
    }

    return Response.json({
      total: columns.length,
      imported,
      bound,
      message: `掘金共 ${columns.length} 个专栏：新建本地合集 ${imported} 个，绑定到已有合集 ${bound} 个`,
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : "未知错误"
    return Response.json({ error: msg }, { status: 500 })
  }
}