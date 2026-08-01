export interface FieldDef {
  label: string
  description?: string
  readonly?: boolean
}

export const GLOBAL_FIELDS = {
  "blog-title": {
    label: "博客标题",
    description: "显示在博客顶部和浏览器标签的标题",
  },
  "blog-subtitle": { label: "博客副标题", description: "显示在标题下方" },
  "site-description": { label: "站点描述", description: "用于 SEO 的站点描述" },
  "author-name": { label: "作者名" },
  "author-bio": { label: "作者简介" },
  "copyright": { label: "版权声明" },
  "footer-text": { label: "页脚文字" },
  "site-url": { label: "站点链接", description: "博客的完整 URL" },
} as const

export const STAT_FIELDS = {
  "total-views": { label: "总访问量", statKey: "totalViews" },
  "total-articles": { label: "文章数", statKey: "totalArticles" },
  "total-likes": { label: "总点赞数", statKey: "totalLikes" },
} as const

export type GlobalFieldKey = keyof typeof GLOBAL_FIELDS
export type StatFieldKey = keyof typeof STAT_FIELDS

export const STAT_KEYS = Object.keys(STAT_FIELDS) as StatFieldKey[]

export const FIELD_DEFINITIONS: Record<string, FieldDef> = {
  ...GLOBAL_FIELDS,
  ...Object.fromEntries(
    Object.entries(STAT_FIELDS).map(([key, def]) => [
      key,
      { label: def.label, readonly: true },
    ])
  ),
}

export const EDITABLE_KEYS = new Set<string>(Object.keys(GLOBAL_FIELDS))
