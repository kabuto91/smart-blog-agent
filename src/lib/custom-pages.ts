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
  const genDom = new JSDOM(generatedHtml)
  const genDoc = genDom.window.document

  const styles = Array.from(genDoc.querySelectorAll("style"))
    .map((s) => s.outerHTML)
    .join("")

  for (const selector of ["header", "footer", "nav"]) {
    for (const el of Array.from(genDoc.querySelectorAll(selector))) {
      el.remove()
    }
  }

  const bodyInner = genDoc.body?.innerHTML ?? ""

  const dom = new JSDOM("<!DOCTYPE html><body></body>")
  const section = dom.window.document.createElement("section")
  section.setAttribute("data-route", normalizeRoute(route))
  section.innerHTML = `${styles}${bodyInner}`
  return section.outerHTML
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
