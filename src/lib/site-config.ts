import { prisma } from "./db"
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

export { EDITABLE_KEYS }
