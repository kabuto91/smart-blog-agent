import { JSDOM } from "jsdom"
import type { ContentConfig, DynamicField, NavField, TextField } from "../types/content-config"
import { FIELD_DEFINITIONS } from "../field-registry"

export interface ArticleData {
  id: string | number
  title: string
  excerpt: string
  date: string
  category?: string
  slug: string
  contentHtml?: string
  tags?: string[]
  /** 封面图 URL，无封面时为空字符串 */
  cover?: string
}

export interface CategoryData {
  id: string | number
  name: string
  slug: string
  count?: number
}

export interface TagData {
  id: string | number
  name: string
  slug: string
}

export interface PaginationData {
  page: number
  totalPages: number
  basePath: string
}

export interface DynamicData {
  articles?: ArticleData[]
  /** 后台精选文章（data-content="featured-articles" 区块专用），按配置顺序。 */
  featuredArticles?: ArticleData[]
  categories?: CategoryData[]
  tags?: TagData[]
  pagination?: PaginationData
}

/** 「精选文章」区块对应的 data-content key。 */
export const FEATURED_LIST_KEY = "featured-articles"

export interface RenderOptions {
  /**
   * 拆分式主题渲染：页面正文已按类型独立成片段（由生成管线负责剪枝），
   * 渲染时不再运行按 data-page-type / hero 正则猜测的启发式剪枝，
   * 避免误删正文内容造成与骨架样式冲突。
   */
  pageSpecific?: boolean
}

export function renderContent(
  htmlTemplate: string,
  contentConfig: ContentConfig,
  dynamicData?: DynamicData,
  siteConfig?: Record<string, string>,
  options?: RenderOptions,
  reusableTexts?: Record<string, string>
): string {
  const dom = new JSDOM(htmlTemplate)
  const doc = dom.window.document

  const fields = { ...contentConfig }
  augmentGlobalFields(doc, fields, siteConfig)

  for (const [key, field] of Object.entries(fields)) {
    if (field.type === "text") {
      const value = resolveTextValue(field, siteConfig, reusableTexts)
      renderTextField(doc, key, value)
    } else if (
      field.type.startsWith("dynamic-") ||
      field.type === "article-body"
    ) {
      renderDynamicField(doc, key, field as DynamicField, dynamicData)
    } else if (field.type === "nav-list") {
      renderNavField(doc, key, field as NavField)
    }
  }

  const pageType = resolvePageType(dynamicData)

  for (const el of Array.from(doc.querySelectorAll("[data-route]"))) {
    el.remove()
  }

  if (!options?.pageSpecific) {
    prunePageRegions(doc, pageType)

    if (pageType === "detail") {
      pruneDetailPage(doc)
    }

    if (pageType === "list" || pageType === "detail") {
      pruneHomeSections(doc)
    }
  }

  ensureMultipleAvatarPlaces(doc, siteConfig?.["author-avatar"])
  applyAvatarOverflow(doc, siteConfig?.["author-avatar"])
  fillGradientAvatarPlaceholders(doc, siteConfig?.["author-avatar"])
  ensureSingleAuthorAvatar(doc)

  renderStaticTaxonomyLists(doc, dynamicData)
  renderStaticArchiveList(doc, dynamicData)

  return dom.serialize()
}

export type PageType = "home" | "list" | "detail"

export function resolvePageType(dynamicData?: DynamicData): PageType {
  if (dynamicData?.articles?.[0]?.contentHtml) return "detail"
  if (dynamicData?.pagination) return "list"
  return "home"
}

function pageTypesOf(el: Element): string[] {
  return (el.getAttribute("data-page-type") ?? "")
    .split(/\s+/)
    .filter(Boolean)
}

export function prunePageRegions(doc: Document, pageType: PageType): void {  for (const el of Array.from(doc.querySelectorAll("[data-page-type]"))) {
    const types = pageTypesOf(el)
    if (types.length > 0 && !types.includes(pageType)) {
      el.remove()
    }
  }

  if (pageType !== "home") {
    for (const el of Array.from(doc.querySelectorAll("[data-home-only]"))) {
      el.remove()
    }
  }
}

const HOME_SECTION_CLASS_RE = /(^|[\s_\-])(hero|banner|intro)([\s_\-])?/i
const ARCHIVE_CTA_RE = /(更多文章|查看全部|查看所有|全部文章|全部博文|查看更多)/
const RECENT_HEADING_RE = /(近期文章|最新文章|最近文章|最新发布)/

export function pruneHomeSections(doc: Document): void {
  for (const el of Array.from(
    doc.querySelectorAll("section, div, aside, header")
  )) {
    if (el.hasAttribute("data-page-type")) continue
    const tag = el.tagName.toLowerCase()
    if (tag === "header") continue
    const cls = el.getAttribute("class") ?? ""
    const id = el.getAttribute("id") ?? ""
    if (!HOME_SECTION_CLASS_RE.test(cls) && !HOME_SECTION_CLASS_RE.test(id)) {
      continue
    }
    if (isInside(el, "nav") || isInside(el, "footer")) continue
    if (el.querySelector('[data-content-type="dynamic-articles"]')) continue
    if (el.querySelector("[data-content]")) continue
    el.remove()
  }

  for (const a of Array.from(doc.querySelectorAll("a"))) {
    const href = a.getAttribute("href") ?? ""
    const isArchiveLink =
      href === "/blog/archive" ||
      href === "/archive" ||
      href.endsWith("/blog/archive") ||
      href.endsWith("/archive")
    if (!isArchiveLink) continue
    if (!ARCHIVE_CTA_RE.test(a.textContent ?? "")) continue
    if (isInside(a, "nav") || isInside(a, "footer")) continue
    removeWithEmptyWrapper(a)
  }

  const listContainer = doc.querySelector(
    '[data-content-type="dynamic-articles"]'
  )
  if (listContainer) {
    let parent = listContainer.parentElement
    while (
      parent &&
      parent.tagName.toLowerCase() !== "body" &&
      parent.tagName.toLowerCase() !== "html"
    ) {
      const heading = findRecentHeading(parent)
      if (heading) removeWithEmptyWrapper(heading)
      parent = parent.parentElement
    }
  }
}

