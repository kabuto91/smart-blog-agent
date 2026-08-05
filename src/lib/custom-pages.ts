import { JSDOM } from "jsdom"

export function normalizeRoute(path: string): string {
  const clean = path.trim().split("?")[0].split("#")[0]
  if (!clean || clean === "/") return "/"
  const withSlash = clean.startsWith("/") ? clean : `/${clean}`
  return withSlash.replace(/\/+$/, "") || "/"
}

export function getCustomRoutes(html: string): string[] {
  const dom = new JSDOM(html)
  const doc = dom.window.document
  const routes = Array.from(doc.querySelectorAll("[data-route]"))
    .map((el) => el.getAttribute("data-route") ?? "")
    .map(normalizeRoute)
    .filter((r) => r !== "/")
  return Array.from(new Set(routes))
}

export function buildCustomPageSection(
  route: string,
  generatedHtml: string
): string {
  const normalizedRoute = normalizeRoute(route)

  // 尝试解析生成的 HTML
  const dom = new JSDOM(generatedHtml)
  const doc = dom.window.document

  // 检查是否是完整的 HTML 页面（包含 DOCTYPE 或 html 标签）
  const isFullPage = doc.doctype !== null || doc.querySelector("html") !== null

  if (isFullPage) {
    // 向后兼容：旧格式（完整 HTML 页面）
    // 提取样式
    const styles = Array.from(doc.querySelectorAll("style"))
      .map((s) => s.outerHTML)
      .join("")

    // 删除 header、footer、nav
    for (const selector of ["header", "footer", "nav"]) {
      for (const el of Array.from(doc.querySelectorAll(selector))) {
        el.remove()
      }
    }

    const bodyInner = doc.body?.innerHTML ?? ""

    const sectionDom = new JSDOM("<!DOCTYPE html><body></body>")
    const section = sectionDom.window.document.createElement("section")
    section.setAttribute("data-route", normalizedRoute)
    section.innerHTML = `${styles}${bodyInner}`
    return section.outerHTML
  }

  // 新格式：只生成了内容区域
  // 获取根元素（section 或 div）
  const root = doc.body?.firstElementChild

  if (root) {
    // 如果根元素已经是 section 或 div，直接添加 data-route 属性
    root.setAttribute("data-route", normalizedRoute)
    return root.outerHTML
  }

  // 兜底：包装在 section 中
  return `<section data-route="${normalizedRoute}">${generatedHtml}</section>`
}

export function insertCustomPageSection(
  themeHtml: string,
  route: string,
  sectionHtml: string
): string {
  const dom = new JSDOM(themeHtml)
  const doc = dom.window.document
  const bodyEl = doc.body

  for (const el of Array.from(doc.querySelectorAll("[data-route]"))) {
    if (normalizeRoute(el.getAttribute("data-route") ?? "") === route) {
      el.remove()
    }
  }

  if (bodyEl) {
    bodyEl.insertAdjacentHTML("beforeend", sectionHtml)
  }

  return dom.serialize()
}

export function mergeContentConfig(
  existing: string | null,
  incoming?: string
): string | null {
  const merged: Record<string, unknown> = {}
  if (existing) {
    try {
      Object.assign(merged, JSON.parse(existing))
    } catch {
      // ignore malformed existing config
    }
  }
  if (incoming) {
    try {
      const parsed = JSON.parse(incoming) as Record<string, unknown>
      if (parsed && typeof parsed === "object") {
        for (const [key, value] of Object.entries(parsed)) {
          if (!(key in merged)) merged[key] = value
        }
      }
    } catch {
      // ignore malformed incoming config
    }
  }
  const keys = Object.keys(merged)
  return keys.length > 0 ? JSON.stringify(merged) : null
}
