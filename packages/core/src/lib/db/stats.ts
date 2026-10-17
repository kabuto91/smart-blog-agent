import { prisma } from "./client"

export async function getSiteStats() {
  const stats = await prisma.siteStats.upsert({
    where: { id: 1 },
    create: { id: 1 },
    update: {},
  })
  return stats
}

/**
 * 只读获取站点统计，不写库；行不存在时返回全 0。
 * 供前台渲染路径使用，避免每次渲染都执行 upsert（渲染路径不应有写操作）。
 */
export async function readSiteStats() {
  try {
    const stats = await prisma.siteStats.findUnique({ where: { id: 1 } })
    if (stats) return stats
  } catch {
    // table may not exist yet
  }
  return { id: 1, totalViews: 0, totalArticles: 0, totalLikes: 0 }
}

export async function incrementViews(count = 1) {
  return prisma.siteStats.upsert({
    where: { id: 1 },
    create: { id: 1, totalViews: count },
    update: { totalViews: { increment: count } },
  })
}

export async function incrementLikes(count = 1) {
  return prisma.siteStats.upsert({
    where: { id: 1 },
    create: { id: 1, totalLikes: count },
    update: { totalLikes: { increment: count } },
  })
}

export async function setArticleCount(count: number) {
  return prisma.siteStats.upsert({
    where: { id: 1 },
    create: { id: 1, totalArticles: count },
    update: { totalArticles: count },
  })
}
