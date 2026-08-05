import { prisma } from "./db"
import type { ContentConfig } from "./types/content-config"

export interface ThemeData {
  id: string
  name: string
  html: string
  contentConfig: ContentConfig | null
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

function parseTheme(theme: {
  id: string
  name: string
  html: string
  contentConfig: string | null
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}): ThemeData {
  return {
    ...theme,
    contentConfig: theme.contentConfig ? JSON.parse(theme.contentConfig) : null,
  }
}

export async function getThemes(): Promise<ThemeData[]> {
  const themes = await prisma.theme.findMany({
    orderBy: { createdAt: "desc" },
  })
  return themes.map(parseTheme)
}

export async function getThemeById(id: string): Promise<ThemeData | null> {
  const theme = await prisma.theme.findUnique({ where: { id } })
  return theme ? parseTheme(theme) : null
}

export async function getActiveTheme(): Promise<ThemeData | null> {
  const themes = await prisma.theme.findMany({
    where: { isActive: true },
  })
  if (themes.length === 0) return null
  if (themes.length > 1) {
    const [first, ...rest] = themes
    await prisma.theme.updateMany({
      where: { id: { in: rest.map((t) => t.id) } },
      data: { isActive: false },
    })
    return parseTheme(first)
  }
  return parseTheme(themes[0])
}

export async function saveTheme(
  name: string,
  html: string,
  contentConfig?: string
): Promise<ThemeData> {
  const existing = await prisma.theme.findMany({
    where: { name },
  })
  let uniqueName = name
  if (existing.length > 0) {
    const match = name.match(/^(.*?)(\s*#\d+)?$/)
    const base = match?.[1] ?? name
    const suffix = existing.length + 1
    uniqueName = `${base} #${suffix}`
  }
  const theme = await prisma.theme.create({
    data: { name: uniqueName, html, contentConfig: contentConfig ?? null },
  })
  return parseTheme(theme)
}

export async function deleteTheme(id: string): Promise<void> {
  await prisma.theme.delete({ where: { id } })
}

export async function updateTheme(
  id: string,
  data: { html?: string; contentConfig?: string | null }
): Promise<ThemeData> {
  const theme = await prisma.theme.update({
    where: { id },
    data: {
      ...(data.html !== undefined ? { html: data.html } : {}),
      ...(data.contentConfig !== undefined
        ? { contentConfig: data.contentConfig }
        : {}),
    },
  })
  return parseTheme(theme)
}

export async function activateTheme(id: string): Promise<ThemeData> {
  const theme = await prisma.$transaction(async (tx) => {
    await tx.theme.updateMany({
      where: { isActive: true },
      data: { isActive: false },
    })
    const updated = await tx.theme.update({
      where: { id },
      data: { isActive: true },
    })
    return updated
  })
  return parseTheme(theme)
}
