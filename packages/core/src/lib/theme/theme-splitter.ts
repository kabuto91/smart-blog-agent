import { JSDOM } from "jsdom"
import {
  prunePageRegions,
  pruneHomeSections,
  pruneDetailPage,
} from "./content-renderer"
import { stripRedundantFragmentWrappers } from "./layout-inject"

export type BuiltinPageType = "home" | "list" | "detail"

export const BUILTIN_PAGE_TYPES: BuiltinPageType[] = ["home", "list", "detail"]

/**
 * 安全兜底样式层：作为布局 <head> 的最后一个 <style> 注入。
 * 只作用于 [data-page-host] 正文区（不影响导航/页脚），机械保证真实内容不外溢，
 * 弥补 LLM 骨架对长文本、固定宽度、刚性 grid 等溢出场景没有兜底的缺口。
 */
export const THEME_SAFETY_CSS = `/* === theme-safety: 溢出安全兜底，勿手工修改 === */
html, body { max-width: 100%; overflow-x: clip; }
[data-page-host] { box-sizing: border-box; max-width: 100%; }
[data-page-host], [data-page-host] *,
[data-page-host] *::before, [data-page-host] *::after { box-sizing: border-box; }
/* 行内/host 子元素最小宽度修正，避免 flex/grid 子项撑破容器。
   用 :where() 包裹降为 0 特异性，避免覆盖骨架设计系统的限宽容器（max-width 变量等）。 */
:where([data-page-host] > *, [data-page-host] .container > *,
  [data-page-host] [class*="grid"] > *, [data-page-host] [class*="list"] > *) { min-width: 0; max-width: 100%; }
[data-page-host] img, [data-page-host] video, [data-page-host] iframe,
[data-page-host] canvas, [data-page-host] svg, [data-page-host] table { max-width: 100%; }
[data-page-host] img { height: auto; }
[data-page-host] pre { max-width: 100%; overflow-x: auto; }
[data-page-host] p, [data-page-host] h1, [data-page-host] h2, [data-page-host] h3,
[data-page-host] h4, [data-page-host] h5, [data-page-host] h6, [data-page-host] li,
[data-page-host] dd, [data-page-host] a, [data-page-host] td, [data-page-host] th {
  overflow-wrap: anywhere; word-break: break-word;
}
[data-page-host] .article-body,
[data-page-host] [data-map="body"] { overflow-wrap: anywhere; word-break: break-word; }
/* 导航链接 li 的兜底：骨架可能生成 div 直接包 li（非法结构），清除 UA 默认圆点标记 */
:where(nav li, [data-content-type="nav-list"] li) { list-style: none; }
/* === /theme-safety === */`

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

  // 3. 安全兜底样式层（作为 head 最后的 <style>，保证优先级最高）。
  //    版本化重注入：先移除旧版安全层（含历史上特异性过高的版本），再注入当前版，
  //    使存量主题在下次渲染（mergeThemePage → ensureLayoutContract）时自动升级。
  for (const el of Array.from(doc.querySelectorAll("style[data-theme-safety]"))) {
    el.remove()
  }
  const safety = doc.createElement("style")
  safety.setAttribute("data-theme-safety", "")
  safety.textContent = THEME_SAFETY_CSS
  doc.head.appendChild(safety)

  // 4. 运行时测量脚本（版本化重注入：先移除旧版脚本再注入当前版，
  //    使存量主题在下次渲染时自动升级；旧版只取第一个匹配元素检查 fixed，
  //    会误把固定 header 内的静态 <nav> 当成导航而把 --nav-h 置 0）。
  for (const el of Array.from(
    body.querySelectorAll("script[data-theme-nav-measure]")
  )) {
    el.remove()
  }
  const script = doc.createElement("script")
  script.setAttribute("data-theme-nav-measure", "")
  script.textContent = `(function(){var sync=function(){var els=document.querySelectorAll('nav[data-content="main-nav"], nav, header');var h=0;for(var i=0;i<els.length;i++){var el=els[i];if(window.getComputedStyle(el).position!=='fixed'){continue;}var r=el.getBoundingClientRect();if(r.height>0&&r.width>0&&r.height>=(window.innerHeight||r.height)*0.5){continue;}h=r.height;break;}document.documentElement.style.setProperty('--nav-h',h+'px');};if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',sync);}else{sync();}window.addEventListener('resize',sync);})();`
  body.appendChild(script)

  // 5. 间距兜底：强制 clamp 过大的 padding/margin/gap
  return normalizeThemeSpacing(dom.serialize())
}

