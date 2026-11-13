import { JSDOM } from "jsdom"
import type { ContentConfig, TextField, DynamicField, NavField, CustomListItem } from "../types/content-config"
import { FIELD_DEFINITIONS, GLOBAL_FIELDS } from "../field-registry"

const KNOWN_DYNAMIC_TYPES = new Set([
  "dynamic-articles",
  "dynamic-categories",
  "dynamic-tags",
  "article-body",
])

export interface ExtractionResult {
  htmlTemplate: string
  contentConfig: ContentConfig
}

/** 只提取导航（nav-list）字段，用于给缺失导航配置的主题补齐可配置入口。 */
export function extractNavConfig(html: string): Record<string, NavField> {
  const { contentConfig } = extractContentConfig(html)
  const nav: Record<string, NavField> = {}
  for (const [key, field] of Object.entries(contentConfig)) {
    if (field.type === "nav-list") nav[key] = field as NavField
  }
  return nav
}

/**
 * 补齐配置中缺失的导航字段：布局 HTML 里存在、但 config 中没有 nav-list 的
 * 导航（main-nav/footer-nav 等）会用布局里的链接回填，已有导航保持不动。
 */
export function mergeMissingNav(
  config: ContentConfig | undefined | null,
  layoutHtml: string
): ContentConfig | null {
  const merged = { ...(config ?? {}) }
  const navFields = extractNavConfig(layoutHtml)
  let changed = false
  for (const [key, fresh] of Object.entries(navFields)) {
    const existing = merged[key] as NavField | undefined
    if (existing?.type === "nav-list") {
      // 已有导航保持不动，除非是被品牌模板污染而展平的损坏配置
      if (!isFlattenedNav(existing, fresh)) continue
      merged[key] = fresh
      changed = true
      continue
    }
    merged[key] = fresh
    changed = true
  }
  return changed ? merged : (config ?? null)
}

/**
 * 自修复已损坏的导航配置：旧版本把展示品牌（logo + data-content 标题）也当成了
 * nav 项（itemTemplate 往往是 .nav-brand 模板、items 含站点标题），导致渲染时导航
 * 结构被展平、样式失效。这里用布局里重新提取的 nav-list 覆盖"结构错误"的旧配置。
 */
export function repairBrokenNav(
  config: ContentConfig | undefined | null,
  layoutHtml: string
): ContentConfig | null {
  const merged = { ...(config ?? {}) }
  const navFields = extractNavConfig(layoutHtml)
  let changed = false
  for (const [key, fresh] of Object.entries(navFields)) {
    const existing = merged[key] as NavField | undefined
    if (existing?.type !== "nav-list") continue
    if (!isFlattenedNav(existing, fresh)) continue
    merged[key] = fresh
    changed = true
  }
  return changed ? merged : (config ?? null)
}

/** 判断已有 nav 配置是否被展平（结构与布局中重新提取的一致时应保留，避免覆盖用户编辑）。 */
function isFlattenedNav(existing: NavField, fresh: NavField): boolean {
  const freshTags = /<(ul|ol|li)\b/i.test(fresh.itemTemplate)
  const existingTags = /<(ul|ol|li)\b/i.test(existing.itemTemplate)
  // 布局里有列表结构但配置模板是纯 <a>（展平标志），且模板被品牌标记污染才视为损坏
  if (freshTags && !existingTags && isBrandTemplate(existing.itemTemplate)) return true
  // items 里混入了站点标题类文本、且与布局品牌链接一致
  const brandTexts = extractBrandTexts(fresh.itemTemplate)
  if (
    brandTexts.length > 0 &&
    existing.items.some((it) => brandTexts.includes(it.label))
  ) {
    return true
  }
  return false
}

/** 导航项模板是否混入了品牌标记（.nav-brand / .logo / data-content 字段）。 */
function isBrandTemplate(itemTemplate: string): boolean {
  return /\bnav-brand\b|\blogo\b|\bdata-content\s*=/i.test(itemTemplate)
}

