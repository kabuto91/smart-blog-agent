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

export async function addMessage(
  sessionId: string,
  role: ThemeMessage["role"],
  content: string,
  htmlSnapshot?: string,
  contentConfig?: string
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
      contentConfig: contentConfig || null,
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
