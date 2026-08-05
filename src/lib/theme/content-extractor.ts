import { JSDOM } from "jsdom"
import type { ContentConfig, TextField, DynamicField, NavField } from "./types/content-config"
import { FIELD_DEFINITIONS } from "./field-registry"

export interface ExtractionResult {
  htmlTemplate: string
  contentConfig: ContentConfig
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
      config[unique] = extractDynamicField(el, unique, type as DynamicField["type"])
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

  return {
    type,
    label: key,
    itemTemplate: firstChild ? firstChild.outerHTML : "",
    fieldMapping,
  }
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