function findRecentHeading(parent: Element): Element | null {
  for (const child of Array.from(parent.children) as Element[]) {
    if (child.hasAttribute("data-page-type")) continue
    if (child.querySelector("[data-content]")) continue
    const text = child.textContent ?? ""
    if (!RECENT_HEADING_RE.test(text)) continue
    const heading = findHeadingLike(child)
    if (heading) return heading
  }
  return null
}

function findHeadingLike(root: Element): Element | null {
  const tag = root.tagName.toLowerCase()
  const cls = root.getAttribute("class") ?? ""
  const id = root.getAttribute("id") ?? ""
  const selfLike =
    /^h[1-6]$/.test(tag) ||
    /(label|title|heading)/i.test(cls) ||
    /(label|title|heading)/i.test(id)
  if (selfLike) return root
  return (
    root.querySelector(
      "h1,h2,h3,h4,h5,h6,[class*='label'],[class*='title'],[class*='heading']"
    ) ?? null
  )
}

function isInside(el: Element, selector: string): boolean {
  return !!el.closest(selector)
}

function removeWithEmptyWrapper(el: Element): void {
  let node: Element | null = el
  while (node) {
    const parent: Element | null = node.parentElement
    node.remove()
    if (!parent) break
    if (parent.hasAttribute("data-content")) break
    const tag = parent.tagName.toLowerCase()
    if (tag === "body" || tag === "html") break
    if (parent.children.length > 0) break
    if ((parent.textContent ?? "").trim() !== "") break
    node = parent
  }
}

/**
 * 移除封面图块：删除 img，若其父容器已无其他元素与文字（纯包裹），
 * 则连同空容器一并移除，避免留下高度占位；a/ul/ol 等结构容器不删除。
 */
function removeCoverBlock(el: Element): void {
  let node: Element | null =
    el.tagName.toLowerCase() === "img" ? el : el.querySelector("img")
  while (node) {
    const parent: Element | null = node.parentElement
    node.remove()
    if (!parent) break
    const tag = parent.tagName.toLowerCase()
    if (tag === "body" || tag === "html") break
    if (tag === "a" || tag === "ul" || tag === "ol") break
    if (parent.hasAttribute("data-content")) break
    if (parent.children.length > 0) break
    if ((parent.textContent ?? "").trim() !== "") break
    node = parent
  }
}

function isChromeElement(el: Element): boolean {
  const tag = el.tagName.toLowerCase()
  if (tag === "header" || tag === "footer" || tag === "nav") return true
  return pageTypesOf(el).includes("detail")
}

export function pruneDetailPage(doc: Document): void {
  const bodyEl = doc.querySelector('[data-content="article-body"]')
  if (!bodyEl) return

  for (const aside of Array.from(doc.querySelectorAll("aside"))) {
    if (!isChromeElement(aside)) aside.remove()
  }

  let node: Element | null = bodyEl
  while (node && node.parentElement) {
    const parent: Element = node.parentElement as Element
    const tag = parent.tagName.toLowerCase()
    if (tag === "body" || tag === "html") break
    for (const child of Array.from(parent.children) as Element[]) {
      if (child !== node && !isChromeElement(child) && !child.hasAttribute("data-content")) child.remove()
    }
    node = parent
  }
}

export function ensureAvatarOverflow(html: string): string {
  const dom = new JSDOM(html)
  applyAvatarOverflow(dom.window.document)
  return dom.serialize()
}

/**
 * 兜底：确保页面正文区域（[data-page-host]）中至少有一处头像显示。
 * 导航栏的头像由骨架/SKELETON_SYSTEM_PROMPT 保证，但页面正文区域（hero/作者简介/文章底部）
 * 的头像依赖 LLM 生成，不一定存在。此函数在渲染完成后检测正文区域，
 * 若无任何头像标记则自动注入，保证所有页面都至少显示作者头像。
 */
export function ensureMultipleAvatarPlaces(doc: Document, avatarUrl?: string): void {
  if (!avatarUrl) return

  const host = doc.querySelector<HTMLElement>("[data-page-host]")
  if (!host) return

  // 检查正文区域内是否已有头像元素
  const hasAvatarInBody =
    host.querySelector('[data-content="author-avatar"]') ||
    host.querySelector("img.avatar") ||
    host.querySelector("img[class*='avatar']") ||
    Array.from(host.querySelectorAll<HTMLElement>("[class]")).some((el) =>
      (el.getAttribute("class") || "").toLowerCase().includes("avatar")
    )

  if (hasAvatarInBody) return

  // 按优先级寻找注入位置：<aside> > 含 author/bio/sidebar 的容器 > 正文首部
  const target = (
    [
      host.querySelector("aside"),
      host.querySelector<HTMLElement>(
        "[class*='author'], [class*='bio'], [class*='sidebar'], [class*='widget'], [class*='about']"
      ),
    ] as (Element | null)[]
  )
    .filter((el): el is Element => !!el)
    .find((el) => containerHasTextBesidesAvatar(el))

  const avatarHtml = `<img class="avatar" src="${avatarUrl}" alt="作者头像" style="width:64px;height:64px;border-radius:50%;object-fit:cover;overflow:hidden;">`

  // 仅当作者信息容器内已有可读文字（姓名/简介）时才注入头像，
  // 避免出现「只有头像、没有文字」的孤立区块。
  // 若正文没有任何可承载作者信息的容器，则不再强行在正文顶部插入裸头像。
  if (target) {
    target.insertAdjacentHTML("afterbegin", avatarHtml)
  }
}

/**
 * 判断容器内（除头像元素外）是否还有可读文字，
 * 避免把头像注入到空容器后形成孤立头像块。
 */
function containerHasTextBesidesAvatar(el: Element): boolean {
  const clone = el.cloneNode(true) as Element
  for (const avatar of Array.from(
    clone.querySelectorAll(
      "img.avatar, img[class*='avatar'], [class*='avatar']"
    )
  )) {
    avatar.remove()
  }
  return (clone.textContent ?? "").replace(/\s/g, "").length > 0
}

const AUTHOR_AREA_RE = /(author|bio|about|sidebar|widget|intro|profile)/i

/** 判断元素是否位于作者/简介相关容器内（用于挑选应保留的头像）。 */
function hasAuthorAncestor(el: Element): boolean {
  let node: Element | null = el
  while (node) {
    const cls = node.getAttribute("class") ?? ""
    const id = node.getAttribute("id") ?? ""
    if (AUTHOR_AREA_RE.test(cls) || AUTHOR_AREA_RE.test(id)) return true
    node = node.parentElement
  }
  return false
}

