import { JSDOM } from "jsdom"
import type { ContentConfig, DynamicField, NavField, TextField } from "./types/content-config"

export interface ArticleData {
  id: string | number
  title: string
  excerpt: string
  date: string
  category?: string
  slug: string
  contentHtml?: string
  tags?: string[]
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
    } else if (
      field.type.startsWith("dynamic-") ||
      field.type === "article-body"
    ) {
      renderDynamicField(doc, key, field as DynamicField, dynamicData)
    } else if (field.type === "nav-list") {
      renderNavField(doc, key, field as NavField)
    }
  }

  if (dynamicData?.articles?.[0]?.contentHtml) {
    pruneDetailPage(doc)
  }

  applyAvatarOverflow(doc)

  return dom.serialize()
}

function pruneDetailPage(doc: Document): void {
  const bodyEl = doc.querySelector('[data-content="article-body"]')
  if (!bodyEl) return

  let node: Element | null = bodyEl
  while (node && node.parentElement) {
    const parent: Element = node.parentElement as Element
    const tag = parent.tagName.toLowerCase()
    if (tag === "body" || tag === "html") break
    for (const child of Array.from(parent.children) as Element[]) {
      if (child !== node) child.remove()
    }
    node = parent
  }
}

export function ensureAvatarOverflow(html: string): string {
  const dom = new JSDOM(html)
  applyAvatarOverflow(dom.window.document)
  return dom.serialize()
}

function applyAvatarOverflow(doc: Document): void {
  const elements = Array.from(doc.querySelectorAll<HTMLElement>("[class]")).filter((el) =>
    (el.getAttribute("class") || "").toLowerCase().includes("avatar")
  )

  for (const el of elements) {
    el.style.overflow = "hidden"
    const img = el.querySelector<HTMLImageElement>("img")
    if (img) {
      img.style.width = "100%"
      img.style.height = "100%"
      img.style.objectFit = "cover"
      img.style.display = "block"
    }
  }
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
    case "dynamic-articles": {
      const isDetail = !!dynamicData.articles?.[0]?.contentHtml
      if (isDetail) {
        removeListRegion(container)
        return
      }
      data = (dynamicData.articles ?? []).map((a) => ({
        title: a.title,
        excerpt: a.excerpt,
        date: a.date,
        category: a.category ?? "",
        link: `/blog/${a.slug}`,
      }))
      break
    }
    case "article-body": {
      const article = dynamicData.articles?.[0]
      if (!article?.contentHtml) {
        container.remove()
        return
      }
      for (const el of container.querySelectorAll("[data-map]")) {
        const name = el.getAttribute("data-map")
        const value =
          name === "title"
            ? article.title
            : name === "date"
              ? article.date
              : name === "category"
                ? article.category ?? ""
                : name === "tags"
                  ? (article.tags ?? []).join(" · ")
                  : name === "meta"
                    ? [article.date, article.category, (article.tags ?? []).join(" · ")]
                        .filter(Boolean)
                        .join(" · ")
                    : undefined
        if (value !== undefined) el.textContent = value
      }
      const bodyTarget =
        container.querySelector('[data-map="body"]') ?? container
      bodyTarget.innerHTML = article.contentHtml
      return
    }
    case "dynamic-categories":
      data = (dynamicData.categories ?? []).map((c) => ({
        name: c.name,
        link: `/blog/category/${c.slug}`,
        count: String(c.count ?? 0),
      }))
      break
    case "dynamic-tags":
      data = (dynamicData.tags ?? []).map((t) => ({
        name: t.name,
        link: `/blog/tag/${t.slug}`,
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

  const mappings: [string, string][] =
    Object.keys(field.fieldMapping).length > 0
      ? Object.entries(field.fieldMapping)
      : Array.from(mappedElements(templateEl)).map((el) => {
          const name = el.getAttribute("data-map")!
          return [name, name]
        })

  const labelKey = field.type === "dynamic-articles" ? "title" : "name"

  for (const item of data) {
    const clone = templateEl.cloneNode(true) as Element

    let linkApplied = false
    for (const [mapKey, dataKey] of mappings) {
      const targets = mappedElements(clone, mapKey)
      if (targets.length === 0) continue
      const value = item[dataKey]
      if (value === undefined) continue
      if (mapKey === "link") {
        linkApplied = true
        for (const target of targets) {
          target.setAttribute("href", value)
        }
      } else {
        for (const target of targets) {
          target.textContent = value
        }
      }
    }

    if (!linkApplied && item.link) {
      if (clone.tagName.toLowerCase() === "a") {
        clone.setAttribute("href", item.link)
      } else {
        const anchors = clone.querySelectorAll("a[href]")
        if (anchors.length === 1) {
          anchors[0].setAttribute("href", item.link)
        }
      }
    }

    const labelEl = mappedElements(clone, labelKey)[0]
    if (!labelEl && item[labelKey]) {
      const linkEl = mappedElements(clone, "link")[0]
      if (linkEl) linkEl.textContent = item[labelKey]
    }

    container.appendChild(clone)
  }
}

function mappedElements(root: Element, mapKey?: string): Element[] {
  const selector = mapKey ? `[data-map="${mapKey}"]` : "[data-map]"
  if (root.matches(selector)) return [root]
  return Array.from(root.querySelectorAll(selector))
}

function removeListRegion(container: Element): void {
  const parent = container.parentElement
  container.remove()
  if (!parent) return
  const tag = parent.tagName.toLowerCase()
  if (tag === "main" || tag === "body" || tag === "html") return
  const hasContentChild = Array.from(parent.children).some((child) =>
    child.hasAttribute("data-content")
  )
  if (!hasContentChild) parent.remove()
}

function renderNavField(doc: Document, key: string, field: NavField): void {
  const navs = doc.querySelectorAll(`[data-content="${key}"]`)
  if (navs.length === 0 || field.items.length === 0) return

  const tempDoc = new JSDOM(field.itemTemplate).window.document
  const templateEl = tempDoc.body.firstElementChild

  if (!templateEl) {
    const rendered = field.items
      .map((item) => field.itemTemplate.replace("{href}", item.href).replace("{label}", item.label))
      .join("")
    for (const nav of navs) {
      nav.innerHTML = rendered
    }
    return
  }

  for (const nav of navs) {
    nav.innerHTML = ""

    for (const item of field.items) {
      const clone = templateEl.cloneNode(true) as Element
      if (clone.tagName.toLowerCase() === "a") {
        clone.setAttribute("href", item.href)
      } else if (clone.hasAttribute("data-href")) {
        clone.setAttribute("data-href", item.href)
      }
      clone.textContent = item.label
      nav.appendChild(clone)
    }
  }
}
