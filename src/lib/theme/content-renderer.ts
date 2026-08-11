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

  ensureMultipleAvatarPlaces(doc, siteConfig?.["author-avatar"])
  applyAvatarOverflow(doc, siteConfig?.["author-avatar"])
  fillGradientAvatarPlaceholders(doc, siteConfig?.["author-avatar"])

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

/**
 * 兜底：确保页面正文区域（[data-page-host]）中至少有一处头像显示。
 * 导航栏的头像由骨架/SKELETON_SYSTEM_PROMPT 保证，但页面正文区域（hero/作者简介/文章底部）
 * 的头像依赖 LLM 生成，不一定存在。此函数在渲染完成后检测正文区域，
 * 若无任何头像标记则自动注入，保证所有页面都至少显示作者头像。
 */
export function ensureMultipleAvatarPlaces(doc: Document, avatarUrl?: string): void {
  if (!avatarUrl) return

  const host = doc.querySelector<HTMLElement>("[data-page-host]")
  if (!host) return

  // 检查正文区域内是否已有头像元素
  const hasAvatarInBody =
    host.querySelector('[data-content="author-avatar"]') ||
    host.querySelector("img.avatar") ||
    host.querySelector("img[class*='avatar']") ||
    Array.from(host.querySelectorAll<HTMLElement>("[class]")).some((el) =>
      (el.getAttribute("class") || "").toLowerCase().includes("avatar")
    )

  if (hasAvatarInBody) return

  // 按优先级寻找注入位置：<aside> > 含 author/bio/sidebar 的容器 > 正文首部
  const targets = [
    host.querySelector("aside"),
    host.querySelector<HTMLElement>(
      "[class*='author'], [class*='bio'], [class*='sidebar'], [class*='widget'], [class*='about']"
    ),
  ]
  const target = targets.find(Boolean)

  const avatarHtml = `<img class="avatar" src="${avatarUrl}" alt="作者头像" style="width:64px;height:64px;border-radius:50%;object-fit:cover;overflow:hidden;">`

  if (target) {
    target.insertAdjacentHTML("afterbegin", avatarHtml)
  } else {
    // 兜底：插入到正文容器最前面
    host.insertAdjacentHTML("afterbegin", avatarHtml)
  }
}

/**
 * 兜底：把「圆形 + 渐变背景」的纯 CSS 头像占位（无 <img>、无 data-content）
 * 用上传的作者头像填充，覆盖生成器只愿用渐变圆圈的情况。
 */
function fillGradientAvatarPlaceholders(
  doc: Document,
  avatarUrl?: string
): void {
  if (!avatarUrl) return
  for (const el of Array.from(doc.querySelectorAll<HTMLElement>("div, span"))) {
    if (el.hasAttribute("data-content")) continue
    if (el.querySelector("img")) continue
    if (el.closest('[data-content="article-body"]')) continue
    if ((el.textContent ?? "").trim() !== "") continue
    const style = (el.getAttribute("style") ?? "")
      .replace(/\s/g, "")
      .toLowerCase()
    if (!style) continue
    const isRound =
      /(?:^|;)border-radius:\s*(?:var\(--radius-full\)|50%|100%|9999px)(?:;|$)/.test(
        style
      )
    if (!isRound) continue
    if (!/(linear|radial)-gradient/.test(style)) continue
    const w = /(?:^|;)width:(\d+(?:\.\d+)?)px(?:;|$)/.exec(style)
    const h = /(?:^|;)height:(\d+(?:\.\d+)?)px(?:;|$)/.exec(style)
    if (!w || !h) continue
    const width = Number(w[1])
    const height = Number(h[1])
    if (Math.abs(width - height) > 1) continue
    if (width < 24 || width > 200) continue
    el.style.backgroundImage = `url("${avatarUrl}")`
    el.style.backgroundSize = "cover"
    el.style.backgroundPosition = "center"
    el.style.backgroundRepeat = "no-repeat"
  }
}