/** 收集文档中的作者头像元素（仅显式标记，不含装饰性渐变圆）。 */
function collectAvatarElements(doc: Document): Element[] {
  return Array.from(
    doc.querySelectorAll<HTMLElement>(
      '[data-content="author-avatar"], img.avatar'
    )
  )
}

/**
 * 渲染兜底：保证全页作者头像只出现 1 个，消除「导航+hero+作者区」多处重复。
 * 优先保留作者/简介区内的头像，其次正文区，最后取文档首个；其余多余头像直接移除
 * （仅移除头像元素本身，保留兄弟文字与结构）。
 */
export function ensureSingleAuthorAvatar(doc: Document): void {
  const avatars = collectAvatarElements(doc)
  if (avatars.length <= 1) return

  const keeper =
    avatars.find((el) => el.closest("[data-page-host]") && hasAuthorAncestor(el)) ||
    avatars.find((el) => hasAuthorAncestor(el)) ||
    avatars.find((el) => !!el.closest("[data-page-host]")) ||
    avatars[0]

  for (const el of avatars) {
    if (el !== keeper) el.remove()
  }
}

/**
 * 静态分类/标签列表兜底：LLM 生成的主题常在同一个容器（如 <ul class="tag-list">）
 * 里硬编码混合的标签与分类链接（<a href="/blog/tag/xxx">、<a href="/blog/category/xxx">），
 * 且未标记 data-content-type="dynamic-tags"/"dynamic-categories"，导致后台维护的分类/标签无法注入。
 * 此处识别这类"未标记的分类/标签链接列表"，用数据库分类/标签逐项重建列表数据
 * （保留如 ALL 等非分类/标签项，并移除无数据的冗余坑位），保证展示的即后台维护的数据。
 */
function renderStaticTaxonomyLists(doc: Document, data?: DynamicData): void {
  const tags = data?.tags ?? []
  const categories = data?.categories ?? []
  if (tags.length === 0 && categories.length === 0) return

  // 跳过由正规动态渲染/导航维护的容器（其内的分类/标签链接不属硬编码列表）
  const inManagedContainer = (a: Element): boolean =>
    !!a.closest(
      '[data-content-type="dynamic-tags"],' +
        '[data-content-type="dynamic-categories"],' +
        '[data-content-type="nav-list"],' +
        "nav, footer"
    )

  const taxonomySelector = 'a[href*="/blog/tag/"], a[href*="/blog/category/"]'
  const anchors = Array.from(
    doc.querySelectorAll<HTMLAnchorElement>(taxonomySelector)
  )

  const processed = new Set<Element>()
  for (const anchor of anchors) {
    if (inManagedContainer(anchor)) continue
    // 从链接向祖先找分类/标签列表容器，要求容器内分类/标签链接总数 ≥2
    let anc: Element | null = anchor.parentElement
    while (anc && !isStructuralTaxonomyStop(anc)) {
      const children = Array.from(anc.children).filter((c) =>
        isTaxonomyLink(c, taxonomySelector)
      )
      if (children.length >= 2 && !processed.has(anc)) {
        processed.add(anc)
        rebuildTaxonomyList(anc, tags, categories)
        break
      }
      anc = anc.parentElement
    }
  }
}

/**
 * 判定元素自身是否为（或包含）分类/标签链接。
 * 列表项可能是容器（li/div 内嵌 <a>），也可能是链接自身（<a class="tag"> 直接平铺），
 * 二者都算一个分类/标签坑位。
 */
function isTaxonomyLink(el: Element, selector: string): boolean {
  return el.matches?.(selector) || !!el.querySelector?.(selector)
}

/**
 * 分类/标签列表探测的「结构性容器」边界：到达这些容器就停止向上冒泡，
 * 绝不把它们整体当成分类/标签列表重建（如页面宿主 data-page-host、main 等
 * 承载整页区块的容器——其子区块各自含分类链接时会被误判并整块重写/删除）。
 */
function isStructuralTaxonomyStop(el: Element): boolean {
  const tag = el.tagName.toLowerCase()
  return (
    tag === "body" ||
    tag === "html" ||
    tag === "main" ||
    tag === "header" ||
    tag === "footer" ||
    tag === "nav" ||
    el.hasAttribute("data-page-host")
  )
}

/** 用数据库分类/标签按序重建容器内的列表项；保留非分类/标签项（如 ALL）。
 * 一个容器按"是否含分类链接"整体判定为分类列表或标签列表，避免分类区混入标签。 */
function rebuildTaxonomyList(
  container: Element,
  tags: TagData[],
  categories: CategoryData[]
): void {
  const items = Array.from(container.children) as Element[]
  const catSelector = 'a[href*="/blog/category/"]'
  const tagSelector = 'a[href*="/blog/tag/"]'
  const taxonomySelector = `${catSelector}, ${tagSelector}`
  // 列表项可能是容器（li/div 内嵌 <a>），也可能是链接自身（<a class="tag"> 直接平铺）
  const isCat = (el: Element): boolean => isTaxonomyLink(el, catSelector)
  const isTax = (el: Element): boolean => isTaxonomyLink(el, taxonomySelector)

  const hasCategory = items.some(isCat)
  const template = items.find(isCat) ?? items.find((i) => isTaxonomyLink(i, tagSelector)) ?? null
  const data = (hasCategory ? categories : tags) as (TagData | CategoryData)[]
  const hrefPrefix = hasCategory ? "/blog/category/" : "/blog/tag/"

  // 用模板项克隆出单个列表项，并替换分类/标签链接为维护数据
  const makeItem = (template: Element, href: string, name: string): Element => {
    const li = template.cloneNode(true) as Element
    for (const node of li.querySelectorAll<HTMLElement>("[data-content], [data-map]")) {
      node.removeAttribute("data-content")
      node.removeAttribute("data-content-type")
      node.removeAttribute("data-map")
    }
    // 模板自身就是链接项时直接改写自身（querySelector 不匹配自身）
    const a = li.matches("a[href]")
      ? (li as HTMLAnchorElement)
      : li.querySelector<HTMLAnchorElement>("a[href]")
    if (a) {
      a.setAttribute("href", href)
      a.textContent = name
    }
    return li
  }

  let index = 0
  for (const li of items) {
    if (!isTax(li)) continue
    if (index < data.length) {
      li.replaceWith(
        makeItem(
          template as Element,
          `${hrefPrefix}${data[index].slug}`,
          data[index].name
        )
      )
      index++
    } else {
      // 无数据可填的坑位：整项移除，避免残留空 <li>
      li.remove()
    }
  }
}