function extractBrandTexts(itemTemplate: string): string[] {
  if (!/\bnav-brand\b|\blogo\b/i.test(itemTemplate)) return []
  const dom = new JSDOM(itemTemplate)
  const els = dom.window.document.querySelectorAll("[data-content]")
  return Array.from(els)
    .map((el) => el.textContent?.trim() ?? "")
    .filter(Boolean)
}

export function extractContentConfig(
  html: string,
  siteConfig?: Record<string, string>
): ExtractionResult {
  const dom = new JSDOM(html)
  const doc = dom.window.document
  const config: ContentConfig = {}
  const usedKeys = new Set<string>()
  // 记录每个原始 key 的首个已处理元素，用于 text 同文本复用 key 的判定
  const primaryByKey = new Map<string, Element>()

  // 兜底：先给 LLM 漏标的标题/段落补 data-content 标记，再统一提取
  markUnmarkedTextUnits(doc, siteConfig)

  const elements = doc.querySelectorAll("[data-content]")
  for (const el of elements) {
    // 正文占位区（data-map=body）整块运行时替换：其中的 data-content 标记
    // 是 LLM 误加的噪音，剥离掉且不进 contentConfig
    if (el.closest('[data-map="body"]')) {
      el.removeAttribute("data-content")
      el.removeAttribute("data-content-type")
      continue
    }
    const key = el.getAttribute("data-content")
    const type = el.getAttribute("data-content-type")
    if (!key || !type) continue

    const primary = primaryByKey.get(key)
    const elText = (el.textContent ?? "").trim()
    const sameText =
      type === "text" &&
      !!primary &&
      (primary.textContent ?? "").trim() === elText

    // key 分配规则：
    // 1) text 元素同文本复用 primary key（整体同步，避免二次拆成 -N）；
    // 2) text 元素重复占用某全局字段 key 但文本不同 → 退回类名/标签名派生 key，
    //    绝不生成 blog-title-2 / author-name-2 这类全局字段后缀参数；
    // 3) 其余（非 text / 非全局 key）维持原有 -N 拆键。
    let unique: string
    if (sameText) {
      unique = key
    } else if (type === "text" && isGlobalKey(key) && usedKeys.has(key)) {
      unique = uniqueKey(classOrTagKey(el), usedKeys)
    } else {
      unique = uniqueKey(key, usedKeys)
    }
    if (unique !== key) {
      el.setAttribute("data-content", unique)
    }
    usedKeys.add(unique)
    if (!primaryByKey.has(key)) primaryByKey.set(key, el)

    if (type === "text") {
      config[unique] = extractTextField(el, unique, siteConfig)
    } else if (type.startsWith("dynamic-") || type === "article-body") {
      const fieldType: DynamicField["type"] = KNOWN_DYNAMIC_TYPES.has(type)
        ? (type as DynamicField["type"])
        : "dynamic-list"
      config[unique] = extractDynamicField(el, unique, fieldType)
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

/** 是否为系统全局字段 key（blog-title / author-name / site-description 等）。 */
function isGlobalKey(key: string): boolean {
  return key in GLOBAL_FIELDS
}

/**
 * 派生一个"非全局"的兜底 key：优先取第一个非全局类名的 kebab 化，
 * 无则用标签名。用于全局字段 key 被不同文本重复占用时退回，绝不派生
 * blog-title-2 / author-name-2 这类全局字段后缀参数。
 */
function classOrTagKey(el: Element): string {
  const classes = (el.getAttribute("class") ?? "").split(/\s+/)
  for (const raw of classes) {
    const k = raw.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    if (!k || isGlobalKey(k)) continue
    return k
  }
  return el.tagName.toLowerCase()
}

/**
 * 从已标记元素里建立 key → {text, isText}，用于"同文本复用同一 key"：
 * 当重复 base key 对应元素文本相同时复用原 key，避免生成 blog-title-2 之类多余参数。
 */
function collectMarkedUnits(doc: Document): Map<string, { text: string; isText: boolean }> {
  const map = new Map<string, { text: string; isText: boolean }>()
  for (const el of doc.querySelectorAll("[data-content]")) {
    const key = el.getAttribute("data-content") ?? ""
    if (!key || map.has(key)) continue
    map.set(key, {
      text: (el.textContent ?? "").trim(),
      isText: el.getAttribute("data-content-type") === "text",
    })
  }
  return map
}

/**
 * 兜底：对未标记的标题/段落自动补 data-content=text 标记（LLM 漏标时避免内容不可编辑）。
 * 只给叶子文本元素（h1-h6/p）打标、不打容器——text 字段渲染是 textContent 替换，
 * 打容器会破坏内部嵌套结构；打叶子安全。文本与已标记同 key 元素相同时复用 key，
 * 避免把同一段内容（如站点标题）拆成需单独维护的 -N 参数。
 */
function matchGlobalFieldValue(
  text: string,
  siteConfig?: Record<string, string>
): string | undefined {
  if (!siteConfig) return undefined
  for (const key of Object.keys(GLOBAL_FIELDS)) {
    const value = siteConfig[key]
    if (value && value.trim() === text) return key
  }
  return undefined
}

function markUnmarkedTextUnits(doc: Document, siteConfig?: Record<string, string>): void {
  const units = Array.from(doc.querySelectorAll("h1,h2,h3,h4,h5,h6,p")).filter(
    (el) =>
      (el.textContent ?? "").trim().length > 0 &&
      el.closest("[data-content]") === null &&
      // 正文占位区整块运行时替换，标记其中的段落只会产生无意义字段
      el.closest('[data-map="body"]') === null
  )
  const used = new Set(
    Array.from(doc.querySelectorAll("[data-content]"))
      .map((el) => el.getAttribute("data-content") ?? "")
      .filter(Boolean)
  )
  const marked = collectMarkedUnits(doc)
  for (const el of units) {
    // key 优先取类名 kebab 化（.post-title → post-title），无类名用 tag 名
    const text = (el.textContent ?? "").trim()
    const globalKey = matchGlobalFieldValue(text, siteConfig)
    const rawClass = (el.getAttribute("class") ?? "").split(/\s+/)[0] ?? ""
    const base =
      globalKey ??
      (rawClass.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "") ||
        el.tagName.toLowerCase())
    const existing = marked.get(base)
    let key: string
    if (existing && existing.isText && existing.text === text) {
      // 文本完全相同的 text 元素复用同一 key（渲染时整体同步）
      key = base
    } else if (isGlobalKey(base) && used.has(base)) {
      // 重复占用某全局字段 key 但文本不同 → 退回类名/标签名派生 key，
      // 避免把第二处不同内容拆成 blog-title-2 之类全局后缀参数
      key = uniqueKey(classOrTagKey(el), used)
    } else {
      key = uniqueKey(base, used)
    }
    used.add(key)
    marked.set(key, { text, isText: true })
    el.setAttribute("data-content", key)
    el.setAttribute("data-content-type", "text")
  }
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
  const templateEl = firstChild ? findRepeatableItemTemplate(firstChild) ?? firstChild : null
  const fieldMapping: Record<string, string> = {}

  if (templateEl) {
    // 模板根节点自身也可能带 data-map（如 <span data-map="date">）：
    // 只遍历后代会丢掉这个字段，得到空 fieldMapping。
    const mappedElements: Element[] = [
      ...(templateEl.matches("[data-map]") ? [templateEl] : []),
      ...Array.from(templateEl.querySelectorAll("[data-map]")),
    ]
    for (const mapped of mappedElements) {
      const fieldName = mapped.getAttribute("data-map")
      if (fieldName) {
        fieldMapping[fieldName] = fieldName
      }
    }

    if (!fieldMapping.link) {
      const linkEl =
        templateEl.tagName.toLowerCase() === "a"
          ? templateEl
          : templateEl.querySelector("a[href]")
      if (linkEl) {
        linkEl.setAttribute("data-map", "link")
        fieldMapping.link = "link"
      }
    }
  }

  const result: DynamicField = {
    type,
    label: key,
    itemTemplate: templateEl ? templateEl.outerHTML : "",
    fieldMapping,
  }

  if (type === "dynamic-list" && templateEl) {
    const itemsScope = templateEl.parentElement ?? el
    result.items = extractCustomListItems(itemsScope, templateEl, fieldMapping)
  }

  return result
}

/**
 * 当动态区首个子元素是整块面板/网格包装（含标题、列表容器、按钮）时，
 * 向下钻取到真正可重复的列表项作为模板，避免把整个面板当成单个列表项。
 */
function findRepeatableItemTemplate(root: Element): Element | null {
  if (root.matches("ul, ol")) return root.firstElementChild

  const list = root.querySelector<Element>("ul, ol")
  if (list) {
    const first = list.firstElementChild
    if (first && (first.matches("[data-map]") || first.querySelector("[data-map]"))) {
      // 候选 li 字段是 root 字段的真子集时，root 自身携带更完整的项字段
      // （如卡片含 title/date/excerpt 且内部嵌分类标签组 ul），root 才是项模板，
      // 不能因内部嵌套的标签组把卡片误判为包装容器
      const rootKeys = mapKeysOf(root)
      const liKeys = mapKeysOf(first)
      const isProperSubset =
        liKeys.every((k) => rootKeys.includes(k)) &&
        rootKeys.some((k) => !liKeys.includes(k))
      if (!isProperSubset) {
        return first
      }
    }
  }

  const children = Array.from(root.children) as Element[]
  const items = children.filter(
    (c) => c.matches("[data-map]") || c.querySelector("[data-map]")
  )
  // 仅当存在多个结构相同的重复项（同标签 + 同 data-map 字段集）时才视为"网格/卡片包装"，
  // 避免把列表项自身（li 内的时间/链接/分类等字段元素）误判为重复项。
  const sameTag =
    items.length > 1 && items.every((c) => c.tagName === items[0].tagName)
  const sameMaps =
    items.length > 1 &&
    items.every((c) => mapKeysOf(c).join(",") === mapKeysOf(items[0]).join(","))
  if (sameTag && sameMaps) {
    return items[0]
  }
  // 唯一一个 grid/list/row/feed 包装（如 .post-grid 内含单个卡片样本）时：
  // 它是承载列表项的宿主，应向下钻取到真正的列表项（卡片），
  // 避免把父级面板（含标题的 .container）整块记录为 itemTemplate。
  if (items.length === 1) {
    const wrapper = items[0]
    const isGridList =
      wrapper.matches("ul, ol") || /grid|list|row|feed/i.test(wrapper.className || "")
    if (isGridList) {
      const first = wrapper.firstElementChild
      if (first && (first.matches("[data-map]") || first.querySelector("[data-map]"))) {
        // 只有当包装里的动态字段全部落在首个子元素内时，它才是真正的列表项。
        // 反例：<article class="archive-item"><div class="archive-row">
        //   <span data-map="date">…</span><a data-map="link">…</a>…</div></article>
        // —— .archive-row 命中 row 词根，但首个子元素只是卡片里的「日期」字段，
        // 把它记成 itemTemplate 会让 fieldMapping 只剩 date，渲染期只剩一串
        // 日期，标题/链接/分类全部丢失（表现为列表页没有文章）。
        const wrapperKeys = mapKeysOf(wrapper)
        const firstKeys = mapKeysOf(first)
        const firstCoversAllFields =
          firstKeys.length > 0 &&
          wrapperKeys.every((key) => firstKeys.includes(key))
        if (firstCoversAllFields) return first
      }
    }
  }
  return null
}

/** 收集元素内（含自身）的全部 data-map 字段名，排序后用于结构比对。 */
function mapKeysOf(el: Element): string[] {
  const keys = new Set<string>()
  if (el.matches("[data-map]")) {
    const name = el.getAttribute("data-map")
    if (name) keys.add(name)
  }
  for (const mapped of el.querySelectorAll("[data-map]")) {
    const name = mapped.getAttribute("data-map")
    if (name) keys.add(name)
  }
  return Array.from(keys).sort()
}

function extractCustomListItems(
  container: Element,
  template: Element,
  fieldMapping: Record<string, string>
): CustomListItem[] {
  const items: CustomListItem[] = []
  const allChildren = Array.from(container.children)

  for (const child of allChildren) {
    if (child === template) continue

    const item: CustomListItem = {}
    for (const fieldName of Object.keys(fieldMapping)) {
      if (fieldName === "link") {
        const linkEl =
          child.tagName.toLowerCase() === "a"
            ? child
            : child.querySelector("a[href]")
        item[fieldName] = linkEl?.getAttribute("href") ?? ""
      } else {
        const mapped = child.querySelector(`[data-map="${fieldName}"]`) ?? child
        item[fieldName] = mapped.textContent?.trim() ?? ""
      }
    }

    if (Object.values(item).some((v) => v !== "")) {
      items.push(item)
    }
  }

  return items
}

/**
 * 导航中「数据驱动路由」的链接：分类详情、标签详情、具体文章、合集详情。
 *
 * 这类链接应由正文的动态区块（标签云 / 分类列表 / 文章流）按后台真实数据渲染。
 * LLM 硬编码在导航里的是**编造的 slug**（如 /blog/tag/vue、/blog/sample-post），
 * 点了要么 404、要么指向不存在的分类标签；而且会和动态区块**重复展示**同一批标签
 * （导航一份 + 标签云一份），这就是用户看到的「一排漫游标签 + 重复标签」。
 */
const DATA_DRIVEN_NAV_PATH_RES: RegExp[] = [
  /^\/blog\/category\//i,
  /^\/blog\/tag\//i,
  /^\/collections\/[^/]+/i,
  // 具体文章详情（/blog/archive 归档页是核心路由，单独排除）
  /^\/blog\/[^/]+$/i,
]

/** 判定导航链接是否指向「数据驱动路由」（分类/标签/具体文章/合集详情）。 */
export function isDataDrivenNavHref(href: string): boolean {
  const raw = (href ?? "").trim()
  if (!raw) return false
  // 站外链接保留
  if (/^(https?:)?\/\//i.test(raw) || raw.startsWith("mailto:")) return false
  const path = raw.split(/[?#]/)[0].replace(/\/+$/, "") || "/"
  if (path === "/blog/archive") return false
  return DATA_DRIVEN_NAV_PATH_RES.some((re) => re.test(path))
}

/**
 * 判定元素是否是链接分组前的「小标题」（如导航里的「分类」「标签」文字块）。
 */
function isGroupLabelElement(el: Element): boolean {
  const tag = el.tagName.toLowerCase()
  if (!["div", "span", "p", "h3", "h4", "h5", "h6"].includes(tag)) return false
  if (el.querySelector("a, ul, ol")) return false
  const text = (el.textContent ?? "").trim()
  return text.length > 0 && text.length <= 20
}

/**
 * 移除导航/页脚里硬编码的「数据驱动链接」（分类/标签/具体文章/合集详情）。
 *
 * 【为什么必须清】
 * LLM 常把导航拆成多组链接（导航 / 分类 / 标签），而渲染时只有**第一组**是
 * 受配置管理的列表宿主，其余组里的链接是**原样输出**的静态标记：
 *   - slug 是编造的（/blog/tag/vue、/blog/sample-post），点了 404；
 *   - 与正文里按真实数据渲染的动态标签云/分类列表**重复展示**同一批标签。
 * 这就是用户看到的「一排漫游标签 + 一堆重复标签」。
 *
 * 受配置管理的列表宿主内的链接同样清理：其内容在渲染期会被导航项数据整体替换，
 * 提前清掉不影响渲染，却能保证「导航项配置缺失时也不残留假链接」。
 */
export function stripHardCodedTaxonomyLinks(doc: Document): void {
  for (const nav of Array.from(doc.querySelectorAll("nav, footer"))) {
    for (const link of Array.from(nav.querySelectorAll("a[href]"))) {
      if (!isDataDrivenNavHref(link.getAttribute("href") ?? "")) continue
      const item = link.closest("li")
      const target = item && nav.contains(item) ? item : link
      target.remove()
    }
    // 移除因此变空的链接列表，并连带移除其前置的分组标题（如「分类」「标签」）
    for (const list of Array.from(nav.querySelectorAll("ul, ol"))) {
      if (list.querySelector("a[href], [data-href]")) continue
      const prev = list.previousElementSibling
      list.remove()
      if (prev && isGroupLabelElement(prev)) prev.remove()
    }
  }
}

/**
 * 导航链接列表宿主的判定。
 *
 * class 必须**同时**含 nav 词根与 list 类词根 —— 只含其一容易误伤：
 *   - .nav-list / .nav-links / .nav-menu / .nav-items → 是导航列表 ✓
 *   - .post-nav（文章上下篇导航）→ 只有 nav，没有 list 类词根 → 不算 ✓
 *   - .sidebar-nav（导航容器本身）→ 同上 ✓
 */
function isNavLinkListHost(el: Element): boolean {
  const tag = el.tagName.toLowerCase()
  if (tag !== "ul" && tag !== "ol" && tag !== "div") return false
  const cls = el.getAttribute("class") ?? ""
  if (!/(^|[-_\s])nav([-_\s]|$)/i.test(cls)) return false
  if (!/(^|[-_\s])(list|links|menu|items?|group)([-_\s]|$)/i.test(cls)) return false
  return el.querySelectorAll("a").length >= 1
}

/** 品牌区判定（logo / 站名 / 头像所在块）：class 含 brand 词根。 */
function isBrandBlock(el: Element): boolean {
  const cls = el.getAttribute("class") ?? ""
  return /(^|[-_\s])brand([-_\s]|$)/i.test(cls)
}

/**
 * 判定元素是否是「导航形态的容器」。
 *
 * 【为什么不能只看 <nav> 标签】
 * LLM 把站点导航写成 <aside class="sidebar-nav"> / <div class="nav-..."> 非常常见
 * （侧边栏布局尤其如此）。若只按 <nav> 标签判定，页面正文里再写一份导航就
 * 既检不出来、也剥不掉 —— 页面上就会出现**两个导航栏**。
 *
 * 判据（任一命中即算导航容器）：
 * 1. <nav> 标签；
 * 2. 带 data-content-type="nav-list" 标记（受配置管理的导航）；
 * 3. 内部直接子级里存在「导航链接列表宿主」（ul/ol/div 且 class 含 nav 词根）。
 */
export function isNavLikeContainer(el: Element): boolean {
  const tag = el.tagName.toLowerCase()
  if (tag === "nav") return true
  if (el.getAttribute("data-content-type") === "nav-list") return true
  if (tag === "footer" || tag === "header") return false
  return Array.from(el.children).some(isNavLinkListHost)
}

/**
 * 剥离导航形态的容器（布局已统一提供导航，页面正文里再有一份就是重复渲染）。
 *
 * 优先整体移除带 nav-list 标记的容器；其余按「导航链接列表 + 品牌区」精确清理，
 * 容器内若还剩其它内容（标签云、作者卡等）则保留容器，只摘掉导航部分。
 */
export function stripNavLikeContainers(root: Element): void {
  // 1) 受配置管理的导航容器：整体移除
  for (const el of Array.from(root.querySelectorAll('[data-content-type="nav-list"]'))) {
    el.remove()
  }
  // 2) 未标记但形态是导航的容器：摘掉链接列表与品牌区
  for (const el of Array.from(root.querySelectorAll("aside, div, section"))) {
    const hosts = Array.from(el.children).filter(isNavLinkListHost)
    if (hosts.length === 0) continue
    for (const h of hosts) h.remove()
    for (const b of Array.from(el.children)) {
      if (isBrandBlock(b)) b.remove()
    }
    // 摘空后若容器内没有其它内容（链接/列表/内容标记）则整体移除，避免留下空壳
    if (!el.querySelector("a, ul, ol, [data-content], [data-content-type]")) {
      el.remove()
    }
  }
}

/**
 * 过滤导航项中硬编码的数据驱动链接（分类/标签/具体文章/合集详情）。
 *
 * 用于**存量主题**：这些项是在过滤规则生效之前写入 contentConfig 的，
 * 存量主题不做这一步的话，导航里仍会残留编造的分类/标签链接。
 * 仅当过滤后仍有导航项时才生效，避免把整个导航清空。
 */
export function stripDataDrivenNavItems(
  config: ContentConfig | null | undefined
): ContentConfig | null {
  if (!config) return config ?? null
  let changed = false
  const next: ContentConfig = {}
  for (const [key, field] of Object.entries(config)) {
    if (field.type !== "nav-list") {
      next[key] = field
      continue
    }
    const navField = field as NavField
    const coreItems = navField.items.filter(
      (it) => !isDataDrivenNavHref(it.href)
    )
    if (coreItems.length === 0 || coreItems.length === navField.items.length) {
      next[key] = field
      continue
    }
    changed = true
    next[key] = { ...navField, items: coreItems }
  }
  return changed ? next : config
}

function extractNavField(el: Element, key: string): NavField {
  // 优先提取导航列表容器内的链接（如 .nav-links / ul / ol），
  // 避免把品牌(logo + data-content)也当成 nav 项，也避免结构被展平。
  const listHost = findNavListHost(el)
  const itemEls = listHost ? collectNavItemElements(listHost) : null

  const itemSource = itemEls && itemEls.length > 0 ? itemEls : collectNavItemElements(el)
  const collected: { label: string; href: string; itemEl: Element }[] = []

  for (const itemEl of itemSource) {
    const linkEl = resolveNavLink(itemEl)
    if (!linkEl) continue
    const label = linkEl.textContent?.trim() ?? ""
    if (!label && !linkEl.getAttribute("href")) continue
    const href = linkEl.getAttribute("href") ?? linkEl.getAttribute("data-href") ?? ""
    collected.push({ label, href, itemEl })
  }

  // 过滤掉硬编码的数据驱动链接（分类/标签/具体文章）。
  // 仅当导航里还留有核心路由项时才过滤 —— 否则（导航本身就是标签云的主题）
  // 宁可保留这些链接，也不要把导航清空。
  const coreItems = collected.filter((c) => !isDataDrivenNavHref(c.href))
  const kept = coreItems.length > 0 ? coreItems : collected

  const items = kept.map((c) => ({ label: c.label, href: c.href }))
  // 模板取自第一个保留项，保证克隆结构与实际渲染的项一致
  const itemTemplate = kept.length > 0 ? buildNavTemplate(kept[0].itemEl) : ""

  return {
    type: "nav-list",
    label: key,
    items,
    itemTemplate,
  }
}

/** 找到导航里的“链接列表容器”：优先匹配 class 语义（nav-links/nav-menu/menu），再退回 ul/ol。 */
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

/** 品牌元素（logo / 站点标题链接）不算导航项。 */
export function isBrandElement(el: Element): boolean {
  if (/\bnav-brand\b|\blogo\b/i.test(el.getAttribute("class") ?? "")) return true
  return el.querySelector(".nav-brand, .logo") !== null
}

/** 收集列表容器里的 nav 项元素：优先 li，退回直接的 a / [data-href]，跳过品牌元素。 */
function collectNavItemElements(host: Element): Element[] {
  const lis = Array.from(host.children).filter(
    (c) => c.tagName.toLowerCase() === "li" && !isBrandElement(c)
  )
  if (lis.length > 0) return lis
  return Array.from(host.children).filter(
    (c) =>
      c.matches("a[href], [data-href], button[data-href]") && !isBrandElement(c)
  )
}

/** 从 li / a 中解析出真正的链接元素。 */
function resolveNavLink(itemEl: Element): Element | null {
  if (itemEl.matches("a[href], [data-href]")) return itemEl
  const anchor = itemEl.querySelector<Element>("a[href], [data-href]")
  return anchor ?? null
}

/** 生成单个 nav 项的模板：保留归档（li）包裹，只把 href 与 label 占位化；裸 <a> 套回 <li> 恢复列表结构。 */
function buildNavTemplate(itemEl: Element): string {
  const clone = itemEl.cloneNode(true) as Element
  const linkClone = (() => {
    if (clone.matches("a[href], [data-href]")) return clone
    return clone.querySelector<Element>("a[href], [data-href]")
  })() as Element
  if (linkClone.hasAttribute("href")) linkClone.setAttribute("href", "{href}")
  else if (linkClone.hasAttribute("data-href")) linkClone.setAttribute("data-href", "{href}")
  linkClone.textContent = "{label}"
  if (clone.matches("a[href], [data-href]")) {
    const li = clone.ownerDocument.createElement("li")
    li.appendChild(clone)
    return li.outerHTML
  }
  return clone.outerHTML
}
