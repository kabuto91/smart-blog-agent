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
  const theme = await prisma.theme.findFirst({ where: { isActive: true } })
  return theme ? parseTheme(theme) : null
}

export async function saveTheme(
  name: string,
  html: string,
  contentConfig?: string
): Promise<ThemeData> {
  const theme = await prisma.theme.create({
    data: { name, html, contentConfig: contentConfig ?? null },
  })
  return parseTheme(theme)
}

export async function deleteTheme(id: string): Promise<void> {
  await prisma.theme.delete({ where: { id } })
}

export async function activateTheme(id: string): Promise<ThemeData> {
  await prisma.theme.updateMany({
    where: { isActive: true },
    data: { isActive: false },
  })
  const theme = await prisma.theme.update({
    where: { id },
    data: { isActive: true },
  })
  return parseTheme(theme)
}