/**
 * 静态日期归档列表的兜底替换。
 *
 * 背景：LLM 生成主题时可能把侧边栏「时间锚点 / 归档」这类
 * 「日期 + 标题」的紧凑列表错误建模成静态文本（data-content="archive-date-N" /
 * archive-title-N，data-content-type="text"），导致一直展示主题的样例日期。
 * 与 renderStaticTaxonomyLists 类似，这里对静态归档列表做兜底：
 * 一旦检测到，就用最新文章（dynamicData.articles）的日期、标题、链接重建，
 * 使这类区块自动跟随真实文章数据，无需重新生成主题。
 */
function renderStaticArchiveList(doc: Document, data?: DynamicData): void {
  const articles = data?.articles ?? []
  if (articles.length === 0) return

  const isArchiveItem = (el: Element): boolean => {
    const cls = (el.className ?? "").toString()
    if (/\barchive-(item|date|title)\b/.test(cls)) return true
    return !!el.querySelector(
      '[data-content^="archive-date-"], [data-content^="archive-title-"]'
    )
  }

  // 归档列表容器探测的上浮边界：到达结构性容器或已由动态渲染管理的区域即停止
  const boundary = (el: Element): boolean => {
    const tag = el.tagName.toLowerCase()
    return (
      tag === "body" ||
      tag === "html" ||
      tag === "main" ||
      tag === "header" ||
      tag === "footer" ||
      tag === "nav" ||
      el.hasAttribute("data-page-host") ||
      !!el.closest('[data-content-type="dynamic-articles"]')
    )
  }

  const candidates = Array.from(doc.querySelectorAll("li, div, span")).filter(
    isArchiveItem
  )
  const processed = new Set<Element>()
  for (const item of candidates) {
    let anc: Element | null = item.parentElement
    while (anc && !boundary(anc)) {
      const children = Array.from(anc.children).filter(isArchiveItem)
      if (children.length >= 2 && !processed.has(anc)) {
        processed.add(anc)
        rebuildArchiveList(anc, articles)
        break
      }
      anc = anc.parentElement
    }
  }
}

/** 用最新文章按序重建静态归档列表；项数不超过原模板的坑位数。 */
function rebuildArchiveList(
  container: Element,
  articles: ArticleData[]
): void {
  const isArchiveItem = (el: Element): boolean => {
    const cls = (el.className ?? "").toString()
    if (/\barchive-(item|date|title)\b/.test(cls)) return true
    return !!el.querySelector(
      '[data-content^="archive-date-"], [data-content^="archive-title-"]'
    )
  }
  const items = Array.from(container.children).filter(isArchiveItem)
  const template = items[0]
  if (!template) return

  const limit = Math.min(articles.length, items.length)
  const newItems: Element[] = []
  for (let i = 0; i < limit; i++) {
    const a = articles[i]
    const li = template.cloneNode(true) as Element
    // 去掉模板的静态文本标记，避免渲染时被当作文本字段再次处理
    for (const node of li.querySelectorAll("[data-content]")) {
      node.removeAttribute("data-content")
      node.removeAttribute("data-content-type")
    }
    const dateEl =
      li.querySelector(".archive-date, [data-content^='archive-date-']") ??
      li.querySelector("span")
    const titleLink = li.matches("a[href]")
      ? (li as HTMLAnchorElement)
      : li.querySelector<HTMLAnchorElement>("a[href], .archive-title")
    if (dateEl) dateEl.textContent = a.date
    if (titleLink) {
      titleLink.setAttribute("href", `/blog/${a.slug}`)
      titleLink.textContent = a.title
    }
    newItems.push(li)
  }
  for (const it of items) it.remove()
  for (const it of newItems) container.appendChild(it)
}

/** 判断元素是否为「纯 CSS 圆形渐变头像占位」（无 data-content、无 img、无文字）。 */
function isGradientAvatarEl(el: Element): boolean {
  const tag = el.tagName.toLowerCase()
  if (tag !== "div" && tag !== "span") return false
  if (el.hasAttribute("data-content")) return false
  if (el.querySelector("img")) return false
  if ((el.textContent ?? "").trim() !== "") return false
  const style = (el.getAttribute("style") ?? "")
    .replace(/\s/g, "")
    .toLowerCase()
  if (!style) return false
  const isRound =
    /(?:^|;)border-radius:\s*(?:var\(--radius-full\)|50%|100%|9999px)(?:;|$)/.test(
      style
    )
  if (!isRound) return false
  if (!/(linear|radial)-gradient/.test(style)) return false
  const w = /(?:^|;)width:(\d+(?:\.\d+)?)px(?:;|$)/.exec(style)
  const h = /(?:^|;)height:(\d+(?:\.\d+)?)px(?:;|$)/.exec(style)
  if (!w || !h) return false
  const width = Number(w[1])
  const height = Number(h[1])
  if (Math.abs(width - height) > 1) return false
  if (width < 24 || width > 200) return false
  return true
}

/**
 * 兜底：把「圆形 + 渐变背景」的纯 CSS 头像占位（无 <img>、无 data-content）
 * 用上传的作者头像填充，覆盖生成器只愿用渐变圆圈的情况。
 */
function fillGradientAvatarPlaceholders(
  doc: Document,
  avatarUrl?: string
): void {
  if (!avatarUrl) return
  for (const el of Array.from(doc.querySelectorAll<HTMLElement>("div, span"))) {
    if (el.closest('[data-content="article-body"]')) continue
    if (!isGradientAvatarEl(el)) continue
    el.style.backgroundImage = `url("${avatarUrl}")`
    el.style.backgroundSize = "cover"
    el.style.backgroundPosition = "center"
    el.style.backgroundRepeat = "no-repeat"
  }
}

