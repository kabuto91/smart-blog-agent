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
  for (const [key, field] of Object.entries(navFields)) {
    if ((merged[key] as { type?: string } | undefined)?.type === "nav-list") continue
    merged[key] = field
    changed = true
  }
  return changed ? merged : (config ?? null)
}

export function extractContentConfig(
  html: string,
  siteConfig?: Record<string, string>
): ExtractionResult {
  const dom = new JSDOM(html)
  const doc = dom.window.document
  const config: ContentConfig = {}
  const usedKeys = new Set<string>()

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
  const fieldMapping: Record<string, string> = {}

  if (firstChild) {
    const mappedElements = firstChild.querySelectorAll("[data-map]")
    for (const mapped of mappedElements) {
      const fieldName = mapped.getAttribute("data-map")
      if (fieldName) {
        fieldMapping[fieldName] = fieldName
      }
    }

    if (!fieldMapping.link) {
      const linkEl =
        firstChild.tagName.toLowerCase() === "a"
          ? firstChild
          : firstChild.querySelector("a[href]")
      if (linkEl) {
        linkEl.setAttribute("data-map", "link")
        fieldMapping.link = "link"
      }
    }
  }

  const result: DynamicField = {
    type,
    label: key,
    itemTemplate: firstChild ? firstChild.outerHTML : "",
    fieldMapping,
  }

  if (type === "dynamic-list" && firstChild) {
    result.items = extractCustomListItems(el, firstChild, fieldMapping)
  }

  return result
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
  const links = el.querySelectorAll("a")
  const items: { label: string; href: string }[] = []
  let itemTemplate = ""

  if (links.length > 0) {
    for (const link of links) {
      const label = link.textContent?.trim() ?? ""
      const href = link.getAttribute("href") ?? ""
      items.push({ label, href })
      if (!itemTemplate) {
        const clone = link.cloneNode(true) as Element
        clone.setAttribute("href", "{href}")
        clone.textContent = "{label}"
        itemTemplate = clone.outerHTML
      }
    }
  } else {
    for (const child of Array.from(el.children)) {
      const label = child.textContent?.trim() ?? ""
      if (!label) continue
      items.push({
        label,
        href: child.getAttribute("data-href") ?? child.getAttribute("href") ?? "",
      })
      if (!itemTemplate) {
        const clone = child.cloneNode(true) as Element
        if (clone.tagName.toLowerCase() === "a") {
          clone.setAttribute("href", "{href}")
        } else if (child.hasAttribute("data-href")) {
          clone.setAttribute("data-href", "{href}")
        }
        clone.textContent = "{label}"
        itemTemplate = clone.outerHTML
      }
    }
  }

  return {
    type: "nav-list",
    label: key,
    items,
    itemTemplate,
  }
}
