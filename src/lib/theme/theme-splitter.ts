import { JSDOM } from "jsdom"
import {
  prunePageRegions,
  pruneHomeSections,
  pruneDetailPage,
} from "./content-renderer"

export type BuiltinPageType = "home" | "list" | "detail"

export const BUILTIN_PAGE_TYPES: BuiltinPageType[] = ["home", "list", "detail"]

export interface SplitPageResult {
  type: BuiltinPageType
  html: string
}

export interface SplitResult {
  layoutHtml: string
  pages: SplitPageResult[]
}

export function pageTypeLabel(type: string): string {
  switch (type) {
    case "home":
      return "首页"
    case "list":
      return "文章列表页"
    case "detail":
      return "文章详情页"
    default:
      return type
  }
}

/**
 * 从生成的完整单页文档拆分出共享布局 + 各类型页面正文。
 * 布局保留 <head>（含样式）、导航与页脚，正文替换为占位标记。
 * 各页 html 为该类型被剪枝后的正文（不含导航/页脚）。
 */
export function splitGeneratedTheme(fullHtml: string): SplitResult {
  const layoutDom = new JSDOM(fullHtml)
  const layoutHtml = buildLayoutHost(layoutDom.window.document)

  return {
    layoutHtml,
    pages: BUILTIN_PAGE_TYPES.map((type) => ({
      type,
      html: buildPageBody(fullHtml, type),
    })),
  }
}

/** 根据布局占位标记拼装完整页面 HTML（正文插入占位处）。 */
export function mergeThemePage(
  layoutHtml: string,
  pageHtml: string,
  options?: { navClearance?: boolean }
): string {
  const dom = new JSDOM(layoutHtml)
  const doc = dom.window.document

  const host = doc.querySelector("[data-page-host]")
  if (host) {
    host.innerHTML = pageHtml
    if (options?.navClearance) {
      ;(host as HTMLElement).style.paddingTop = "var(--nav-h, 0px)"
    }
  }

  return dom.serialize()
}

/**
 * 把单页生成器输出的"完整独立文档"净化为可直接注入布局的正文片段：
 * - 丢弃 <html>/<head>/<body> 包裹，以及页面自带的 <script>/<style> 等；
 * - 丢弃页面自带的固定导航类型组件（reading-progress / back-to-top 等）；
 * - 把常见的"页面专属容器类"桥接到共享设计系统类，避免剥离样式后页面变裸。
 */
const PAGE_CHROME_SELECTORS =
  ".reading-progress, .back-to-top, .to-top, #readingProgress"
const CLASS_BRIDGE: Record<string, string> = {
  "article-hero": "article-header",
  "article-hero__title": "post-title",
  "article-hero__excerpt": "article-header__desc",
  "article-hero__meta": "article-header__meta",
  "article-hero__image-wrap": "article-cover",
  "article-hero__image": "article-cover-img",
  "article-hero__content": "article-header",
  "article-main": "article-body",
  "author-card": "container",
}

export function sanitizePageFragment(rawHtml: string): string {
  const dom = new JSDOM(rawHtml)
  const doc = dom.window.document
  const body = doc.body

  for (const el of Array.from(
    body.querySelectorAll("script, style, link, meta, title, template, noscript")
  )) {
    el.remove()
  }
  for (const el of Array.from(body.querySelectorAll(PAGE_CHROME_SELECTORS))) {
    el.remove()
  }

  for (const el of Array.from(body.querySelectorAll<HTMLElement>("[class]"))) {
    const classes = (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean)
    for (const cls of classes) {
      const target = CLASS_BRIDGE[cls]
      if (target) el.classList.add(target)
    }
  }

  return body.innerHTML
}

/**
 * 构建共享布局：保留 <head>（含样式）与导航/页脚，
 * 正文替换为占位节点（位于导航之后、页脚之前）。
 */
function buildLayoutHost(doc: Document): string {
  const body = doc.body
  const chrome: Element[] = []
  for (const el of Array.from(body.children)) {
    if (el.matches("nav, header, footer")) {
      chrome.push(el)
    } else {
      el.remove()
    }
  }

  const host = doc.createElement("div")
  host.setAttribute("data-page-host", "")

  const firstFooterIndex = chrome.findIndex(
    (el) => el.tagName.toLowerCase() === "footer"
  )
  if (firstFooterIndex >= 0) {
    chrome[firstFooterIndex].insertAdjacentElement("beforebegin", host)
  } else {
    body.appendChild(host)
  }

  return doc.documentElement.outerHTML
}

function buildPageBody(fullHtml: string, type: BuiltinPageType): string {
  const dom = new JSDOM(fullHtml)
  const doc = dom.window.document as Document

  prunePageRegions(doc, type)
  if (type === "detail") {
    pruneDetailPage(doc)
  }
  if (type === "list" || type === "detail") {
    pruneHomeSections(doc)
  }

  const bodyEl = doc.body
  const html = bodyEl.innerHTML
  return stripLayout(html)
}

/** 移除导航/页脚等共享布局元素，仅保留正文。 */
function stripLayout(html: string): string {
  const dom = new JSDOM(`<!DOCTYPE html><body>${html}</body>`)
  const doc = dom.window.document
  const body = doc.body

  for (const el of Array.from(body.querySelectorAll("nav, header, footer"))) {
    el.remove()
  }

  return body.innerHTML
}