function applyAvatarOverflow(doc: Document, avatarUrl?: string): void {
  const elements = Array.from(doc.querySelectorAll<HTMLElement>("[class]")).filter((el) =>
    (el.getAttribute("class") || "").toLowerCase().includes("avatar")
  )

  for (const el of elements) {
    const isImgEl = el.tagName.toLowerCase() === "img"
    el.style.overflow = "hidden"
    const img = isImgEl
      ? null
      : el.querySelector<HTMLImageElement>("img")
    if (isImgEl) {
      const self = el as HTMLImageElement
      self.style.objectFit = "cover"
      self.style.display = "block"
      if (avatarUrl && !el.hasAttribute("data-content")) {
        self.setAttribute("src", avatarUrl)
      }
    } else if (img) {
      img.style.width = "100%"
      img.style.height = "100%"
      img.style.objectFit = "cover"
      img.style.display = "block"
      if (avatarUrl && !el.hasAttribute("data-content")) {
        img.setAttribute("src", avatarUrl)
      }
    }
  }
}

function augmentGlobalFields(
  doc: Document,
  contentConfig: ContentConfig,
  siteConfig?: Record<string, string>
): void {
  if (!siteConfig) return
  for (const [key, value] of Object.entries(siteConfig)) {
    if (!value) continue
    const el = doc.querySelector(`[data-content="${key}"]`)
    if (!el) continue
    const def = FIELD_DEFINITIONS[key]
    contentConfig[key] = {
      type: "text",
      label: def?.label ?? key,
      value,
      source: def?.readonly ? "readonly" : "global",
      globalKey: key,
    }
  }

  // 兜底：处理全局字段的衍生 key（如 author-avatar-2），
  // 使其继承主 key 的值，避免 LLM 生成的重复占位无法被填充
  for (const [baseKey, value] of Object.entries(siteConfig)) {
    if (!value) continue
    if (!FIELD_DEFINITIONS[baseKey]) continue
    const els = doc.querySelectorAll(`[data-content^="${baseKey}-"]`)
    for (const el of Array.from(els)) {
      const key = el.getAttribute("data-content")!
      const existing = contentConfig[key] as TextField | undefined
      // 已有非空值则保留，否则用主 key 的值覆盖
      if (existing && existing.type === "text" && existing.value) continue
      contentConfig[key] = {
        type: "text",
        label: key,
        value,
        source: "global",
        globalKey: baseKey,
      }
    }
  }
}

function resolveTextValue(
  field: TextField,
  siteConfig?: Record<string, string>,
  reusableTexts?: Record<string, string>
): string {
  if (field.source === "global" && field.globalKey && siteConfig?.[field.globalKey] !== undefined) {
    return siteConfig[field.globalKey]
  }
  if (
    field.source === "reusable-text" &&
    reusableTexts &&
    Object.prototype.hasOwnProperty.call(reusableTexts, field.textKey ?? "")
  ) {
    const v = reusableTexts[field.textKey ?? ""]
    if (v !== undefined) return v
  }
  return field.value
}

function renderTextField(doc: Document, key: string, value: string): void {
  const els = Array.from(doc.querySelectorAll(`[data-content="${key}"]`))
  if (els.length === 0) return

  for (let idx = 0; idx < els.length; idx++) {
    const el = els[idx]

    // 判断是否为 img 元素（或包含 img 子元素）
    let img: HTMLImageElement | null = null
    if (el.tagName.toLowerCase() === "img") {
      img = el as HTMLImageElement
    } else {
      const first = el.firstElementChild
      if (first && first.tagName.toLowerCase() === "img") {
        img = first as HTMLImageElement
      }
    }

    // 跳过属于 nav-list 容器的文字元素，避免覆盖导航标签；img 元素（如头像）不受影响
    if (!img && el.closest('[data-content-type="nav-list"]')) {
      continue
    }

    // data-map 元素由动态字段渲染填充真实值（如文章标题/分类/日期），
    // 文本字段再用样本占位值覆盖会冲掉真实数据
    if (!img && el.hasAttribute("data-map")) {
      continue
    }

    if (img) {
      if (value) img.setAttribute("src", value)
      continue
    }

    // 配置值为空（未配置）时保留主题生成的占位文本，不清空页面
    if (!value) continue
    el.textContent = value
  }
}

function renderDynamicField(
  doc: Document,
  key: string,
  field: DynamicField,
  dynamicData?: DynamicData
): void {
  const container = doc.querySelector(`[data-content="${key}"]`)
  if (!container) return

  if (field.type === "dynamic-list") {
    renderCustomListField(container, field)
    return
  }

  if (!dynamicData) return

  let isArticlesList = false
  let data: { [key: string]: string }[]
  switch (field.type) {
    case "dynamic-articles": {
      const isDetail = !!dynamicData.articles?.[0]?.contentHtml
      if (isDetail) {
        removeListRegion(container)
        return
      }
      isArticlesList = true
      // 精选区块（data-content="featured-articles"）用后台精选配置填充，否则用文章列表
      const source =
        key === FEATURED_LIST_KEY
          ? (dynamicData.featuredArticles ?? dynamicData.articles ?? [])
          : (dynamicData.articles ?? [])
      data = source.map((a) => ({
        title: a.title,
        excerpt: a.excerpt,
        date: a.date,
        category: a.category ?? "",
        link: `/blog/${a.slug}`,
        cover: a.cover ?? "",
        tags: a.tags ? a.tags.join(" · ") : "",
      }))
      break
    }
    case "article-body": {
      const article = dynamicData.articles?.[0]
      if (!article?.contentHtml) {
        container.remove()
        return
      }
      for (const el of container.querySelectorAll("[data-map]")) {
        const name = el.getAttribute("data-map")
        const value =
          name === "title"
            ? article.title
            : name === "date"
              ? article.date
              : name === "category"
                ? article.category ?? ""
                : name === "tags"
                  ? (article.tags ?? []).join(" · ")
                  : name === "meta"
                    ? [article.date, article.category, (article.tags ?? []).join(" · ")]
                        .filter(Boolean)
                        .join(" · ")
                    : undefined
        if (value !== undefined) el.textContent = value
      }
      const bodyTarget =
        container.querySelector('[data-map="body"]') ??
        doc.querySelector('[data-map="body"]') ?? // 容器外查找（LLM 可能把正文区放在容器外）
        container
      bodyTarget.innerHTML = article.contentHtml

      // 封面图：容器内有占位则填充 src；无封面时移除占位块；
      // 有封面但容器无占位时，在正文顶部注入封面图作为兜底。
      const coverValue = article.cover ?? ""
      const coverPlaceholders = Array.from(
        container.querySelectorAll('[data-map="cover"]')
      )
      if (coverPlaceholders.length > 0) {
        for (const coverEl of coverPlaceholders) {
          if (coverValue) {
            const img =
              coverEl.tagName.toLowerCase() === "img"
                ? coverEl
                : coverEl.querySelector("img")
            if (img) img.setAttribute("src", coverValue)
          } else {
            removeCoverBlock(coverEl)
          }
        }
      } else if (coverValue) {
        const coverImg = doc.createElement("img")
        coverImg.setAttribute("src", coverValue)
        coverImg.setAttribute("alt", article.title)
        coverImg.setAttribute(
          "style",
          "width:100%;max-width:800px;height:auto;object-fit:cover;border-radius:12px;margin:0 0 24px;"
        )
        bodyTarget.insertBefore(coverImg, bodyTarget.firstChild)
      }
      return
    }
    case "dynamic-categories":
      data = (dynamicData.categories ?? []).map((c) => ({
        name: c.name,
        link: `/blog/category/${c.slug}`,
        count: String(c.count ?? 0),
      }))
      break
    case "dynamic-tags":
      data = (dynamicData.tags ?? []).map((t) => ({
        name: t.name,
        link: `/blog/tag/${t.slug}`,
      }))
      break
    default:
      return
  }

  if (data.length === 0) return

  const labelKey = field.type === "dynamic-articles" ? "title" : "name"
  renderListField(container, field, data, { labelKey })

  if (
    isArticlesList &&
    dynamicData.pagination &&
    dynamicData.pagination.totalPages > 1
  ) {
    container.insertAdjacentHTML(
      "beforeend",
      buildPaginationNav(dynamicData.pagination)
    )
  }
}

