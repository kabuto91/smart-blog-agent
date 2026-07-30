import { JSDOM } from "jsdom"
import type { ContentConfig, TextField, DynamicField, NavField } from "./types/content-config"
import { FIELD_DEFINITIONS } from "./field-config"

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

  const elements = doc.querySelectorAll("[data-content]")
  for (const el of elements) {
    const key = el.getAttribute("data-content")
    const type = el.getAttribute("data-content-type")
    if (!key) continue

    if (type === "text") {
      config[key] = extractTextField(el, key, siteConfig)
    } else if (type?.startsWith("dynamic-")) {
      config[key] = extractDynamicField(el, key, type as DynamicField["type"])
    } else if (type === "nav-list") {
      config[key] = extractNavField(el, key)
    }
  }

  return { htmlTemplate: html, contentConfig: config }
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

  return {
    type: "nav-list",
    label: key,
    items,
    itemTemplate,
  }
}
