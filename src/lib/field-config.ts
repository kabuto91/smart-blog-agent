export interface FieldDef {
  label: string
  description?: string
  readonly?: boolean
}

export const FIELD_DEFINITIONS: Record<string, FieldDef> = {
  "blog-title":     { label: "博客标题",     description: "显示在博客顶部和浏览器标签的标题" },
  "blog-subtitle":  { label: "博客副标题",   description: "显示在标题下方" },
  "site-description": { label: "站点描述",   description: "用于 SEO 的站点描述" },
  "author-name":    { label: "作者名" },
  "copyright":      { label: "版权声明" },
  "footer-text":    { label: "页脚文字" },
  "site-url":       { label: "站点链接",     description: "博客的完整 URL" },

  "total-views":    { label: "总访问量",     readonly: true },
  "total-articles": { label: "文章数",       readonly: true },
  "total-likes":    { label: "总点赞数",     readonly: true },
}

export const EDITABLE_KEYS = new Set(
  Object.entries(FIELD_DEFINITIONS)
    .filter(([, def]) => !def.readonly)
    .map(([key]) => key)
)
