import { JSDOM } from "jsdom"
import type { ContentConfig, TextField, DynamicField, NavField, CustomListItem } from "../types/content-config"
import { FIELD_DEFINITIONS } from "../field-registry"

const KNOWN_DYNAMIC_TYPES = new Set([
  "dynamic-articles",
  "dynamic-categories",
  "dynamic-tags",
  "article-body",
])

export interface ExtractionResult {
  htmlTemplate: string
  contentConfig: ContentConfig
}

/** 只提取导航（nav-list）字段，用于给缺失导航配置的主题补齐可配置入口。 */
export function extractNavConfig(html: string): Record<string, NavField> {
  const { contentConfig } = extractContentConfig(html)
  const nav: Record<string, NavField> = {}
  for (const [key, field] of Object.entries(contentConfig)) {
    if (field.type === "nav-list") nav[key] = field as NavField
  }
  return nav
}

/**
 * 补齐配置中缺失的导航字段：布局 HTML 里存在、但 config 中没有 nav-list 的
 * 导航（main-nav/footer-nav 等）会用布局里的链接回填，已有导航保持不动。
 */
export function mergeMissingNav(
  config: ContentConfig | undefined | null,
  layoutHtml: string
): ContentConfig | null {
  const merged = { ...(config ?? {}) }
  const navFields = extractNavConfig(layoutHtml)
  let changed = false
  for (const [key, fresh] of Object.entries(navFields)) {
    const existing = merged[key] as NavField | undefined
    if (existing?.type === "nav-list") {
      // 已有导航保持不动，除非是被品牌模板污染而展平的损坏配置
      if (!isFlattenedNav(existing, fresh)) continue
      merged[key] = fresh
      changed = true
      continue
    }
    merged[key] = fresh
    changed = true
  }
  return changed ? merged : (config ?? null)
}

/**
 * 自修复已损坏的导航配置：旧版本把展示品牌（logo + data-content 标题）也当成了
 * nav 项（itemTemplate 往往是 .nav-brand 模板、items 含站点标题），导致渲染时导航
 * 结构被展平、样式失效。这里用布局里重新提取的 nav-list 覆盖"结构错误"的旧配置。
 */
export function repairBrokenNav(
  config: ContentConfig | undefined | null,
  layoutHtml: string
): ContentConfig | null {
  const merged = { ...(config ?? {}) }
  const navFields = extractNavConfig(layoutHtml)
  let changed = false
  for (const [key, fresh] of Object.entries(navFields)) {
    const existing = merged[key] as NavField | undefined
    if (existing?.type !== "nav-list") continue
    if (!isFlattenedNav(existing, fresh)) continue
    merged[key] = fresh
    changed = true
  }
  return changed ? merged : (config ?? null)
}

/** 判断已有 nav 配置是否被展平（结构与布局中重新提取的一致时应保留，避免覆盖用户编辑）。 */
function isFlattenedNav(existing: NavField, fresh: NavField): boolean {
  const freshTags = /<(ul|ol|li)\b/i.test(fresh.itemTemplate)
  const existingTags = /<(ul|ol|li)\b/i.test(existing.itemTemplate)
  // 布局里有列表结构但配置模板是纯 <a>（展平标志），且模板被品牌标记污染才视为损坏
  if (freshTags && !existingTags && isBrandTemplate(existing.itemTemplate)) return true
  // items 里混入了站点标题类文本、且与布局品牌链接一致
  const brandTexts = extractBrandTexts(fresh.itemTemplate)
  if (
    brandTexts.length > 0 &&
    existing.items.some((it) => brandTexts.includes(it.label))
  ) {
    return true
  }
  return false
}

/** 导航项模板是否混入了品牌标记（.nav-brand / .logo / data-content 字段）。 */
function isBrandTemplate(itemTemplate: string): boolean {
  return /\bnav-brand\b|\blogo\b|\bdata-content\s*=/i.test(itemTemplate)
}

function extractBrandTexts(itemTemplate: string): string[] {
  if (!/\bnav-brand\b|\blogo\b/i.test(itemTemplate)) return []
  const dom = new JSDOM(itemTemplate)
  const els = dom.window.document.querySelectorAll("[data-content]")
  return Array.from(els)
    .map((el) => el.textContent?.trim() ?? "")
    .filter(Boolean)
}

