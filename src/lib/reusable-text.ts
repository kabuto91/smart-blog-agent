import { prisma } from "./db/client"

/** 站点级可复用文本库：key → 文本内容。 */
export type ReusableTextLibrary = Record<string, string>

/** 读取站点级可复用文本库。 */
export async function getReusableTexts(): Promise<ReusableTextLibrary> {
  try {
    const row = await prisma.siteConfig.findUnique({ where: { id: 1 } })
    if (!row?.textLibrary) return {}
    return normalizeLib(JSON.parse(row.textLibrary))
  } catch {
    return {}
  }
}

function normalizeLib(raw: unknown): ReusableTextLibrary {
  const lib: ReusableTextLibrary = {}
  if (!raw || typeof raw !== "object") return lib
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string") lib[key] = value
  }
  return lib
}

async function saveLib(lib: ReusableTextLibrary): Promise<ReusableTextLibrary> {
  const clean = normalizeLib(lib)
  await prisma.siteConfig.upsert({
    where: { id: 1 },
    create: { id: 1, config: "", textLibrary: JSON.stringify(clean) },
    update: { textLibrary: JSON.stringify(clean) },
  })
  return clean
}

/** 新增或更新某个可复用文本条目。 */
export async function upsertReusableText(
  key: string,
  text: string
): Promise<ReusableTextLibrary> {
  const lib = await getReusableTexts()
  lib[key] = text
  return saveLib(lib)
}

/** 删除某个可复用文本条目。 */
export async function deleteReusableText(
  key: string
): Promise<ReusableTextLibrary> {
  const lib = await getReusableTexts()
  delete lib[key]
  return saveLib(lib)
}