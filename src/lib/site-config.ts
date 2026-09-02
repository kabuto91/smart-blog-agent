import { prisma } from "./db/client"
import { encrypt, decrypt } from "./crypto"
import { EDITABLE_KEYS, STAT_KEYS, STAT_FIELDS } from "./field-registry"

export async function getSiteConfig(): Promise<Record<string, string>> {
  const config: Record<string, string> = {}
  for (const key of EDITABLE_KEYS) {
    config[key] = ""
  }

  try {
    const row = await prisma.siteConfig.findUnique({ where: { id: 1 } })
    if (row?.config) {
      const saved = JSON.parse(row.config)
      for (const key of Object.keys(saved)) {
        if (EDITABLE_KEYS.has(key)) {
          config[key] = saved[key]
        }
      }
    }
  } catch {
    // table may not exist yet
  }

  try {
    const stats = await prisma.siteStats.upsert({
      where: { id: 1 },
      create: { id: 1 },
      update: {},
    })
    for (const key of STAT_KEYS) {
      config[key] = String(stats[STAT_FIELDS[key].statKey])
    }
  } catch {
    // table may not exist yet
  }

  return config
}

export async function updateSiteConfig(
  config: Record<string, string>
): Promise<void> {
  const filtered: Record<string, string> = {}
  for (const key of EDITABLE_KEYS) {
    if (config[key] !== undefined) {
      filtered[key] = config[key]
    }
  }
  await prisma.siteConfig.upsert({
    where: { id: 1 },
    create: { id: 1, config: JSON.stringify(filtered) },
    update: { config: JSON.stringify(filtered) },
  })
}

/** site_config.config 中精选文章 ID 列表（string[]）的键。刻意不进 EDITABLE_KEYS，避免污染站点设置文本表单。 */
export const FEATURED_ARTICLES_KEY = "featuredArticleIds"

/** 读取后台配置的精选文章 ID 列表（按保存顺序）。 */
export async function getFeaturedArticleIds(): Promise<string[]> {
  try {
    const row = await prisma.siteConfig.findUnique({ where: { id: 1 } })
    const raw = row?.config
      ? (JSON.parse(row.config)[FEATURED_ARTICLES_KEY] as unknown)
      : undefined
    if (Array.isArray(raw)) return [...new Set(raw)].filter((x) => typeof x === "string")
  } catch {
    // table may not exist yet
  }
  return []
}

/** 保存精选文章 ID 列表（合并写入 site_config.config，不影响其它字段）。 */
export async function saveFeaturedArticleIds(ids: string[]): Promise<void> {
  const row = await prisma.siteConfig.findUnique({ where: { id: 1 } })
  const current = row?.config ? (JSON.parse(row.config) as Record<string, unknown>) : {}
  current[FEATURED_ARTICLES_KEY] = [...new Set(ids)]
  await prisma.siteConfig.upsert({
    where: { id: 1 },
    create: { id: 1, config: JSON.stringify(current) },
    update: { config: JSON.stringify(current) },
  })
}

/** site_config.config 中用户画像文本的键。刻意不进 EDITABLE_KEYS，避免污染站点设置文本表单。 */
export const USER_PROFILE_KEY = "userProfile"

/** site_config.config 中「生成时注入用户画像」开关的键。 */
export const USER_PROFILE_ENABLED_KEY = "userProfileEnabled"

/** 读取用户画像文本与注入开关。 */
export async function getUserProfile(): Promise<{
  profile: string
  enabled: boolean
}> {
  try {
    const row = await prisma.siteConfig.findUnique({ where: { id: 1 } })
    const raw = row?.config
      ? (JSON.parse(row.config) as Record<string, unknown>)
      : {}
    return {
      profile: typeof raw[USER_PROFILE_KEY] === "string" ? raw[USER_PROFILE_KEY] : "",
      enabled: raw[USER_PROFILE_ENABLED_KEY] !== false,
    }
  } catch {
    // table may not exist yet
  }
  return { profile: "", enabled: true }
}

/** 保存用户画像文本与注入开关（合并写入 site_config.config，不影响其它字段）。 */
export async function saveUserProfile(
  profile: string,
  enabled: boolean
): Promise<void> {
  const row = await prisma.siteConfig.findUnique({ where: { id: 1 } })
  const current = row?.config ? (JSON.parse(row.config) as Record<string, unknown>) : {}
  current[USER_PROFILE_KEY] = profile
  current[USER_PROFILE_ENABLED_KEY] = enabled
  await prisma.siteConfig.upsert({
    where: { id: 1 },
    create: { id: 1, config: JSON.stringify(current) },
    update: { config: JSON.stringify(current) },
  })
}

export { EDITABLE_KEYS }

/** site_config.config 中掘金登录 Cookie 字符串的键。刻意不进 EDITABLE_KEYS，避免污染站点设置文本表单。 */
export const JUJIN_TOKEN_KEY = "juejinToken"

/** 读取掘金登录 Cookie 字符串（解密）。 */
export async function getJuejinToken(): Promise<string> {
  try {
    const row = await prisma.siteConfig.findUnique({ where: { id: 1 } })
    const raw = row?.config
      ? (JSON.parse(row.config) as Record<string, unknown>)
      : {}
    const stored = raw[JUJIN_TOKEN_KEY]
    if (typeof stored === "string" && stored) {
      try {
        return decrypt(stored)
      } catch {
        return ""
      }
    }
  } catch {
    // table may not exist yet
  }
  return ""
}

/** 保存掘金登录 Cookie 字符串（加密写入 site_config.config，不影响其它字段）。传空串则清除。 */
export async function saveJuejinToken(token: string): Promise<void> {
  const row = await prisma.siteConfig.findUnique({ where: { id: 1 } })
  const current = row?.config ? (JSON.parse(row.config) as Record<string, unknown>) : {}
  if (token) {
    current[JUJIN_TOKEN_KEY] = encrypt(token)
  } else {
    delete current[JUJIN_TOKEN_KEY]
  }
  await prisma.siteConfig.upsert({
    where: { id: 1 },
    create: { id: 1, config: JSON.stringify(current) },
    update: { config: JSON.stringify(current) },
  })
}