export function extractContentConfig(
  html: string,
  siteConfig?: Record<string, string>
): ExtractionResult {
  const dom = new JSDOM(html)
  const doc = dom.window.document
  const config: ContentConfig = {}
  const usedKeys = new Set<string>()

  // 兜底：先给 LLM 漏标的标题/段落补 data-content 标记，再统一提取
  markUnmarkedTextUnits(doc)

  const elements = doc.querySelectorAll("[data-content]")
  for (const el of elements) {
    const key = el.getAttribute("data-content")
    const type = el.getAttribute("data-content-type")
    if (!key || !type) continue

    const unique = uniqueKey(key, usedKeys)
    if (unique !== key) {
      el.setAttribute("data-content", unique)
    }
    usedKeys.add(unique)

    if (type === "text") {
      config[unique] = extractTextField(el, unique, siteConfig)
    } else if (type.startsWith("dynamic-") || type === "article-body") {
      const fieldType: DynamicField["type"] = KNOWN_DYNAMIC_TYPES.has(type)
        ? (type as DynamicField["type"])
        : "dynamic-list"
      config[unique] = extractDynamicField(el, unique, fieldType)
    } else if (type === "nav-list") {
      config[unique] = extractNavField(el, unique)
    }
  }

  const autoNavs = findUnmarkedNavs(doc)
  for (const { el, baseKey } of autoNavs) {
    const key = uniqueKey(baseKey, usedKeys)
    el.setAttribute("data-content", key)
    el.setAttribute("data-content-type", "nav-list")
    usedKeys.add(key)
    config[key] = extractNavField(el, key)
  }

  return { htmlTemplate: dom.serialize(), contentConfig: config }
}

function uniqueKey(base: string, used: Set<string>): string {
  if (!used.has(base)) return base
  let i = 2
  while (used.has(`${base}-${i}`)) i++
  return `${base}-${i}`
}

/**
 * 兜底：对未标记的标题/段落自动补 data-content=text 标记（LLM 漏标时避免内容不可编辑）。
 * 只给叶子文本元素（h1-h6/p）打标、不打容器——text 字段渲染是 textContent 替换，
 * 打容器会破坏内部嵌套结构；打叶子安全。
 */
function markUnmarkedTextUnits(doc: Document): void {
  const units = Array.from(doc.querySelectorAll("h1,h2,h3,h4,h5,h6,p")).filter(
    (el) =>
      (el.textContent ?? "").trim().length > 0 &&
      el.closest("[data-content]") === null
  )
  const used = new Set(
    Array.from(doc.querySelectorAll("[data-content]"))
      .map((el) => el.getAttribute("data-content") ?? "")
      .filter(Boolean)
  )
  for (const el of units) {
    // key 优先取类名 kebab 化（.post-title → post-title），无类名用 tag 名
    const rawClass = (el.getAttribute("class") ?? "").split(/\s+/)[0] ?? ""
    const base =
      rawClass.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "") ||
      el.tagName.toLowerCase()
    const key = uniqueKey(base, used)
    used.add(key)
    el.setAttribute("data-content", key)
    el.setAttribute("data-content-type", "text")
  }
}

function findUnmarkedNavs(doc: Document): { el: Element; baseKey: string }[] {
  const candidates: { el: Element; baseKey: string }[] = []

  for (const el of doc.querySelectorAll("nav")) {
    if (el.hasAttribute("data-content")) continue
    if (el.querySelectorAll("a").length === 0) continue
    candidates.push({ el, baseKey: "nav" })
  }

  for (const footer of doc.querySelectorAll("footer")) {
    const list = Array.from(footer.querySelectorAll("ul")).find(
      (ul) => ul.querySelectorAll("a").length > 0
    )
    if (list && !list.hasAttribute("data-content")) {
      candidates.push({ el: list, baseKey: "footer-nav" })
    }
  }

  for (const el of doc.querySelectorAll("[style]")) {
    if (el.hasAttribute("data-content")) continue
    const style = (el.getAttribute("style") || "").toLowerCase().replace(/\s/g, "")
    const isFixedBottom =
      style.includes("position:fixed") &&
      style.includes("bottom:") &&
      !style.includes("top:")
    if (!isFixedBottom || el.querySelectorAll("a").length === 0) continue
    candidates.push({ el, baseKey: "bottom-nav" })
  }

  return candidates.filter(
    (candidate) =>
      !candidates.some((other) => other !== candidate && other.el.contains(candidate.el))
  )
}