/** 根据布局占位标记拼装完整页面 HTML（正文插入占位处；缺失占位时自动补插）。 */
export function mergeThemePage(
  layoutHtml: string,
  pageHtml: string,
  _options?: { navClearance?: boolean }
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

  host.innerHTML = stripRedundantFragmentWrappers(pageHtml)
  const injectedRoot = host.firstElementChild
  if (
    injectedRoot &&
    host.children.length === 1 &&
    isRedundantPageWrapper(injectedRoot)
  ) {
    while (injectedRoot.firstChild) {
      host.insertBefore(injectedRoot.firstChild, injectedRoot)
    }
    injectedRoot.remove()
  }
  // 布局自身已在 body 上提供 var(--nav-h) 级留白时不再叠加 host 留白（避免双重间距）；
  // 否则对所有页面（含 home）统一补 padding-top:var(--nav-h,0px)。
  // 非固定导航时运行时脚本会把 --nav-h 置 0，此留白无副作用，符合"仅固定导航需要留白"契约。
  if (!hasBodyNavClearance(doc)) {
    host.style.paddingTop = "var(--nav-h, 0px)"
  }

  return dom.serialize()
}

/**
 * 判定注入的正文片段单一根节点是否是"冗余页面容器"——即布局本身已提供、却再次出现在
 * 片段根部的包裹（<main class="page-content"> / <div class="page-content"> / data-page-host 宿主）。
 * 这类容器会与布局重复叠加 margin-left（侧边栏偏移）或 padding，造成排版错乱。
 * 只有满足以下条件才视为冗余，避免误伤片段内合法使用的 page-content 子容器：
 * 1. 根节点自身带 data-page-host，或
 * 2. 根节点是 page-content 类容器，且布局中确实存在包裹 host 的 page-content/main 容器。
 */
function isRedundantPageWrapper(el: Element): boolean {
  if (el.hasAttribute("data-page-host")) return true
  const cls = (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean)
  const isPageContentLike = /(^|_|-)(page-content|page|main|content)(_|-|$)/i.test(
    cls.join(" ")
  )
  if (!isPageContentLike) return false
  // 布局中需确实存在与片段根同类的 page-content/main 容器，才能判定为重复包裹
  const doc = el.ownerDocument
  const host = doc.querySelector<HTMLElement>("[data-page-host]")
  if (!host) return false
  const container = host.parentElement
  if (!container) return false
  const containerCls = (container.getAttribute("class") ?? "").toLowerCase()
  const containerTag = container.tagName.toLowerCase()
  return (
    containerTag === "main" ||
    containerTag === "div" ||
    containerCls.includes("page-content") ||
    containerCls.includes("content")
  )
}

/**
 * 检测布局 CSS 是否已为固定导航提供 body 级留白
 * （body / html,body 规则中的 padding/margin 引用 var(--nav-h)）。
 * 此类留白随测量值联动，host 再叠加一层会造成双重间距。
 */
function hasBodyNavClearance(doc: Document): boolean {
  for (const style of Array.from(doc.querySelectorAll("style"))) {
    const css = style.textContent ?? ""
    const blockRe = /(?:^|[{};,])\s*(?:html\s*,\s*body|body)\s*\{([^}]*)\}/gi
    let m: RegExpExecArray | null
    while ((m = blockRe.exec(css)) !== null) {
      if (/(?:padding|margin)(?:-top)?\s*:\s*[^;}]*var\(--nav-h/.test(m[1])) {
        return true
      }
    }
  }
  return false
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

