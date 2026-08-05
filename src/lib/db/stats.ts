import { prisma } from "./db"

export async function getSiteStats() {
  const stats = await prisma.siteStats.upsert({
    where: { id: 1 },
    create: { id: 1 },
    update: {},
  })
  return stats
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