function applyAvatarOverflow(doc: Document, avatarUrl?: string): void {
  const elements = Array.from(doc.querySelectorAll<HTMLElement>("[class]")).filter((el) =>
    (el.getAttribute("class") || "").toLowerCase().includes("avatar")
  )

  for (const el of elements) {
    const isImgEl = el.tagName.toLowerCase() === "img"
    el.style.overflow = "hidden"
    const img = isImgEl
      ? null
      : el.querySelector<HTMLImageElement>("img")
    if (isImgEl) {
      const self = el as HTMLImageElement
      self.style.objectFit = "cover"
      self.style.display = "block"
      if (avatarUrl && !el.hasAttribute("data-content")) {
        self.setAttribute("src", avatarUrl)
      }
    } else if (img) {
      img.style.width = "100%"
      img.style.height = "100%"
      img.style.objectFit = "cover"
      img.style.display = "block"
      if (avatarUrl && !el.hasAttribute("data-content")) {
        img.setAttribute("src", avatarUrl)
      }
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

  // 兜底：处理全局字段的衍生 key（如 author-avatar-2），
  // 使其继承主 key 的值，避免 LLM 生成的重复占位无法被填充
  for (const [baseKey, value] of Object.entries(siteConfig)) {
    if (!value) continue
    if (!FIELD_DEFINITIONS[baseKey]) continue
    const els = doc.querySelectorAll(`[data-content^="${baseKey}-"]`)
    for (const el of Array.from(els)) {
      const key = el.getAttribute("data-content")!
      const existing = contentConfig[key] as TextField | undefined
      // 已有非空值则保留，否则用主 key 的值覆盖
      if (existing && existing.type === "text" && existing.value) continue
      contentConfig[key] = {
        type: "text",
        label: key,
        value,
        source: "global",
        globalKey: baseKey,
      }
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

  for (let idx = 0; idx < els.length; idx++) {
    const el = els[idx]

    // 判断是否为 img 元素（或包含 img 子元素）
    let img: HTMLImageElement | null = null
    if (el.tagName.toLowerCase() === "img") {
      img = el as HTMLImageElement
    } else {
      const first = el.firstElementChild
      if (first && first.tagName.toLowerCase() === "img") {
        img = first as HTMLImageElement
      }
    }

    // 跳过属于 nav-list 容器的文字元素，避免覆盖导航标签；img 元素（如头像）不受影响
    if (!img && el.closest('[data-content-type="nav-list"]')) {
      continue
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
  if (!container) return

  if (field.type === "dynamic-list") {
    renderCustomListField(container, field)
    return
  }

  if (!dynamicData) return

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

function renderCustomListField(container: Element, field: DynamicField): void {
  const items = field.items ?? []
  if (items.length === 0) return

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

  const labelKey = Object.keys(field.fieldMapping)[0] ?? "name"

  for (const item of items) {
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

  const renderedItems = (item: { label: string; href: string }): string =>
    field.itemTemplate
      .replace("{href}", item.href)
      .replace("{label}", item.label)

  for (const nav of navs) {
    const host = findNavListHost(nav)
    const isListHost = host && host.matches("ul, ol")

    const target = host ?? nav
    target.innerHTML = ""

    if (!templateEl) {
      target.innerHTML = field.items.map(renderedItems).join("")
      continue
    }

    const templateTag = templateEl.tagName.toLowerCase()
    const wrapInLi =
      isListHost && templateTag !== "li" && templateTag !== "ul" && templateTag !== "ol"

    for (const item of field.items) {
      const clone = templateEl.cloneNode(true) as Element
      const linkEl =
        clone.matches("a, [data-href]")
          ? clone
          : clone.querySelector<Element>("a[href], [data-href]")
      if (linkEl) {
        if (linkEl.hasAttribute("href")) linkEl.setAttribute("href", item.href)
        else if (linkEl.hasAttribute("data-href")) linkEl.setAttribute("data-href", item.href)
        linkEl.textContent = item.label
      } else {
        clone.textContent = `${item.label}`
      }
      if (wrapInLi) {
        const li = doc.createElement("li")
        li.appendChild(clone)
        target.appendChild(li)
      } else {
        target.appendChild(clone)
      }
    }
  }
}

/** 找到导航里的"链接列表容器"：优先匹配 class 语义（nav-links/nav-menu/menu），再退回 ul/ol */
function findNavListHost(nav: Element): Element | null {
  const lists = Array.from(nav.querySelectorAll("ul, ol"))
  const byClass = lists.find((l) =>
    /(^|[-_\s])(nav-links|nav-menu|nav_list|menu|links|list)([-_\s]|$)/i.test(
      (l.getAttribute("class") ?? "") + " " + (l.id ?? "")
    )
  )
  if (byClass) return byClass
  const byLinks = lists.find((l) => l.querySelector("[href], [data-href]"))
  return byLinks ?? null
}