export function sanitizePageFragment(
  rawHtml: string,
  layoutClasses?: Set<string>
): string {
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
    const next = classes.map((cls) => {
      const target = CLASS_BRIDGE[cls]
      // 上下文感知：仅当映射目标确实存在于骨架类集时才改写，
      // 否则保留原类名，避免改写成不存在的类而无声丢样。
      if (target === undefined) return cls
      if (layoutClasses && !layoutClasses.has(target)) return cls
      // 「时间锚点」侧边栏的归档条目复用 archive-title 作小字号列表项标题，
      // 不应被桥接成页面大标题 page-title（仅页面级归档标题才需要桥接）。
      if (cls === "archive-title" && el.closest(".archive-item, .archive-list")) {
        return cls
      }
      return target
    })
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

/**
 * 探测未标记 dynamic-articles 的文章卡片簇。
 * 判定条件：同一父级下 >=2 个同标签、含 /blog/ 文章链接、且不在动态容器/正文占位/导航内的重复结构。
 * 保守启发式，只报高置信度的文章卡片簇，避免误伤装饰性卡片或导航。
 */
function detectUnmarkedArticleList(doc: Document): boolean {
  const isInsideDynamic = (el: Element): boolean =>
    el.closest(
      '[data-content-type^="dynamic-"], [data-content-type="article-body"], [data-map="body"], nav, footer'
    ) !== null
  const hosts = Array.from(
    doc.querySelectorAll('article, li, [class*="post"], [class*="card"], [class*="grid"] > *')
  )
  // 父级 -> 重复子项
  const groups = new Map<Element, Element[]>()
  for (const el of hosts) {
    if (isInsideDynamic(el)) continue
    if (!el.querySelector('a[href*="/blog/"]')) continue
    const parent = el.parentElement
    if (!parent) continue
    const list = groups.get(parent) ?? []
    list.push(el)
    groups.set(parent, list)
  }
  for (const [, items] of groups) {
    if (
      items.length >= 2 &&
      items.every((it) => it.tagName === items[0].tagName)
    ) {
      return true
    }
  }
  return false
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

  // 内容标记覆盖率：h1-h6 / p 是后台可自定义的基本文本单元，
  // 若自身或祖先均无 data-content，则该文本无法被编辑。
  const uncoveredTextUnits = Array.from(
    doc.querySelectorAll("h1,h2,h3,h4,h5,h6,p")
  ).filter(
    (el) =>
      (el.textContent ?? "").trim().length > 0 &&
      el.closest("[data-content]") === null
  )
  // 容忍 1 个漏网（如极小的装饰性文本），≥2 个视为结构性漏标
  if (uncoveredTextUnits.length > 1) {
    const sample = uncoveredTextUnits
      .slice(0, 3)
      .map(
        (el) =>
          `<${el.tagName.toLowerCase()} class="${el.getAttribute("class") ?? ""}">`
      )
      .join("、")
    issues.push(
      `有 ${uncoveredTextUnits.length} 处标题/段落文本未标记 data-content（如 ${sample}），这些内容将无法在后台自定义；请为其补充 data-content + data-content-type="text"`
    )
  }

  // 漏标的重复文章卡片簇：应作为整体动态文章列表，而非多条 text
  if (detectUnmarkedArticleList(doc)) {
    issues.push(
      '页面存在未标记为动态文章列表的重复文章卡片/网格：这类区块应整体标记为 <section data-content="article-list" data-content-type="dynamic-articles">，并把卡片作为模板项用 data-map 标字段（title/excerpt/date/category/link），而非把标题摘要当 text。'
    )
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
  // 剥离片段顶部的冗余包裹（data-page-host / .page-content），使新版片段不再携带
  // 布局已提供的容器，从源头避免与布局 .page-content 叠加侧栏偏移。
  return stripRedundantFragmentWrappers(stripLayout(html))
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

// ---------------------------------------------------------------------------
// normalizeThemeSpacing — 后处理强制修正过大的间距值
// ---------------------------------------------------------------------------

/** 间距属性及其 clamp 上限（px）——普通区块。 */
const SPACING_LIMITS: Record<string, number> = {
  "padding-top": 60,
  "padding-bottom": 60,
  "padding": 60,
  "margin-top": 64,
  "margin-bottom": 64,
  "margin": 64,
  gap: 32,
}

/** hero/feature 等视觉大区块的放宽上限（px）：允许大留白等大胆设计意图保留，仅防离谱值。 */
const HERO_SPACING_LIMITS: Record<string, number> = {
  "padding-top": 120,
  "padding-bottom": 120,
  "padding": 120,
  "margin-top": 96,
  "margin-bottom": 96,
  "margin": 96,
  gap: 48,
}

/** 匹配 CSS 值中的 px 数字（如 48px、0.5rem 不处理）。 */
const PX_RE = /(\d+(?:\.\d+)?)px/g

/**
 * 将 CSS 值中超限的 px 数字 clamp 到上限。
 * 只处理 px 单位，rem/em/% 等保持不动。
 */
function clampPxValue(value: string, limit: number): string {
  return value.replace(PX_RE, (_match, num: string) => {
    const px = parseFloat(num)
    if (px > limit) return `${limit}px`
    return `${px}px`
  })
}

/** 标题字号上限（px）——全局，防止巨大标题撑破行宽/容器。 */
const HEADING_FONT_LIMITS: Record<string, number> = {
  h1: 56,
  h2: 40,
  h3: 32,
}

/** hero/feature 区块内标题的放宽上限（px），允许超大展示型标题。 */
const HERO_HEADING_FONT_LIMITS: Record<string, number> = {
  h1: 80,
  h2: 56,
  h3: 40,
}

/** 判定选择器是否属于 hero 类视觉大区块（.hero/.banner/.feature/.cover/.jumbotron/.masthead）。 */
const HERO_SELECTOR_RE =
  /(?:^|[\s,>+~(])(?:\.hero|\.banner|\.feature|\.cover|\.jumbotron|\.masthead)(?:$|[\s,.:#\[{>~+)])/i

/** 判定单个宽度声明值是否应被 clamp 到 100%（仅针对会导致溢出的硬编码宽值）。 */
function clampWidthValue(value: string): string {
  const m = /^\s*(\d+(?:\.\d+)?)(px|vw)\s*$/.exec(value)
  if (!m) return value.trim()
  const n = parseFloat(m[1])
  if (m[2] === "vw" && n > 100) return "100%"
  if (m[2] === "px" && n > 1400) return "100%"
  return value.trim()
}

/** 对整个声明块中某个属性应用 clamp 函数；返回新块与是否有改动。 */
function clampProperty(
  body: string,
  prop: string,
  clamp: (value: string) => string
): { body: string; changed: boolean } {
  const propRe = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;}]+)`, "gi")
  let changed = false
  const newBody = body.replace(propRe, (decl: string, val: string) => {
    const out = clamp(val)
    if (out !== val.trim()) changed = true
    return decl.replace(val, out)
  })
  return { body: newBody, changed }
}

/**
 * 对 <style> 中的 CSS 文本做间距/字号/宽度 clamp。
 * 策略：按选择器分级——hero 类视觉大区块用放宽上限（保留大留白/大标题设计意图），
 * 普通区块用常规上限；仅处理"可能产生大间距/大字号/超宽"的选择器，避免误伤紧凑元素。
 */
function clampCssSpacing(css: string): string {
  // 匹配完整的 CSS 规则块：选择器 { ... }
  return css.replace(
    /([^{}]+)\{([^{}]*)\}/g,
    (fullMatch: string, selectorPart: string, body: string) => {
      const sel = selectorPart.toLowerCase()
      // 只对 section / hero / footer / .section / .hero / .footer 等大容器做 clamp
      const isTarget =
        /(?:^|[\s,>+~(])(?:section|\.section|\.hero|\.banner|\.intro|footer|\.footer)(?:$|[\s,.:#\[{>~+)])/i.test(
          sel
        )
      const isHero = HERO_SELECTOR_RE.test(sel)
      const isHeading = /\bh[1-3]\b/.test(sel)
      if (!isTarget && !isHeading) return fullMatch

      const spacingLimits = isHero ? HERO_SPACING_LIMITS : SPACING_LIMITS
      const headingLimits = isHero
        ? HERO_HEADING_FONT_LIMITS
        : HEADING_FONT_LIMITS

      let changed = false
      let newBody = body

      if (isTarget) {
        for (const [prop, limit] of Object.entries(spacingLimits)) {
          const r = clampProperty(newBody, prop, (v) => clampPxValue(v, limit))
          newBody = r.body
          if (r.changed) changed = true
        }
        // 宽度兜底：超大 px / 超宽 vw 硬编码 clamp 到 100%，杜绝横向溢出
        for (const prop of ["width", "min-width"]) {
          const r = clampProperty(newBody, prop, clampWidthValue)
          newBody = r.body
          if (r.changed) changed = true
        }
      }

      if (isHeading) {
        for (const [tag, limit] of Object.entries(headingLimits)) {
          if (!new RegExp(`\\b${tag}\\b`, "i").test(sel)) continue
          const r = clampProperty(newBody, "font-size", (v) =>
            clampPxValue(v, limit)
          )
          newBody = r.body
          if (r.changed) changed = true
        }
      }

      return changed
        ? `${selectorPart}{${newBody}}`
        : fullMatch
    }
  )
}

/**
 * 后处理：强制修正骨架 HTML 中过大的间距值。
 * 在 ensureLayoutContract 之后调用，作为 LLM 生成间距不规范的兜底。
 */
export function normalizeThemeSpacing(layoutHtml: string): string {
  const dom = new JSDOM(layoutHtml)
  const doc = dom.window.document

  for (const style of Array.from(doc.querySelectorAll("style"))) {
    if (style.textContent) {
      style.textContent = clampCssSpacing(style.textContent)
    }
  }

  return dom.serialize()
}