function renderCustomListField(container: Element, field: DynamicField): void {
  const items = field.items ?? []
  if (items.length === 0) return
  renderListField(container, field, items, {
    labelKey: Object.keys(field.fieldMapping)[0] ?? "name",
  })
}

/**
 * 渲染动态列表：把数据项填入容器内已有的列表宿主（ul/ol 或平铺卡片容器），
 * 保留「近期文章」标题、按钮等静态结构，避免把整块面板当成列表项逐条复制。
 */
function renderListField(
  container: Element,
  field: DynamicField,
  data: Record<string, string>[],
  options: { labelKey: string }
): void {
  const resolved = resolveListItemTemplate(container, field)
  if (!resolved) return
  const { host, template } = resolved

  removeSampleItems(host, template)
  if (host !== container) {
    // 宿主是容器内部的包装（如网格 div）时，容器直接子级可能残留被提取为
    // 模板的样例卡片（在包装外），需一并清除避免样例内容漏到线上
    removeSampleItems(container, template, host)
  }

  const mappings: [string, string][] =
    Object.keys(field.fieldMapping).length > 0
      ? Object.entries(field.fieldMapping)
      : Array.from(mappedElements(template)).map((el) => {
          const name = el.getAttribute("data-map")!
          return [name, name]
        })

  const labelKey = options.labelKey

  const clones: Element[] = []
  for (const item of data) {
    const clone = template.cloneNode(true) as Element

    let linkApplied = false
    for (const [mapKey, dataKey] of mappings) {
      const targets = mappedElements(clone, mapKey)
      if (targets.length === 0) continue
      const value = item[dataKey]
      if (value === undefined) continue
      if (mapKey === "link") {
        linkApplied = true
        for (const target of targets) {
          target.setAttribute("href", value)
        }
      } else if (mapKey === "cover") {
        // 封面图：目标是 img（或含 img）时填充 src；无封面时移除图片块
        for (const target of targets) {
          if (value) {
            const img =
              target.tagName.toLowerCase() === "img"
                ? target
                : target.querySelector("img")
            if (img) img.setAttribute("src", value)
          } else {
            removeCoverBlock(target)
          }
        }
      } else if (mapKey === "tags") {
        // 文章标签：目标容器内已有的 tag 芯片逐个填充真实标签，
        // 标签数多于芯片时克隆补齐，少于时移除多余芯片；
        // 无芯片结构（纯文本容器）时退化为「·」分隔的文本。
        const tagNames = String(value)
          .split(" · ")
          .map((s) => s.trim())
          .filter(Boolean)
        for (const target of targets) {
          const chips = Array.from(target.children).filter(
            (c) => c.tagName.toLowerCase() === "span"
          )
          if (chips.length > 0) {
            for (let i = 0; i < chips.length; i++) {
              if (i < tagNames.length) chips[i].textContent = tagNames[i]
              else chips[i].remove()
            }
            while (chips.length < tagNames.length) {
              const last = chips[chips.length - 1]
              const chip = last.cloneNode(true) as Element
              chip.textContent = tagNames[chips.length]
              last.after(chip)
              chips.push(chip)
            }
          } else {
            target.textContent = tagNames.join(" · ")
          }
        }
      } else {
        for (const target of targets) {
          target.textContent = value
        }
      }
    }

    if (!linkApplied && item.link) {
      if (clone.tagName.toLowerCase() === "a") {
        clone.setAttribute("href", item.link)
      } else {
        const anchors = clone.querySelectorAll("a[href]")
        if (anchors.length === 1) {
          anchors[0].setAttribute("href", item.link)
        }
      }
    }

    const labelEl = mappedElements(clone, labelKey)[0]
    if (!labelEl && item[labelKey]) {
      const linkEl = mappedElements(clone, "link")[0]
      if (linkEl) linkEl.textContent = item[labelKey]
    }

    fillTagAnchorText(clone, item)

    clones.push(clone)
  }

  template.remove()
  for (const clone of clones) host.appendChild(clone)
}

const ITEM_TEMPLATE_TAGS = new Set([
  "li",
  "a",
  "article",
  "div",
  "span",
  "time",
  "p",
  "tr",
  "option",
  "img",
  "button",
  "figure",
])

