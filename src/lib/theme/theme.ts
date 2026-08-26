import { prisma } from "../db/client"
import { mergeMissingNav, repairBrokenNav } from "./content-extractor"
import type { ContentConfig } from "../types/content-config"

export interface ThemePageData {
  id: string
  type: string
  route: string | null
  name: string
  html: string
  contentConfig: ContentConfig | null
  sortOrder: number
  createdAt: Date
  updatedAt: Date
}

export interface ThemeData {
  id: string
  name: string
  layoutHtml: string
  contentConfig: ContentConfig | null
  isActive: boolean
  createdAt: Date
  updatedAt: Date
  pages: ThemePageData[]
}

function parseContentConfig(raw: string | null): ContentConfig | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as ContentConfig
  } catch {
    return null
  }
}

function parsePage(page: {
  id: string
  type: string
  route: string | null
  name: string
  html: string
  contentConfig: string | null
  sortOrder: number
  createdAt: Date
  updatedAt: Date
}): ThemePageData {
  return {
    ...page,
    contentConfig: parseContentConfig(page.contentConfig),
  }
}

function parseTheme(theme: {
  id: string
  name: string
  layoutHtml: string
  contentConfig: string | null
  isActive: boolean
  createdAt: Date
  updatedAt: Date
  pages: {
    id: string
    type: string
    route: string | null
    name: string
    html: string
    contentConfig: string | null
    sortOrder: number
    createdAt: Date
    updatedAt: Date
  }[]
}): ThemeData {
  return ensureThemeNavConfig({
    id: theme.id,
    name: theme.name,
    layoutHtml: theme.layoutHtml,
    contentConfig: parseContentConfig(theme.contentConfig),
    isActive: theme.isActive,
    createdAt: theme.createdAt,
    updatedAt: theme.updatedAt,
    pages: theme.pages.map(parsePage),
  })
}

/**
 * 自我修复：导航（nav-list）字段只存在于布局 HTML 而不在 contentConfig 时，
 * 从布局反向提取并补齐，保证导航栏始终有可配置入口（兼容旧主题/被清空的配置）。
 * 同时对结构被展平（品牌被当成 nav 项）的旧配置用布局重新提取的结果覆盖。
 */
function ensureThemeNavConfig(theme: ThemeData): ThemeData {
  const config = mergeMissingNav(theme.contentConfig, theme.layoutHtml)
  const repaired = repairBrokenNav(config, theme.layoutHtml)
  if (repaired === theme.contentConfig) return theme
  return { ...theme, contentConfig: repaired }
}

const PAGE_INCLUDE = {
  pages: { orderBy: { sortOrder: "asc" as const } },
}

export function pageContentConfig(
  theme: ThemeData,
  pageType: string
): ContentConfig | null {
  const page = theme.pages.find((p) => p.type === pageType)
  const merged: ContentConfig = { ...(theme.contentConfig ?? {}) }
  if (page?.contentConfig) {
    Object.assign(merged, page.contentConfig)
  }
  return Object.keys(merged).length > 0 ? merged : null
}

export async function getThemes(): Promise<ThemeData[]> {
  const themes = await prisma.theme.findMany({
    orderBy: { createdAt: "desc" },
    include: PAGE_INCLUDE,
  })
  return themes.map(parseTheme)
}

export async function getThemeById(id: string): Promise<ThemeData | null> {
  const theme = await prisma.theme.findUnique({
    where: { id },
    include: PAGE_INCLUDE,
  })
  return theme ? parseTheme(theme) : null
}

export async function getActiveTheme(): Promise<ThemeData | null> {
  const themes = await prisma.theme.findMany({
    where: { isActive: true },
    include: PAGE_INCLUDE,
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

export interface ThemePageInput {
  type: string
  route?: string | null
  name: string
  html: string
  contentConfig?: string | null
  sortOrder?: number
}

export async function saveTheme(
  name: string,
  layoutHtml: string,
  pages: ThemePageInput[],
  contentConfig?: string
): Promise<ThemeData> {
  const existing = await prisma.theme.findMany({ where: { name } })
  let uniqueName = name
  if (existing.length > 0) {
    const match = name.match(/^(.*?)(\s*#\d+)?$/)
    const base = match?.[1] ?? name
    const suffix = existing.length + 1
    uniqueName = `${base} #${suffix}`
  }
  const theme = await prisma.theme.create({
    data: {
      name: uniqueName,
      layoutHtml,
      contentConfig: contentConfig ?? null,
      pages: {
        create: pages.map((p, i) => ({
          type: p.type,
          route: p.route ?? null,
          name: p.name,
          html: p.html,
          contentConfig: p.contentConfig ?? null,
          sortOrder: p.sortOrder ?? i,
        })),
      },
    },
    include: PAGE_INCLUDE,
  })
  return parseTheme(theme)
}

export async function deleteTheme(id: string): Promise<void> {
  await prisma.theme.delete({ where: { id } })
}

export async function updateTheme(
  id: string,
  data: { name?: string; layoutHtml?: string; contentConfig?: string | null }
): Promise<ThemeData> {
  const theme = await prisma.theme.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.layoutHtml !== undefined ? { layoutHtml: data.layoutHtml } : {}),
      ...(data.contentConfig !== undefined
        ? { contentConfig: data.contentConfig }
        : {}),
    },
    include: PAGE_INCLUDE,
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
  const withPages = await prisma.theme.findUnique({
    where: { id: theme.id },
    include: PAGE_INCLUDE,
  })
  if (withPages) return parseTheme(withPages)
  return {
    id: theme.id,
    name: theme.name,
    layoutHtml: theme.layoutHtml,
    contentConfig: parseContentConfig(theme.contentConfig),
    isActive: theme.isActive,
    createdAt: theme.createdAt,
    updatedAt: theme.updatedAt,
    pages: [],
  }
}

/** Upsert 一个页面行（type+route 唯一）。 */
export async function upsertThemePage(
  themeId: string,
  input: ThemePageInput
): Promise<ThemePageData> {
  const route = input.route ?? null
  // route 为 null 时，Prisma 的联合唯一（themeId_type_route）无法用 upsert 匹配，
  // 否则会因 null 参与唯一判断而抛错。改为 findFirst + update/create。
  const existing = await prisma.themePage.findFirst({
    where: { themeId, type: input.type, route },
  })
  const data: Parameters<typeof prisma.themePage.create>[0]["data"] = {
    themeId,
    type: input.type,
    route,
    name: input.name,
    html: input.html,
    contentConfig: input.contentConfig ?? null,
    sortOrder: input.sortOrder ?? existing?.sortOrder ?? 0,
  }
  const page = existing
    ? await prisma.themePage.update({ where: { id: existing.id }, data })
    : await prisma.themePage.create({ data })
  return parsePage(page)
}

export async function deleteThemePage(id: string): Promise<void> {
  await prisma.themePage.delete({ where: { id } })
}