/**
 * 拉取掘金当前用户本人的全部专栏（需登录 Cookie）。
 * 用于把掘金专栏同步到本地合集（导入/绑定/推送前预览）。
 *
 * 抓包确认：POST content_api/v1/column/author_center_list
 * 入参 { audit_status, page_no, page_size }，返回 data[]：
 *   column.column_id / user_id / status / ctime
 *   column_version.title / content / cover
 */

export interface JuejinColumn {
  /** 掘金专栏唯一 id，用于绑定本地合集 */
  columnId: string
  title: string
  abstract: string | null
  /** 审核状态；与业务无关，仅为透传，便于调试 */
  status: number | null
}

const JUEJIN_COLUMN_API =
  "https://api.juejin.cn/content_api/v1/column/author_center_list"
const PAGE_SIZE = 10
const MAX_PAGES = 20

const COMMON_HEADERS = {
  "Content-Type": "application/json",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Referer: "https://juejin.cn/",
  Origin: "https://juejin.cn",
}

interface ColumnListResponse {
  err_no?: number
  err_msg?: string
  data?: Array<{
    column?: {
      column_id?: string
      user_id?: string
      status?: number | null
      ctime?: string
    }
    column_version?: {
      title?: string
      content?: string
      cover?: string
    }
  }>
  has_more?: boolean
}

/** 分页拉取本人全部掘金专栏。 */
export async function fetchOwnColumns(
  cookie: string
): Promise<JuejinColumn[]> {
  if (!cookie) {
    throw new Error("未提供掘金 Cookie")
  }

  const collected: JuejinColumn[] = []
  const seen = new Set<string>()
  let pageNo = 1
  let page = 0

  while (page < MAX_PAGES) {
    const res = await fetch(JUEJIN_COLUMN_API + "?aid=2608&spider=0", {
      method: "POST",
      headers: { ...COMMON_HEADERS, Cookie: cookie },
      body: JSON.stringify({
        audit_status: null,
        page_no: pageNo,
        page_size: PAGE_SIZE,
      }),
    })
    if (!res.ok) {
      throw new Error(`掘金专栏接口请求失败：HTTP ${res.status}`)
    }

    const json = (await res.json()) as ColumnListResponse
    if (json.err_no !== 0) {
      throw new Error(
        `掘金专栏接口返回异常：${json.err_msg || `err_no=${json.err_no}`}`
      )
    }

    const items = json.data ?? []
    for (const item of items) {
      const id = item.column?.column_id?.trim()
      const title = item.column_version?.title?.trim()
      if (!id || !title || seen.has(id)) continue
      seen.add(id)
      collected.push({
        columnId: id,
        title,
        abstract: item.column_version?.content?.trim() || null,
        status: item.column?.status ?? null,
      })
    }

    if (!items.length || !json.has_more) break
    pageNo++
    page++
  }

  return collected
}