/**
 * 抓取掘金全部官方标签（tag_api 分页接口，无需登录）。
 * 用于把掘金平台的标签库同步到本地 tags 表。
 */

export interface JuejinTag {
  /** 掘金官方 tag_id（数字字符串），可用于去重。 */
  tagId: string
  name: string
}

const JUEJIN_TAG_API =
  "https://api.juejin.cn/tag_api/v1/query_tag_list?aid=2608&spider=0"
const PAGE_SIZE = 100
const MAX_PAGES = 50

const COMMON_HEADERS = {
  "Content-Type": "application/json",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Referer: "https://juejin.cn/",
  Origin: "https://juejin.cn",
}

interface TagListResponse {
  err_no?: number
  err_msg?: string
  data?: Array<{
    tag_id?: string
    tag?: { tag_name?: string }
  }>
  cursor?: string
  count?: number
  has_more?: boolean
}

/** 分页拉取掘金全部官方标签，返回去重后的标签数组（含 tagId）。 */
export async function fetchAllJuejinTags(): Promise<JuejinTag[]> {
  const collected: JuejinTag[] = []
  const seen = new Set<string>()
  let cursor = "0"
  let page = 0

  while (page < MAX_PAGES) {
    const res = await fetch(JUEJIN_TAG_API, {
      method: "POST",
      headers: COMMON_HEADERS,
      body: JSON.stringify({ cursor, limit: PAGE_SIZE }),
    })
    if (!res.ok) {
      throw new Error(`掘金标签接口请求失败：HTTP ${res.status}`)
    }

    const json = (await res.json()) as TagListResponse
    if (json.err_no !== 0) {
      throw new Error(
        `掘金标签接口返回异常：${json.err_msg || `err_no=${json.err_no}`}`
      )
    }

    const items = json.data ?? []
    for (const item of items) {
      const name = item.tag?.tag_name?.trim()
      if (!name || seen.has(name)) continue
      seen.add(name)
      collected.push({
        tagId: item.tag_id ?? "",
        name,
      })
    }

    if (!json.has_more) break
    cursor = json.cursor ?? ""
    if (!cursor) break
    page++
  }

  return collected
}