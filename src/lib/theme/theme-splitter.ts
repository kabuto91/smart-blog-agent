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
  pageHtml: string
): string {
  const dom = new JSDOM(layoutHtml)
  const doc = dom.window.document

  const host = doc.querySelector("[data-page-host]")
  if (host) {
    host.innerHTML = pageHtml
  }

  return dom.serialize()
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