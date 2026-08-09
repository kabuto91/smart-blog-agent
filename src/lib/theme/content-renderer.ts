import { JSDOM } from "jsdom"
import type { ContentConfig, DynamicField, NavField, TextField } from "../types/content-config"
import { FIELD_DEFINITIONS } from "../field-registry"

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

export interface PaginationData {
  page: number
  totalPages: number
  basePath: string
}

export interface DynamicData {
  articles?: ArticleData[]
  categories?: CategoryData[]
  tags?: TagData[]
  pagination?: PaginationData
}

export interface RenderOptions {
  /**
   * 拆分式主题渲染：页面正文已按类型独立成片段（由生成管线负责剪枝），
   * 渲染时不再运行按 data-page-type / hero 正则猜测的启发式剪枝，
   * 避免误删正文内容造成与骨架样式冲突。
   */
  pageSpecific?: boolean
}

export function renderContent(
  htmlTemplate: string,
  contentConfig: ContentConfig,
  dynamicData?: DynamicData,
  siteConfig?: Record<string, string>,
  options?: RenderOptions
): string {
  const dom = new JSDOM(htmlTemplate)
  const doc = dom.window.document

  const fields = { ...contentConfig }
  augmentGlobalFields(doc, fields, siteConfig)

  for (const [key, field] of Object.entries(fields)) {
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

  const pageType = resolvePageType(dynamicData)

  for (const el of Array.from(doc.querySelectorAll("[data-route]"))) {
    el.remove()
  }

  if (!options?.pageSpecific) {
    prunePageRegions(doc, pageType)

    if (pageType === "detail") {
      pruneDetailPage(doc)
    }

    if (pageType === "list" || pageType === "detail") {
      pruneHomeSections(doc)
    }
  }

  applyAvatarOverflow(doc)

  return dom.serialize()
}

export type PageType = "home" | "list" | "detail"

export function resolvePageType(dynamicData?: DynamicData): PageType {
  if (dynamicData?.articles?.[0]?.contentHtml) return "detail"
  if (dynamicData?.pagination) return "list"
  return "home"
}

function pageTypesOf(el: Element): string[] {
  return (el.getAttribute("data-page-type") ?? "")
    .split(/\s+/)
    .filter(Boolean)
}

export function prunePageRegions(doc: Document, pageType: PageType): void {  for (const el of Array.from(doc.querySelectorAll("[data-page-type]"))) {
    const types = pageTypesOf(el)
    if (types.length > 0 && !types.includes(pageType)) {
      el.remove()
    }
  }

  if (pageType !== "home") {
    for (const el of Array.from(doc.querySelectorAll("[data-home-only]"))) {
      el.remove()
    }
  }
}

const HOME_SECTION_CLASS_RE = /(^|[\s_\-])(hero|banner|intro)([\s_\-])?/i
const ARCHIVE_CTA_RE = /(更多文章|查看全部|查看所有|全部文章|全部博文|查看更多)/
const RECENT_HEADING_RE = /(近期文章|最新文章|最近文章|最新发布)/

export function pruneHomeSections(doc: Document): void {
  for (const el of Array.from(
    doc.querySelectorAll("section, div, aside, header")
  )) {
    if (el.hasAttribute("data-page-type")) continue
    const tag = el.tagName.toLowerCase()
    if (tag === "header") continue
    const cls = el.getAttribute("class") ?? ""
    const id = el.getAttribute("id") ?? ""
    if (!HOME_SECTION_CLASS_RE.test(cls) && !HOME_SECTION_CLASS_RE.test(id)) {
      continue
    }
    if (isInside(el, "nav") || isInside(el, "footer")) continue
    if (el.querySelector('[data-content-type="dynamic-articles"]')) continue
    el.remove()
  }

  for (const a of Array.from(doc.querySelectorAll("a"))) {
    const href = a.getAttribute("href") ?? ""
    const isArchiveLink =
      href === "/blog/archive" ||
      href === "/archive" ||
      href.endsWith("/blog/archive") ||
      href.endsWith("/archive")
    if (!isArchiveLink) continue
    if (!ARCHIVE_CTA_RE.test(a.textContent ?? "")) continue
    if (isInside(a, "nav") || isInside(a, "footer")) continue
    removeWithEmptyWrapper(a)
  }

  const listContainer = doc.querySelector(
    '[data-content-type="dynamic-articles"]'
  )
  if (listContainer) {
    let parent = listContainer.parentElement
    while (
      parent &&
      parent.tagName.toLowerCase() !== "body" &&
      parent.tagName.toLowerCase() !== "html"
    ) {
      const heading = findRecentHeading(parent)
      if (heading) removeWithEmptyWrapper(heading)
      parent = parent.parentElement
    }
  }
}

function findRecentHeading(parent: Element): Element | null {
  for (const child of Array.from(parent.children) as Element[]) {
    if (child.hasAttribute("data-page-type")) continue
    if (child.querySelector("[data-content]")) continue
    const text = child.textContent ?? ""
    if (!RECENT_HEADING_RE.test(text)) continue
    const heading = findHeadingLike(child)
    if (heading) return heading
  }
  return null
}

function findHeadingLike(root: Element): Element | null {
  const tag = root.tagName.toLowerCase()
  const cls = root.getAttribute("class") ?? ""
  const id = root.getAttribute("id") ?? ""
  const selfLike =
    /^h[1-6]$/.test(tag) ||
    /(label|title|heading)/i.test(cls) ||
    /(label|title|heading)/i.test(id)
  if (selfLike) return root
  return (
    root.querySelector(
      "h1,h2,h3,h4,h5,h6,[class*='label'],[class*='title'],[class*='heading']"
    ) ?? null
  )
}

function isInside(el: Element, selector: string): boolean {
  return !!el.closest(selector)
}

function removeWithEmptyWrapper(el: Element): void {
  let node: Element | null = el
  while (node) {
    const parent: Element | null = node.parentElement
    node.remove()
    if (!parent) break
    if (parent.hasAttribute("data-content")) break
    const tag = parent.tagName.toLowerCase()
    if (tag === "body" || tag === "html") break
    if (parent.children.length > 0) break
    if ((parent.textContent ?? "").trim() !== "") break
    node = parent
  }
}

function isChromeElement(el: Element): boolean {
  const tag = el.tagName.toLowerCase()
  if (tag === "header" || tag === "footer" || tag === "nav") return true
  return pageTypesOf(el).includes("detail")
}

export function pruneDetailPage(doc: Document): void {
  const bodyEl = doc.querySelector('[data-content="article-body"]')
  if (!bodyEl) return

  for (const aside of Array.from(doc.querySelectorAll("aside"))) {
    if (!isChromeElement(aside)) aside.remove()
  }

  let node: Element | null = bodyEl
  while (node && node.parentElement) {
    const parent: Element = node.parentElement as Element
    const tag = parent.tagName.toLowerCase()
    if (tag === "body" || tag === "html") break
    for (const child of Array.from(parent.children) as Element[]) {
      if (child !== node && !isChromeElement(child)) child.remove()
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

function augmentGlobalFields(
  doc: Document,
  contentConfig: ContentConfig,
  siteConfig?: Record<string, string>
): void {
  if (!siteConfig) return
  for (const [key, value] of Object.entries(siteConfig)) {
    if (!value) continue
    if (contentConfig[key]) continue
    const el = doc.querySelector(`[data-content="${key}"]`)
    if (!el) continue
    const def = FIELD_DEFINITIONS[key]
    contentConfig[key] = {
      type: "text",
      label: def?.label ?? key,
      value,
      source: def?.readonly ? "readonly" : "global",
      globalKey: key,
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
  const els = Array.from(doc.querySelectorAll(`[data-content="${key}"]`))
  if (els.length === 0) return

  for (const el of els) {
    let img: HTMLImageElement | null = null
    if (el.tagName.toLowerCase() === "img") {
      img = el as HTMLImageElement
    } else {
      const first = el.firstElementChild
      if (first && first.tagName.toLowerCase() === "img") {
        img = first as HTMLImageElement
      }
    }

    if (img) {
      if (value) img.setAttribute("src", value)
      continue
    }

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

  let isArticlesList = false
  let data: { [key: string]: string }[]
  switch (field.type) {
    case "dynamic-articles": {
      const isDetail = !!dynamicData.articles?.[0]?.contentHtml
      if (isDetail) {
        removeListRegion(container)
        return
      }
      isArticlesList = true
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

  if (
    isArticlesList &&
    dynamicData.pagination &&
    dynamicData.pagination.totalPages > 1
  ) {
    container.insertAdjacentHTML(
      "beforeend",
      buildPaginationNav(dynamicData.pagination)
    )
  }
}

function buildPaginationNav(pagination: PaginationData): string {
  const { page, totalPages, basePath } = pagination
  const hrefFor = (p: number) => (p <= 1 ? basePath : `${basePath}?page=${p}`)
  const baseStyle =
    "display:inline-flex;align-items:center;justify-content:center;min-width:2rem;height:2rem;padding:0 0.5rem;border:1px solid rgba(0,0,0,0.12);border-radius:0.375rem;color:#1C1C1E;text-decoration:none;font-size:0.875rem;box-sizing:border-box;"
  const currentStyle =
    baseStyle + "background:#E5A83D;border-color:#E5A83D;color:#181A1E;font-weight:600;"
  const disabledStyle = "color:#9CA3AF;pointer-events:none;"

  const links: string[] = []
  links.push(
    `<a href="${hrefFor(page - 1)}" style="${baseStyle}${page <= 1 ? disabledStyle : ""}">上一页</a>`
  )
  for (let p = 1; p <= totalPages; p++) {
    const style = p === page ? currentStyle : baseStyle
    links.push(`<a href="${hrefFor(p)}" style="${style}">${p}</a>`)
  }
  links.push(
    `<a href="${hrefFor(page + 1)}" style="${baseStyle}${page >= totalPages ? disabledStyle : ""}">下一页</a>`
  )
  return `<nav style="display:flex;gap:0.375rem;flex-wrap:wrap;justify-content:center;align-items:center;margin-top:1.5rem;">${links.join("")}</nav>`
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