/** 判断配置里的 itemTemplate 是否是"单个列表项"而非整块面板（含标题/列表/按钮）。 */
function looksLikeItemTemplate(html: string): boolean {
  if (!html) return false
  const dom = new JSDOM(html).window.document
  const root = dom.body.firstElementChild
  if (!root) return false
  const tag = root.tagName.toLowerCase()
  if (tag === "ul" || tag === "ol" || tag === "table" || tag === "section") {
    return false
  }
  if (!ITEM_TEMPLATE_TAGS.has(tag)) return false
  if (root.querySelector("ul, ol")) {
    // 模板内嵌列表（如卡片内的分类标签组）时：列表项字段是模板字段的
    // 真子集说明主字段在列表外，模板本身仍是合法项模板（如含标签组的卡片）
    const list = root.querySelector<Element>("ul, ol")
    const first = list?.firstElementChild ?? null
    const liKeys = first ? mapKeysOf(first) : []
    const rootKeys = mapKeysOf(root)
    const isProperSubset =
      liKeys.length > 0 &&
      liKeys.every((k) => rootKeys.includes(k)) &&
      rootKeys.some((k) => !liKeys.includes(k))
    if (!isProperSubset) return false
  }
  if (!(root.matches("[data-map]") || root.querySelector("[data-map]"))) {
    return false
  }
  return true
}

/** 收集元素内（含自身）的全部 data-map 字段名，排序后用于结构比对。 */
function mapKeysOf(el: Element): string[] {
  const keys = new Set<string>()
  if (el.matches("[data-map]")) {
    const name = el.getAttribute("data-map")
    if (name) keys.add(name)
  }
  for (const mapped of Array.from(el.querySelectorAll("[data-map]"))) {
    const name = mapped.getAttribute("data-map")
    if (name) keys.add(name)
  }
  return Array.from(keys).sort()
}

/** 找到容器内承载动态列表项的宿主：优先含 [data-map] 的 ul/ol，否则退回容器本身。 */
function findDynamicListHost(container: Element): Element | null {
  if (container.matches("ul, ol")) return container
  for (const list of Array.from(container.querySelectorAll("ul, ol"))) {
    if (!list.querySelector("[data-map]")) continue
    // 跳过嵌在列表项内部的标签组 ul（如卡片内的分类标签组）：
    // ul 的 li 字段是其容器内某个祖先（卡片）字段的真子集时，
    // 说明它是卡片内部的嵌套列表，仅把承载列表主字段的 ul 视为宿主
    const liKeys = mapKeysOf(list.firstElementChild ?? list)
    if (liKeys.length > 0 && isNestedItemList(list, container, liKeys)) {
      continue
    }
    return list
  }
  // 支持更多容器类型（div/section/article）
  for (const list of Array.from(container.querySelectorAll("div, section, article"))) {
    if (list.querySelector("[data-map]")) return list
  }
  return null
}

/** 判断 ul 是否嵌在容器内的卡片形祖先里（li 字段是祖先字段的真子集）。 */
function isNestedItemList(
  list: Element,
  container: Element,
  liKeys: string[]
): boolean {
  for (
    let anc: Element | null = list.parentElement;
    anc && anc !== container;
    anc = anc.parentElement
  ) {
    const ancKeys = mapKeysOf(anc)
    if (ancKeys.length > liKeys.length && liKeys.every((k) => ancKeys.includes(k))) {
      return true
    }
  }
  return false
}

/**
 * 容器内寻找承载多个同构样本项的包装容器（如 .magazine-grid）：
 * 返回包含 ≥2 个与样本项同标签且共享类名的子元素的首个（最浅）容器。
 * 用于样本项被误判为宿主时找回真正的列表包装容器。
 */
function findRepeatedItemWrapper(container: Element, sample: Element): Element | null {
  const tag = sample.tagName
  const sampleClasses = Array.from(sample.classList)
  if (sampleClasses.length === 0) return null

  for (const el of Array.from(
    container.querySelectorAll<Element>("div, section, ul, ol")
  )) {
    if (el === sample || sample.contains(el)) continue
    let count = 0
    for (const child of Array.from(el.children)) {
      if (
        child.tagName === tag &&
        sampleClasses.some((c) => child.classList.contains(c))
      ) {
        count++
      }
    }
    if (count >= 2) return el
  }
  return null
}

/** 在宿主内找到列表项模板：第一个带 [data-map] 的子元素，否则退回首个子元素。 */
function findItemTemplate(host: Element): Element | null {
  for (const child of Array.from(host.children) as Element[]) {
    if (child.matches("[data-map]") || child.querySelector("[data-map]")) {
      return child
    }
  }
  return host.firstElementChild
}

/** 解析渲染用的列表宿主与列表项模板：优先使用合法 itemTemplate，否则从 DOM 推导。 */
function resolveListItemTemplate(
  container: Element,
  field: DynamicField
): { host: Element; template: Element } | null {
  let template: Element | null = null
  if (looksLikeItemTemplate(field.itemTemplate)) {
    const dom = new JSDOM(field.itemTemplate).window.document
    template = dom.body.firstElementChild
  }

  let host = findDynamicListHost(container) ?? container

  // 宿主与模板同构（同标签 + 同类名集合）说明 findDynamicListHost 把唯一样本项
  // 误认成了宿主：优先找回承载多个同构样本项的包装容器（如网格 div），让
  // 真实数据渲染进包装内；找不到时才退回容器自身，避免克隆项被嵌套进样本项
  // （样本项多为 flex 行布局，嵌套会导致列表横向排列）。
  if (template && host !== container && isSameElementShape(host, template)) {
    host = findRepeatedItemWrapper(container, host) ?? container
  }

  if (!template) template = findItemTemplate(host)
  if (!template) return null

  return { host, template }
}

/** 同构判定：标签相同且类名集合一致（要求双方类名非空，避免误伤无类包装容器）。 */
function isSameElementShape(a: Element, b: Element): boolean {
  if (a.tagName !== b.tagName) return false
  if (a.classList.length === 0 || b.classList.length === 0) return false
  return (
    Array.from(a.classList).sort().join(" ") ===
    Array.from(b.classList).sort().join(" ")
  )
}

const TAG_LIKE_CLASS_RE = /(^|[\s_-])(tags?|chips?|badges?)([\s_-]|$)/i