function extractTextField(
  el: Element,
  key: string,
  siteConfig?: Record<string, string>
): TextField {
  const htmlValue = el.textContent?.trim() ?? ""

  const def = FIELD_DEFINITIONS[key]

  if (siteConfig && siteConfig[key] !== undefined) {
    return {
      type: "text",
      label: key,
      value: siteConfig[key],
      source: def?.readonly ? "readonly" : "global",
      globalKey: key,
    }
  }

  if (def?.readonly) {
    return {
      type: "text",
      label: key,
      value: htmlValue || "0",
      source: "readonly",
      globalKey: key,
    }
  }

  return {
    type: "text",
    label: key,
    value: htmlValue,
    source: "theme",
  }
}

function extractDynamicField(el: Element, key: string, type: DynamicField["type"]): DynamicField {
  const firstChild = el.firstElementChild
  const templateEl = firstChild ? findRepeatableItemTemplate(firstChild) ?? firstChild : null
  const fieldMapping: Record<string, string> = {}

  if (templateEl) {
    const mappedElements = templateEl.querySelectorAll("[data-map]")
    for (const mapped of mappedElements) {
      const fieldName = mapped.getAttribute("data-map")
      if (fieldName) {
        fieldMapping[fieldName] = fieldName
      }
    }

    if (!fieldMapping.link) {
      const linkEl =
        templateEl.tagName.toLowerCase() === "a"
          ? templateEl
          : templateEl.querySelector("a[href]")
      if (linkEl) {
        linkEl.setAttribute("data-map", "link")
        fieldMapping.link = "link"
      }
    }
  }

  const result: DynamicField = {
    type,
    label: key,
    itemTemplate: templateEl ? templateEl.outerHTML : "",
    fieldMapping,
  }

  if (type === "dynamic-list" && templateEl) {
    const itemsScope = templateEl.parentElement ?? el
    result.items = extractCustomListItems(itemsScope, templateEl, fieldMapping)
  }

  return result
}

/**
 * 当动态区首个子元素是整块面板/网格包装（含标题、列表容器、按钮）时，
 * 向下钻取到真正可重复的列表项作为模板，避免把整个面板当成单个列表项。
 */
function findRepeatableItemTemplate(root: Element): Element | null {
  if (root.matches("ul, ol")) return root.firstElementChild

  const list = root.querySelector<Element>("ul, ol")
  if (list) {
    const first = list.firstElementChild
    if (first && (first.matches("[data-map]") || first.querySelector("[data-map]"))) {
      return first
    }
  }

  const children = Array.from(root.children) as Element[]
  const items = children.filter(
    (c) => c.matches("[data-map]") || c.querySelector("[data-map]")
  )
  // 仅当存在多个结构相同的重复项（同标签 + 同 data-map 字段集）时才视为"网格/卡片包装"，
  // 避免把列表项自身（li 内的时间/链接/分类等字段元素）误判为重复项。
  const sameTag =
    items.length > 1 && items.every((c) => c.tagName === items[0].tagName)
  const sameMaps =
    items.length > 1 &&
    items.every((c) => mapKeysOf(c).join(",") === mapKeysOf(items[0]).join(","))
  if (sameTag && sameMaps) {
    return items[0]
  }
  return null
}

/** 收集元素内（含自身）的全部 data-map 字段名，排序后用于结构比对。 */
function mapKeysOf(el: Element): string[] {
  const keys = new Set<string>()
  if (el.matches("[data-map]")) {
    const name = el.getAttribute("data-map")
    if (name) keys.add(name)
  }
  for (const mapped of el.querySelectorAll("[data-map]")) {
    const name = mapped.getAttribute("data-map")
    if (name) keys.add(name)
  }
  return Array.from(keys).sort()
}

