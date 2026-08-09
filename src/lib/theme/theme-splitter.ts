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

/**
 * 确保布局满足"布局契约"：
 * 1. body 中必须存在唯一的 [data-page-host] 占位节点（缺失时在页脚前补插）；
 * 2. :root 必须声明 --nav-h（固定导航高度），缺失时补默认值；
 * 3. 注入一个运行时脚本，按实际导航测量结果刷新 --nav-h（仅固定导航需要留白，静态/吸顶导航置 0，避免双重留白冲突）。
 */
export function ensureLayoutContract(layoutHtml: string): string {
  const dom = new JSDOM(layoutHtml)
  const doc = dom.window.document
  const body = doc.body
  if (!body) return layoutHtml

  // 1. 占位节点
  const existingHost = Array.from(body.querySelectorAll("[data-page-host]"))
  for (const el of existingHost.slice(1)) el.remove()
  let host = body.querySelector<HTMLElement>("[data-page-host]")
  if (!host) {
    host = doc.createElement("div")
    host.setAttribute("data-page-host", "")
    const footer = body.querySelector("footer")
    if (footer) footer.insertAdjacentElement("beforebegin", host)
    else body.appendChild(host)
  }

  // 2. --nav-h 默认值
  const cssText = Array.from(doc.querySelectorAll("style"))
    .map((s) => s.textContent ?? "")
    .join("\n")
  if (!/--nav-h\s*:/.test(cssText)) {
    const style = doc.createElement("style")
    style.textContent = ":root { --nav-h: 0px; }"
    doc.head.appendChild(style)
  }

  // 3. 运行时测量脚本（幂等）
  if (!body.querySelector("script[data-theme-nav-measure]")) {
    const script = doc.createElement("script")
    script.setAttribute("data-theme-nav-measure", "")
    script.textContent = `(function(){var sync=function(){var nav=document.querySelector('nav[data-content="main-nav"]')||document.querySelector('nav')||document.querySelector('header');var h=0;if(nav&&window.getComputedStyle(nav).position==='fixed'){h=nav.getBoundingClientRect().height;}document.documentElement.style.setProperty('--nav-h',h+'px');};if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',sync);}else{sync();}window.addEventListener('resize',sync);})();`
    body.appendChild(script)
  }

  return dom.serialize()
}

/** 根据布局占位标记拼装完整页面 HTML（正文插入占位处；缺失占位时自动补插）。 */
export function mergeThemePage(
  layoutHtml: string,
  pageHtml: string,
  options?: { navClearance?: boolean }
): string {
  const dom = new JSDOM(ensureLayoutContract(layoutHtml))
  const doc = dom.window.document

  let host = doc.querySelector<HTMLElement>("[data-page-host]")
  if (!host) {
    host = doc.createElement("div")
    host.setAttribute("data-page-host", "")
    const footer = doc.body.querySelector("footer")
    if (footer) footer.insertAdjacentElement("beforebegin", host)
    else doc.body.appendChild(host)
  }

  host.innerHTML = pageHtml
  if (options?.navClearance) {
    host.style.paddingTop = "var(--nav-h, 0px)"
  }

  return dom.serialize()
}

/**
 * 把单页生成器输出的"完整独立文档"净化为可直接注入布局的正文片段：
 * - 丢弃 <html>/<head>/<body> 包裹，以及页面自带的 <script>/<style> 等；
 * - 丢弃页面自带的固定导航类型组件（reading-progress / back-to-top 等）；
 * - 把常见的"页面专属容器类"桥接到共享设计系统类（映射即替换，避免双类样式叠加）。
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
  "article-cover-img": "article-cover-img",
  "article-main": "article-body",
  "article-content": "article-body",
  "author-card": "container",
  "archive-header": "page-header",
  "archive-title": "page-title",
  "sheet-header": "page-header",
  "sheet-main": "article-main",
  "list-header": "page-header",
  "list-page": "page-main",
  "post-list": "article-list",
  "post-title-block": "post-title",
  "post-hero": "article-header",
  "hero-post": "post-card",
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
    const next = classes.map((cls) => CLASS_BRIDGE[cls] ?? cls)
    const final = Array.from(new Set(next))
    if (final.length !== classes.length || final.some((c, i) => c !== classes[i])) {
      el.setAttribute("class", final.join(" ") || el.tagName.toLowerCase())
    }
  }

  return body.innerHTML
}

/** 收集 HTML 中全部用到/设计系统(CSS)中声明的类名（用于校验页面与骨架类库的重叠率）。 */
export function collectThemeClasses(html: string): Set<string> {
  const dom = new JSDOM(html)
  const classes = new Set<string>()
  for (const el of Array.from(
    dom.window.document.querySelectorAll<HTMLElement>("[class]")
  )) {
    for (const cls of (el.getAttribute("class") ?? "").split(/\s+/)) {
      if (cls) classes.add(cls)
    }
  }
  // CSS 中声明的设计系统类也计入骨架类库
  for (const style of Array.from(dom.window.document.querySelectorAll("style"))) {
    const css = style.textContent ?? ""
    const re = /\.([a-zA-Z_][\w-]*)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(css)) !== null) {
      classes.add(m[1])
    }
  }
  return classes
}

export interface PageFragmentIssue {
  /** 校验是否以失败告终 */
  ok: boolean
  /** 类名与骨架类库的重叠率 (0~1)；0 = 无任何重叠 */
  overlap: number
  issues: string[]
}

/** 校验生成出的页面片段与骨架视觉契约是否一致。 */
export function validatePageFragment(
  fragmentHtml: string,
  layoutClasses: Set<string>
): PageFragmentIssue {
  const dom = new JSDOM(fragmentHtml)
  const doc = dom.window.document
  const issues: string[] = []

  const forbidden = Array.from(
    doc.querySelectorAll("style, script, link, meta, title, template, nav, footer, header")
  )
  if (forbidden.length > 0) {
    issues.push(`页面片段包含不应出现的标签 <${forbidden[0].tagName.toLowerCase()}>`)
  }
  // 仅当输入本身含完整文档包裹时才告警（JSDOM 会为裸片段自动补 head/body，需用原始串判断）
  if (/<!DOCTYPE|<html[\s>]/i.test(fragmentHtml)) {
    issues.push("页面片段包含完整文档包裹（html/head/body）")
  }

  const pageClasses = collectThemeClasses(fragmentHtml)
  let matched = 0
  for (const cls of pageClasses) {
    if (layoutClasses.has(cls)) matched++
  }
  const overlap = pageClasses.size > 0 ? matched / pageClasses.size : 0
  if (overlap < 0.15 && pageClasses.size > 0) {
    issues.push(`页面类名与骨架类库重叠率过低 (${(overlap * 100).toFixed(0)}%)`)
  }

  return { ok: issues.length === 0, overlap, issues }
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