/** 判断锚点是否形似标签 chips（自身或最近列表带 tag/chip/badge 类）。 */
function isTagLikeAnchor(anchor: Element): boolean {
  if (TAG_LIKE_CLASS_RE.test(anchor.getAttribute("class") ?? "")) return true
  const list = anchor.closest("ul, ol")
  return TAG_LIKE_CLASS_RE.test(list?.getAttribute("class") ?? "")
}

/**
 * 标签残留兜底：data-map="link" 的标签形锚点（无嵌套字段、文本未被映射覆盖）
 * 会一直显示模板样例文本（如 SYNTHWAVE），用分类填充避免样例标签漏到线上。
 * 首个 link 锚点（通常是标题链接，由 labelKey 兜底负责）跳过。
 */
function fillTagAnchorText(clone: Element, item: Record<string, string>): void {
  if (!item.category) return
  const anchors = Array.from(
    clone.querySelectorAll<Element>('a[data-map="link"]')
  )
  for (const anchor of anchors.slice(1)) {
    if (anchor.querySelector("[data-map]")) continue
    if ((anchor.textContent ?? "").trim() === "") continue
    if (!isTagLikeAnchor(anchor)) continue
    anchor.textContent = item.category
  }
}

/** 清掉宿主中不属于模板的示例项（保留标题/按钮等静态结构）。 */
function removeSampleItems(host: Element, template: Element, protect?: Element): void {
  const isListHost = host.matches("ul, ol")
  const tag = template.tagName
  for (const child of Array.from(host.children) as Element[]) {
    if (child === template) continue
    if (child === protect) continue
    if (isListHost) {
      child.remove()
      continue
    }
    if (child.tagName !== tag) continue
    const sameClass =
      template.classList.length > 0 &&
      Array.from(child.classList).some((c) => template.classList.contains(c))
    if (
      sameClass ||
      child.matches("[data-map]") ||
      child.querySelector("[data-map]")
    ) {
      child.remove()
    }
  }
}

function buildPaginationNav(pagination: PaginationData): string {
  const { page, totalPages, basePath } = pagination
  const hrefFor = (p: number) => (p <= 1 ? basePath : `${basePath}?page=${p}`)
  const baseStyle =
    "display:inline-flex;align-items:center;justify-content:center;min-width:2rem;height:2rem;padding:0 0.5rem;border:1px solid rgba(0,0,0,0.12);border-radius:0.375rem;color:#1C1C1E;text-decoration:none;font-size:0.875rem;box-sizing:border-box;"
  const currentStyle =
    baseStyle + "background:#E5A83D;border-color:#E5A83D;color:#181A1E;font-weight:600;"
  const disabledStyle = "color:#9CA3AF;pointer-events:none;"

  const links: string[] = []
  links.push(
    `<a href="${hrefFor(page - 1)}" style="${baseStyle}${page <= 1 ? disabledStyle : ""}">上一页</a>`
  )
  for (let p = 1; p <= totalPages; p++) {
    const style = p === page ? currentStyle : baseStyle
    links.push(`<a href="${hrefFor(p)}" style="${style}">${p}</a>`)
  }
  links.push(
    `<a href="${hrefFor(page + 1)}" style="${baseStyle}${page >= totalPages ? disabledStyle : ""}">下一页</a>`
  )
  return `<nav style="display:flex;gap:0.375rem;flex-wrap:wrap;justify-content:center;align-items:center;margin-top:1.5rem;">${links.join("")}</nav>`
}

function mappedElements(root: Element, mapKey?: string): Element[] {
  const selector = mapKey ? `[data-map="${mapKey}"]` : "[data-map]"
  if (root.matches(selector)) return [root]
  return Array.from(root.querySelectorAll(selector))
}

function removeListRegion(container: Element): void {
  const parent = container.parentElement
  container.remove()
  if (!parent) return
  const tag = parent.tagName.toLowerCase()
  if (tag === "main" || tag === "body" || tag === "html") return
  const hasContentChild = Array.from(parent.children).some((child) =>
    child.hasAttribute("data-content")
  )
  if (!hasContentChild) parent.remove()
}

function renderNavField(doc: Document, key: string, field: NavField): void {
  const navs = doc.querySelectorAll(`[data-content="${key}"]`)
  if (navs.length === 0 || field.items.length === 0) return

  const tempDoc = new JSDOM(field.itemTemplate).window.document
  const templateEl = tempDoc.body.firstElementChild

  const renderedItems = (item: { label: string; href: string }): string =>
    field.itemTemplate
      .replace("{href}", item.href)
      .replace("{label}", item.label)

  for (const nav of navs) {
    const host = findNavListHost(nav)
    const isListHost = host && host.matches("ul, ol")

    const target = host ?? nav
    target.innerHTML = ""

    if (!templateEl) {
      target.innerHTML = field.items.map(renderedItems).join("")
      continue
    }

    const templateTag = templateEl.tagName.toLowerCase()
    const wrapInLi =
      isListHost && templateTag !== "li" && templateTag !== "ul" && templateTag !== "ol"

    for (const item of field.items) {
      const clone = templateEl.cloneNode(true) as Element
      const linkEl =
        clone.matches("a, [data-href]")
          ? clone
          : clone.querySelector<Element>("a[href], [data-href]")
      if (linkEl) {
        if (linkEl.hasAttribute("href")) linkEl.setAttribute("href", item.href)
        else if (linkEl.hasAttribute("data-href")) linkEl.setAttribute("data-href", item.href)
        linkEl.textContent = item.label
      } else {
        clone.textContent = `${item.label}`
      }
      if (wrapInLi) {
        const li = doc.createElement("li")
        li.appendChild(clone)
        target.appendChild(li)
      } else {
        target.appendChild(clone)
      }
    }
  }
}

/** 找到导航里的"链接列表容器"：优先匹配 class 语义（nav-links/nav-menu/menu），再退回 ul/ol */
function findNavListHost(nav: Element): Element | null {
  const lists = Array.from(nav.querySelectorAll("ul, ol"))
  const byClass = lists.find((l) =>
    /(^|[-_\s])(nav-links|nav-menu|nav_list|menu|links|list)([-_\s]|$)/i.test(
      (l.getAttribute("class") ?? "") + " " + (l.id ?? "")
    )
  )
  if (byClass) return byClass
  const byLinks = lists.find((l) => l.querySelector("[href], [data-href]"))
  return byLinks ?? null
}