function extractCustomListItems(
  container: Element,
  template: Element,
  fieldMapping: Record<string, string>
): CustomListItem[] {
  const items: CustomListItem[] = []
  const allChildren = Array.from(container.children)

  for (const child of allChildren) {
    if (child === template) continue

    const item: CustomListItem = {}
    for (const fieldName of Object.keys(fieldMapping)) {
      if (fieldName === "link") {
        const linkEl =
          child.tagName.toLowerCase() === "a"
            ? child
            : child.querySelector("a[href]")
        item[fieldName] = linkEl?.getAttribute("href") ?? ""
      } else {
        const mapped = child.querySelector(`[data-map="${fieldName}"]`) ?? child
        item[fieldName] = mapped.textContent?.trim() ?? ""
      }
    }

    if (Object.values(item).some((v) => v !== "")) {
      items.push(item)
    }
  }

  return items
}

function extractNavField(el: Element, key: string): NavField {
  // 优先提取导航列表容器内的链接（如 .nav-links / ul / ol），
  // 避免把品牌(logo + data-content)也当成 nav 项，也避免结构被展平。
  const listHost = findNavListHost(el)
  const itemEls = listHost ? collectNavItemElements(listHost) : null

  const itemSource = itemEls && itemEls.length > 0 ? itemEls : collectNavItemElements(el)
  const items: { label: string; href: string }[] = []
  let itemTemplate = ""

  for (const itemEl of itemSource) {
    const linkEl = resolveNavLink(itemEl)
    if (!linkEl) continue
    const label = linkEl.textContent?.trim() ?? ""
    if (!label && !linkEl.getAttribute("href")) continue
    const href = linkEl.getAttribute("href") ?? linkEl.getAttribute("data-href") ?? ""
    items.push({ label, href })
    if (!itemTemplate) {
      itemTemplate = buildNavTemplate(itemEl)
    }
  }

  return {
    type: "nav-list",
    label: key,
    items,
    itemTemplate,
  }
}

/** 找到导航里的“链接列表容器”：优先匹配 class 语义（nav-links/nav-menu/menu），再退回 ul/ol。 */
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

/** 品牌元素（logo / 站点标题链接）不算导航项。 */
function isBrandElement(el: Element): boolean {
  if (/\bnav-brand\b|\blogo\b/i.test(el.getAttribute("class") ?? "")) return true
  return el.querySelector(".nav-brand, .logo") !== null
}

/** 收集列表容器里的 nav 项元素：优先 li，退回直接的 a / [data-href]，跳过品牌元素。 */
function collectNavItemElements(host: Element): Element[] {
  const lis = Array.from(host.children).filter(
    (c) => c.tagName.toLowerCase() === "li" && !isBrandElement(c)
  )
  if (lis.length > 0) return lis
  return Array.from(host.children).filter(
    (c) =>
      c.matches("a[href], [data-href], button[data-href]") && !isBrandElement(c)
  )
}

/** 从 li / a 中解析出真正的链接元素。 */
function resolveNavLink(itemEl: Element): Element | null {
  if (itemEl.matches("a[href], [data-href]")) return itemEl
  const anchor = itemEl.querySelector<Element>("a[href], [data-href]")
  return anchor ?? null
}

/** 生成单个 nav 项的模板：保留归档（li）包裹，只把 href 与 label 占位化；裸 <a> 套回 <li> 恢复列表结构。 */
function buildNavTemplate(itemEl: Element): string {
  const clone = itemEl.cloneNode(true) as Element
  const linkClone = (() => {
    if (clone.matches("a[href], [data-href]")) return clone
    return clone.querySelector<Element>("a[href], [data-href]")
  })() as Element
  if (linkClone.hasAttribute("href")) linkClone.setAttribute("href", "{href}")
  else if (linkClone.hasAttribute("data-href")) linkClone.setAttribute("data-href", "{href}")
  linkClone.textContent = "{label}"
  if (clone.matches("a[href], [data-href]")) {
    const li = clone.ownerDocument.createElement("li")
    li.appendChild(clone)
    return li.outerHTML
  }
  return clone.outerHTML
}
