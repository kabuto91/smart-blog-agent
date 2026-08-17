import { prisma } from "../db/client"
import type { ThemeMessage, ThemeSession } from "@/generated/prisma/client"

export type { ThemeMessage, ThemeSession }

export async function createSession(id: string): Promise<void> {
  await prisma.themeSession.create({
    data: { id },
  })
}

export async function sessionExists(id: string): Promise<boolean> {
  const session = await prisma.themeSession.findUnique({
    where: { id },
  })
  return session !== null
}

export interface PageSnapshot {
  /** 骨架/布局 HTML（含 <head> 样式、导航、页脚）。 */
  layout: string | null
  /** 各页面正文 HTML，key 为页面类型（home/list/detail）。 */
  pages: Record<string, string>
  /** pageSnapshots 列原始 JSON。 */
  pagesJson: string | null
  contentConfig: string | null
}

export async function addMessage(
  sessionId: string,
  role: ThemeMessage["role"],
  content: string,
  htmlSnapshot?: string,
  contentConfig?: string,
  pageSnapshots?: string,
  metrics?: string
): Promise<void> {
  // Ensure session exists
  const exists = await sessionExists(sessionId)
  if (!exists) {
    await createSession(sessionId)
  }

  await prisma.themeMessage.create({
    data: {
      sessionId,
      role,
      content,
      htmlSnapshot: htmlSnapshot || null,
      pageSnapshots: pageSnapshots || null,
      contentConfig: contentConfig || null,
      metrics: metrics || null,
    },
  })

  // Update session timestamp
  await prisma.themeSession.update({
    where: { id: sessionId },
    data: { updatedAt: new Date() },
  })
}

export async function getMessages(sessionId: string): Promise<ThemeMessage[]> {
  const messages = await prisma.themeMessage.findMany({
    where: { sessionId },
    orderBy: { id: "asc" },
  })
  return messages
}

export async function getLatestHtml(sessionId: string): Promise<string | null> {
  const message = await prisma.themeMessage.findFirst({
    where: {
      sessionId,
      htmlSnapshot: { not: null },
    },
    orderBy: { id: "desc" },
    select: { htmlSnapshot: true },
  })
  return message?.htmlSnapshot ?? null
}

/** 取最近一次含骨架/页面快照的消息，用于迭代时把签名上下文回填给页面 agent。 */
export async function getLatestSnapshot(
  sessionId: string
): Promise<PageSnapshot | null> {
  const message = await prisma.themeMessage.findFirst({
    where: {
      sessionId,
      OR: [{ htmlSnapshot: { not: null } }, { pageSnapshots: { not: null } }],
    },
    orderBy: { id: "desc" },
    select: { htmlSnapshot: true, pageSnapshots: true, contentConfig: true },
  })
  if (!message) return null
  let pages: Record<string, string> = {}
  if (message.pageSnapshots) {
    try {
      pages = JSON.parse(message.pageSnapshots) as Record<string, string>
    } catch {
      pages = {}
    }
  }
  return {
    layout: message.htmlSnapshot ?? null,
    pages,
    pagesJson: message.pageSnapshots ?? null,
    contentConfig: message.contentConfig ?? null,
  }
}

export async function getLatestContentConfig(sessionId: string): Promise<string | null> {
  const message = await prisma.themeMessage.findFirst({
    where: {
      sessionId,
      contentConfig: { not: null },
    },
    orderBy: { id: "desc" },
    select: { contentConfig: true },
  })
  return message?.contentConfig ?? null
}

export async function deleteSession(sessionId: string): Promise<void> {
  await prisma.themeMessage.deleteMany({
    where: { sessionId },
  })
  await prisma.themeSession.delete({
    where: { id: sessionId },
  })
}
