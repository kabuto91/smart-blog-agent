import { JSDOM } from "jsdom"
import {
  prunePageRegions,
  pruneHomeSections,
  pruneDetailPage,
} from "./content-renderer"
import { stripRedundantFragmentWrappers } from "./layout-inject"
import {
  stripHardCodedTaxonomyLinks,
  stripNavLikeContainers,
  isNavLikeContainer,
} from "./content-extractor"
import {
  hasBodyNavClearance,
  normalizeNavClearanceCss,
  NAV_CLEARANCE_VAR,
} from "./nav-clearance"

export type BuiltinPageType = "home" | "list" | "detail"

export const BUILTIN_PAGE_TYPES: BuiltinPageType[] = ["home", "list", "detail"]

/**
 * 安全兜底样式层：作为布局 <head> 的最后一个 <style> 注入。
 * 只作用于 [data-page-host] 正文区（不影响导航/页脚），机械保证真实内容不外溢，
 * 弥补 LLM 骨架对长文本、固定宽度、刚性 grid 等溢出场景没有兜底的缺口。
 *
 * 【重要：全部用 :where() 包裹】
 * :where() 把特异性降为 0，因此骨架设计系统里的任何规则都优先于本兜底层，
 * 兜底只在骨架**没有管到**的场景才生效。
 * 早期版本用高特异性选择器（如 `[data-page-host] img { height: auto }`），
 * 会直接压掉骨架自己的封面高度（.cover-img { height: 320px }）造成版式塌陷；
 * `overflow-wrap: anywhere` 还会改变 flex/grid 子项的 min-content 尺寸，
 * 把多栏布局里的文字列压扁 —— 两者都已移除。
 */
