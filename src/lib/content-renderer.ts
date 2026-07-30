import { JSDOM } from "jsdom"
import type { ContentConfig, DynamicField, NavField, TextField } from "./types/content-config"

export interface ArticleData {
  id: string | number
  title: string
  excerpt: string
  date: string
  category?: string
  slug: string
}

export interface CategoryData {
  id: string | number
  name: string
  slug: string
  count?: number
}

export interface TagData {
  id: string | number
  name: string
  slug: string
}

export interface DynamicData {
  articles?: ArticleData[]
  categories?: CategoryData[]
  tags?: TagData[]
}

export function renderContent(
  htmlTemplate: string,
  contentConfig: ContentConfig,
  dynamicData?: DynamicData,
  siteConfig?: Record<string, string>
): string {
  const dom = new JSDOM(htmlTemplate)
  const doc = dom.window.document

  for (const [key, field] of Object.entries(contentConfig)) {
    if (field.type === "text") {
      const value = resolveTextValue(field, siteConfig)
      renderTextField(doc, key, value)
    } else if (field.type.startsWith("dynamic-")) {
      renderDynamicField(doc, key, field as DynamicField, dynamicData)
    } else if (field.type === "nav-list") {
      renderNavField(doc, key, field as NavField)
    }
  }

  return dom.serialize()
}

function resolveTextValue(
  field: TextField,
  siteConfig?: Record<string, string>
): string {
  if (field.source === "global" && field.globalKey && siteConfig?.[field.globalKey] !== undefined) {
    return siteConfig[field.globalKey]
  }
  return field.value
}

function renderTextField(doc: Document, key: string, value: string): void {
  const el = doc.querySelector(`[data-content="${key}"]`)
  if (el) {
    el.textContent = value
  }
}

function renderDynamicField(
  doc: Document,
  key: string,
  field: DynamicField,
  dynamicData?: DynamicData
): void {
  const container = doc.querySelector(`[data-content="${key}"]`)
  if (!container || !dynamicData) return

  let data: { [key: string]: string }[]
  switch (field.type) {
    case "dynamic-articles":
      data = (dynamicData.articles ?? []).map((a) => ({
        title: a.title,
        excerpt: a.excerpt,
        date: a.date,
        category: a.category ?? "",
        link: `/${a.slug}`,
      }))
      break
    case "dynamic-categories":
      data = (dynamicData.categories ?? []).map((c) => ({
        name: c.name,
        link: `/category/${c.slug}`,
        count: String(c.count ?? 0),
      }))
      break
    case "dynamic-tags":
      data = (dynamicData.tags ?? []).map((t) => ({
        name: t.name,
        link: `/tag/${t.slug}`,
      }))
      break
    default:
      return
  }

  if (data.length === 0) return

  const templateHtml = field.itemTemplate
  if (!templateHtml) return

  const tempDoc = new JSDOM(templateHtml).window.document
  const templateEl = tempDoc.body.firstElementChild
  if (!templateEl) return

  container.innerHTML = ""

  for (const item of data) {
    const clone = templateEl.cloneNode(true) as Element
    for (const [mapKey] of Object.entries(field.fieldMapping)) {
      const target = clone.querySelector(`[data-map="${mapKey}"]`)
      if (!target) continue
      const value = item[mapKey]
      if (value !== undefined) {
        target.textContent = value
      }
    }
    container.appendChild(clone)
  }
}

function renderNavField(doc: Document, key: string, field: NavField): void {
  const nav = doc.querySelector(`[data-content="${key}"]`)
  if (!nav) return

  if (field.items.length === 0) return

  const tempDoc = new JSDOM(field.itemTemplate).window.document
  const templateEl = tempDoc.body.firstElementChild
  if (!templateEl) {
    nav.innerHTML = field.items
      .map((item) => field.itemTemplate.replace("{href}", item.href).replace("{label}", item.label))
      .join("")
    return
  }

  nav.innerHTML = ""

  for (const item of field.items) {
    const clone = templateEl.cloneNode(true) as Element
    clone.setAttribute("href", item.href)
    clone.textContent = item.label
    nav.appendChild(clone)
  }
}