export const THEME_SAFETY_CSS = `/* === theme-safety: 溢出安全兜底，勿手工修改 === */
/* 全部 :where() 包裹 → 特异性 0，骨架设计系统永远优先 */
:where(html, body) { max-width: 100%; overflow-x: clip; }
:where([data-page-host]) { box-sizing: border-box; max-width: 100%; }
:where([data-page-host], [data-page-host] *,
  [data-page-host] *::before, [data-page-host] *::after) { box-sizing: border-box; }
/* 行内/host 子元素最小宽度修正，避免 flex/grid 子项撑破容器。 */
:where([data-page-host] > *, [data-page-host] .container > *,
  [data-page-host] [class*="grid"] > *, [data-page-host] [class*="list"] > *) { min-width: 0; max-width: 100%; }
:where([data-page-host] img, [data-page-host] video, [data-page-host] iframe,
  [data-page-host] canvas, [data-page-host] svg, [data-page-host] table) { max-width: 100%; }
/* 注意：不再声明 img { height: auto } —— 会压掉骨架的封面/头像固定高度 */
:where([data-page-host] pre) { max-width: 100%; overflow-x: auto; }
/* 用 break-word（而非 anywhere）：anywhere 会改变 flex/grid 子项的 min-content 尺寸，
   导致多栏布局里的文字列被压扁变形；word-break: normal 取代已废弃的 break-word 值。 */
:where([data-page-host] p, [data-page-host] h1, [data-page-host] h2, [data-page-host] h3,
  [data-page-host] h4, [data-page-host] h5, [data-page-host] h6, [data-page-host] li,
  [data-page-host] dd, [data-page-host] a, [data-page-host] td, [data-page-host] th) {
  overflow-wrap: break-word; word-break: normal;
}
:where([data-page-host] .article-body,
  [data-page-host] [data-map="body"]) { overflow-wrap: break-word; word-break: normal; }
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
 * 2. :root 必须声明 --nav-h（导航自身高度，设计令牌），缺失时补默认值；
 * 3. 注入一个运行时脚本，按实际导航测量结果写入 --nav-clearance（固定顶部导航留白）。
 *    脚本**绝不修改 --nav-h** —— 它是设计令牌，被覆盖会连带破坏 sticky 偏移等设计计算。
 * 4. body/html 上的 var(--nav-h) 顶部留白归一为 var(--nav-clearance, 0px)，
 *    让"顶部留白"只由 --nav-clearance 承担。
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

  // 2. --nav-h 默认值（设计令牌；运行时脚本不会改动它）
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
  //    使存量主题在下次渲染时自动升级）。
  //    【关键】只写 --nav-clearance（固定顶部导航留白），绝不写 --nav-h：
  //    --nav-h 是设计令牌，旧版脚本把它无条件覆盖为测量值（吸顶/侧栏布局下为 0），
  //    会连带抹掉骨架里 .sidebar { top: calc(var(--nav-h) + 16px) } 之类的设计计算。
  for (const el of Array.from(
    body.querySelectorAll("script[data-theme-nav-measure]")
  )) {
    el.remove()
  }
  const script = doc.createElement("script")
  script.setAttribute("data-theme-nav-measure", "")
  script.textContent = `(function(){var sync=function(){var els=document.querySelectorAll('nav[data-content="main-nav"], nav, header');var h=0;for(var i=0;i<els.length;i++){var el=els[i];if(window.getComputedStyle(el).position!=='fixed'){continue;}var r=el.getBoundingClientRect();if(!(r.height>0&&r.width>0)){continue;}var vh=window.innerHeight||r.height;var vw=window.innerWidth||r.width;if(r.height>=vh*0.5){continue;}if(r.top>8){continue;}if(r.width<=r.height*1.5){continue;}if(!(r.width>=vw*0.7||r.left>0)){continue;}h=r.height;break;}var root=document.documentElement;if(h>0){root.style.setProperty('${NAV_CLEARANCE_VAR}',h+'px');}else{root.style.removeProperty('${NAV_CLEARANCE_VAR}');}};if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',sync);}else{sync();}window.addEventListener('resize',sync);})();`
  body.appendChild(script)

  // 5. 移除导航/页脚里硬编码的分类/标签/具体文章链接
  //    （LLM 常把导航拆成多组链接，只有第一组受配置管理，其余组是编造 slug 的
  //      静态标记 —— 既点了失效，又与正文的动态标签云/分类列表重复展示）
  stripHardCodedTaxonomyLinks(doc)

  // 6. 留白归一：body/html 的 var(--nav-h) 顶部留白 → var(--nav-clearance, 0px)
  for (const style of Array.from(doc.querySelectorAll("style"))) {
    if (style.textContent) {
      style.textContent = normalizeNavClearanceCss(style.textContent)
    }
  }

  // 7. 间距兜底：强制 clamp 过大的 padding/margin/gap
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
  // 渲染期兜底：页面片段里若残留了站点级 chrome（nav/footer/站点级 header/
  // 导航形态的容器），剥离掉 —— 布局已提供，重复渲染就会出现两个导航栏。
  // （生成期 sanitize 已处理，这里覆盖存量主题与任何绕过 sanitize 的路径。）
  // 仅当布局本身确实提供了导航时才剥离 —— 否则页面会一个导航都不剩。
  if (layoutHasNav(doc)) {
    stripSiteChrome(host, host)
  }
  // 剥离页面片段里复制来的布局骨架（LLM 照着骨架类名清单抄了整块布局），
  // 否则页面上会嵌套两层栅格，正文被挤进窄列。
  stripLayoutSkeleton(host, collectLayoutSkeletonClasses(doc))
  // 顶部留白统一由 --nav-clearance 承担（仅固定顶部导航时有值），
  // 布局自身已在 body 上提供顶部留白时不再叠加 host 留白（避免双重间距）。
  // 片段根部的冗余包裹（data-page-host / page-content）已由
  // stripRedundantFragmentWrappers 统一剥离 —— 早期这里还有第二套判定
  // （宽松正则匹配 page/main/content 词根），会导致片段根在某些布局下被
  // 拆散、某些布局下不被拆散，页面之间结构不一致。
  if (!hasBodyNavClearance(doc.documentElement.outerHTML)) {
    setHostPaddingTop(host, `var(${NAV_CLEARANCE_VAR}, 0px)`)
  }

  return dom.serialize()
}

/**
 * 判定布局里是否提供了导航。
 * 布局没有导航时，页面正文里的导航不能被剥掉（否则一个导航都不剩）。
 */
function layoutHasNav(doc: Document): boolean {
  if (doc.querySelector('[data-content-type="nav-list"]')) return true
  if (doc.querySelector("nav")) return true
  return Array.from(doc.querySelectorAll("aside, div, section")).some(
    isNavLikeContainer
  )
}

/**
 * 收集布局中正文宿主（[data-page-host]）的祖先容器 class。
 *
 * 这些 class 就是**布局骨架**（如 .layout-grid / .content-area）。
 * 页面片段里若出现同名容器，说明 LLM 把整块布局复制进了正文 —— 结果是
 * 页面上嵌套了两层栅格：正文被塞进内层栅格的窄列里（宽度骤减），
 * 同时导航也出现了第二份。
 */
export function collectLayoutSkeletonClasses(input: Document | string): Set<string> {
  const classes = new Set<string>()
  const doc =
    typeof input === "string"
      ? new JSDOM(input).window.document
      : input
  const host = doc.querySelector("[data-page-host]")
  let el = host?.parentElement ?? null
  while (el) {
    const tag = el.tagName.toLowerCase()
    if (tag === "body" || tag === "html") break
    for (const c of (el.getAttribute("class") ?? "").split(/\s+/)) {
      if (c) classes.add(c)
    }
    el = el.parentElement
  }
  return classes
}

/**
 * 剥离页面片段里复制来的布局骨架容器。
 *
 * 只针对「与布局骨架同名的容器」做处理 —— 不碰 .container/.wrap 这类
 * 通用内容容器（它们是页面自己该有的，剥掉会丢掉限宽与内边距）。
 */
function stripLayoutSkeleton(root: Element, skeletonClasses: Set<string>): void {
  if (skeletonClasses.size === 0) return
  // 从最外层开始剥离：外层剥掉后内层会提升上来
  const candidates = Array.from(
    root.querySelectorAll("div, main, section, aside, ul, ol")
  )
  for (const el of candidates) {
    const tokens = (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean)
    if (!tokens.some((t) => skeletonClasses.has(t))) continue
    unwrapElement(el)
  }
}

/**
 * 写入 host 的顶部留白内联样式。
 * 直接改写 style 属性而非走 CSSOM（element.style.xxx = ...）：
 * jsdom 的 cssstyle 对 `var()` 的处理曾多次丢值（见 18c5e0a 修复），
 * 用属性拼接可彻底绕开这层不确定性。
 */
function setHostPaddingTop(host: HTMLElement, value: string): void {
  const existing = (host.getAttribute("style") ?? "").trim()
  const decl = `padding-top: ${value};`
  host.setAttribute("style", existing ? `${existing} ${decl}` : decl)
}

/**
 * 把单页生成器输出的"完整独立文档"净化为可直接注入布局的正文片段：
 * - 丢弃 <html>/<head>/<body> 包裹，以及页面自带的 <script>/<style> 等；
 * - 丢弃页面自带的导航/页脚等站点 chrome（由布局统一提供）；
 * - 剥离片段根部的 data-page-host / page-content 冗余包裹；
 * - 把常见的"页面专属容器类"桥接到共享设计系统类（追加式：保留原类名 + 追加目标类）。
 */
const PAGE_CHROME_SELECTORS =
  ".reading-progress, .back-to-top, .to-top, #readingProgress"
/**
 * 页面专属容器类 → 共享设计系统类的桥接表。
 *
 * 【追加式桥接（观察期）】
 * 早期实现是「映射即替换」：把 `.post-list` 直接换成 `.article-list`。
 * 由于两个类往往在骨架里同时存在且语义不同（纵向流 vs 三列网格），
 * 静默替换会直接把页面的排版改写掉 —— 这是「文章排版错乱」的主要来源之一。
 *
 * 现在改为**追加**：保留原类名，同时补上骨架里存在的目标类，
 * 让页面原有的样式（间距/边框/配色）不被丢弃。
 * 桥接命中情况通过 SanitizeReport 回传，便于统计观察一轮后再决定是否彻底移除。
 */
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

/**
 * 桥接源类名集合。
 * 这些类名本身可能不在骨架 CSS 里（它们的样式由映射到的目标类提供），
 * 因此**不能**被判定为「使用了骨架未定义的类名」——
 * 否则页面会因为桥接机制本身而被判丢样式（假阳性 → 无休止修订）。
 */
export const CLASS_BRIDGE_SOURCE_CLASSES: ReadonlySet<string> = new Set(
  Object.keys(CLASS_BRIDGE)
)

/** 净化过程的可观测报告（用于观察桥接/剥离的实际命中情况）。 */
export interface SanitizeReport {
  /** 实际生效的类名桥接：源类名 -> 追加的目标类名 */
  bridges: Record<string, string>
  /** 被剥离的违规标签名（去重） */
  removedTags: string[]
}

/** 创建一份空的净化报告。 */
export function createSanitizeReport(): SanitizeReport {
  return { bridges: {}, removedTags: [] }
}

/**
 * 判定 <header> 是否是「站点级页头」需要剥离。
 * 文章/卡片内部的 <header>（如 <article><header><h1>标题</h1></header></article>）
 * 是合法的语义结构，必须保留；只有容器直属的才视为站点级页头。
 */
function isSiteLevelHeader(el: Element, scope: Element): boolean {
  const parent = el.parentElement
  if (!parent) return false
  if (parent === scope) return true
  const tag = parent.tagName.toLowerCase()
  return tag === "body" || tag === "html"
}

/**
 * 剥离站点级 chrome：nav / footer / 站点级 header / 导航形态的容器。
 *
 * 布局已统一提供这些元素，页面正文里再出现就是**重复渲染**
 * （最典型的表现：页面上出现两个导航栏 —— LLM 常把导航写成
 *  <aside class="sidebar-nav">，只按 <nav> 标签判定会漏掉）。
 *
 * 生成期由 sanitizePageFragment 处理，渲染期（合并正文时）再兜一次 ——
 * 存量主题与任何绕过 sanitize 的路径都被覆盖。
 *
 * @param root 要清理的容器
 * @param scope 判定「容器直属」用的参照（sanitize 时是 body，合并时是正文宿主）
 */
function stripSiteChrome(root: Element, scope: Element): void {
  for (const el of Array.from(root.querySelectorAll("nav, footer"))) {
    el.remove()
  }
  for (const el of Array.from(root.querySelectorAll("header"))) {
    if (!isSiteLevelHeader(el, scope)) continue
    el.remove()
  }
  stripNavLikeContainers(root)
}

/** 解包元素：用其子节点替换自身（保留内容，只拆掉多余容器）。 */
function unwrapElement(el: Element): void {
  const parent = el.parentElement
  if (!parent) return
  while (el.firstChild) {
    parent.insertBefore(el.firstChild, el)
  }
  el.remove()
}

export function sanitizePageFragment(
  rawHtml: string,
  layoutClasses?: Set<string>,
  report?: SanitizeReport
): string {
  const dom = new JSDOM(rawHtml)
  const doc = dom.window.document
  const body = doc.body

  const noteRemoved = (tag: string) => {
    if (report && !report.removedTags.includes(tag)) report.removedTags.push(tag)
  }

  for (const el of Array.from(
    body.querySelectorAll("script, style, link, meta, title, template, noscript")
  )) {
    noteRemoved(el.tagName.toLowerCase())
    el.remove()
  }
  // 导航/页脚由布局统一提供，页面片段里再出现就是重复 chrome —— 强制剥离。
  // （旧实现只在校验阶段报告、不剥离，fastMode 下修订次数用完就直接提交，
  //   线上会出现第二个导航栏。）
  stripSiteChrome(body, body)
  for (const el of Array.from(body.querySelectorAll(PAGE_CHROME_SELECTORS))) {
    el.remove()
  }

  // 片段里的 data-page-host 一律非法（正文容器由布局唯一提供）。
  // 根部的由 stripRedundantFragmentWrappers 剥离；嵌套的在这里解包
  // （保留子节点，只拆掉多余容器），避免正文被塞进嵌套容器。
  for (const el of Array.from(body.querySelectorAll("[data-page-host]"))) {
    unwrapElement(el)
  }

  for (const el of Array.from(body.querySelectorAll<HTMLElement>("[class]"))) {
    const classes = (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean)
    const bridged: string[] = []
    const kept = classes.map((cls) => {
      const target = CLASS_BRIDGE[cls]
      // 上下文感知：仅当映射目标确实存在于骨架类集时才桥接，
      // 否则保留原类名，避免追加一个不存在的类而无声丢样。
      if (target === undefined) return cls
      if (layoutClasses && !layoutClasses.has(target)) return cls
      // 「时间锚点」侧边栏的归档条目复用 archive-title 作小字号列表项标题，
      // 不应被桥接成页面大标题 page-title（仅页面级归档标题才需要桥接）。
      if (cls === "archive-title" && el.closest(".archive-item, .archive-list")) {
        return cls
      }
      bridged.push(target)
      if (report) report.bridges[cls] = target
      // 追加式：原类名保留，目标类追加其后
      return cls
    })
    const final = Array.from(new Set([...kept, ...bridged]))
    if (final.length !== classes.length || final.some((c, i) => c !== classes[i])) {
      el.setAttribute("class", final.join(" ") || el.tagName.toLowerCase())
    }
  }

  // 片段根部的 data-page-host / page-content 包裹由布局提供，统一剥离，
  // 避免存进库里的片段自带第二个 host（与布局的占位语义冲突）。
  return stripRedundantFragmentWrappers(body.innerHTML)
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
  // 导航形态的容器（如 <aside class="sidebar-nav">）：布局已提供导航，
  // 页面正文里再有一份就是重复渲染（页面上会出现两个导航栏）。
  const navLike = Array.from(
    doc.querySelectorAll("aside, div, section")
  ).filter(isNavLikeContainer)
  if (navLike.length > 0) {
    issues.push(
      `页面片段包含重复的导航容器（${navLike
        .map((el) => `<${el.tagName.toLowerCase()} class="${el.getAttribute("class") ?? ""}">`)
        .join("、")}），导航由布局统一提供，必须移除`
    )
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