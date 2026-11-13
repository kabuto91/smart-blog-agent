import { JSDOM } from "jsdom"
import { CLASS_BRIDGE_SOURCE_CLASSES } from "@smart-blog/core/lib/theme/theme-splitter"

/**
 * 静态样式审计：对主题骨架的 CSS 设计系统做确定性规则检查，
 * 不依赖 LLM，零成本、可测试。产出 error 级问题（建议触发修订）、
 * warn 级提示（仅反馈给评审参考）与页面级问题（页面自创类名）。
 */

export interface StyleAuditReport {
  /** 骨架样式缺陷（error 级，应修复） */
  skeletonIssues: string[]
  /** 骨架样式提示（warn 级，不阻断） */
  warnings: string[]
  /** 页面使用了骨架未定义的类名（error 级，按页归组） */
  pageIssues: Record<string, string[]>
}

/** :root 中自定义属性最少数量，低于视为色彩/参数体系单薄。 */
const MIN_ROOT_VARS = 5
/** 页面问题清单里最多列出的未定义类名数。 */
const MAX_MISSING_CLASSES = 8
/**
 * 页面未定义类名触发修订的阈值（与 theme-selfcheck 的 blocker 判定对齐）。
 * LLM 自由设计时产生 1~2 个骨架未声明的工具类是常态，逐个报 error 会让
 * 每次生成都无谓重来一轮；只有大面积未定义才值得让模型改用骨架类名。
 */
const MISSING_CLASS_MIN_COUNT = 3
const MISSING_CLASS_MIN_RATIO = 0.3

/** 判断颜色值是否属于默认纯白系。 */
function isPlainWhite(value: string): boolean {
  const v = value.trim().toLowerCase()
  return (
    v === "" ||
    v === "#fff" ||
    v === "#ffffff" ||
    v === "white" ||
    /^rgba?\(\s*255\s*,\s*255\s*,\s*255\s*(,\s*(0|1|0?\.0+|1\.0+)\s*)?\)$/.test(
      v
    ) ||
    /^hsla?\(\s*0\s*,?\s*(0%?)?\s*,?\s*(100%)\s*(,\s*(0|1|0?\.0+|1\.0+)\s*)?\)$/.test(
      v
    )
  )
}

/** 提取全部 <style> 的 CSS 文本。 */
export function extractCssFromLayout(layoutHtml: string): string {
  const dom = new JSDOM(layoutHtml)
  return Array.from(dom.window.document.querySelectorAll("style"))
    .map((s) => s.textContent ?? "")
    .join("\n")
}

/** 去掉 <style> 块后的 HTML（供评审模型看结构而非冗长样式）。 */
export function stripStyleTags(html: string): string {
  return html.replace(/<style[\s\S]*?<\/style>/gi, "")
}

interface CssRuleBlock {
  selectors: string[]
  body: string
}

/** 粗粒度解析 CSS 规则块（不追求完备，够审计用即可）。 */
function parseRuleBlocks(css: string): CssRuleBlock[] {
  const blocks: CssRuleBlock[] = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(css)) !== null) {
    blocks.push({
      selectors: m[1].split(",").map((s) => s.trim()),
      body: m[2],
    })
  }
  return blocks
}

/** 收集 :root 块中的自定义属性（后写覆盖先写）。 */
function collectRootVars(css: string): Map<string, string> {
  const vars = new Map<string, string>()
  for (const block of parseRuleBlocks(css)) {
    if (!block.selectors.some((s) => /^(:root|html)$/i.test(s))) continue
    const declRe = /(--[a-zA-Z][\w-]*)\s*:\s*([^;]+)/g
    let d: RegExpExecArray | null
    while ((d = declRe.exec(block.body)) !== null) {
      vars.set(d[1], d[2].trim())
    }
  }
  return vars
}

/** 解析值中的 var(--x) 引用（一层回退语法），查不到时原样返回。 */
function resolveVars(value: string, vars: Map<string, string>): string {
  return value.replace(
    /var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)/g,
    (_all, name: string, fallback?: string) =>
      vars.get(name) ?? (fallback ?? "").trim() ?? ""
  )
}

/** 从声明串中取出某属性的最新值。 */
function lastDecl(body: string, prop: string): string | null {
  const re = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, "i")
  const m = body.match(re)
  return m ? m[1].trim() : null
}

/** 检查 body/html 背景：缺失或纯白都视为缺乏层次（error）。 */
function checkBackground(css: string, issues: string[]): void {
  const vars = collectRootVars(css)
  let bgColor: string | null = null
  let bgImage: string | null = null
  for (const block of parseRuleBlocks(css)) {
    const hit = block.selectors.some((s) =>
      /(?:^|[\s,>+~(])(?:html|body)(?:$|[\s,.:#\[{>~+])/i.test(s)
    )
    if (!hit) continue
    const c = lastDecl(block.body, "background-color")
    const g = lastDecl(block.body, "background")
    const img = lastDecl(block.body, "background-image")
    if (img && !/^none$/i.test(img.trim())) bgImage = img
    if (g) {
      if (/gradient\(|url\(/i.test(g)) bgImage = g
      // background 简写：去掉渐变与 url 后剩余部分视为颜色
      const colorPart = g
        .replace(/[a-z-]+-gradient\([^)]*\)/gi, "")
        .replace(/url\([^)]*\)/gi, "")
        .trim()
      if (colorPart) bgColor = colorPart
    }
    if (c) bgColor = c
  }

  const resolvedBg = bgColor ? resolveVars(bgColor, vars) : ""
  const hasTexture = Boolean(bgImage && !/^none$/i.test(bgImage.trim()))
  if ((!bgColor && !hasTexture) || (!hasTexture && isPlainWhite(resolvedBg))) {
    issues.push(
      "背景为默认纯白且无纹理/渐变，缺乏层次感（应为背景定义底色、渐变或纹理）"
    )
  }
}

/** 检查动效：transition/animation/@keyframes 全无则判平淡（error）。 */
function checkMotion(css: string, issues: string[]): void {
  if (
    !/transition\s*:|animation\s*:|@keyframes/i.test(css)
  ) {
    issues.push("缺少过渡/入场动效（transition、animation 或 @keyframes）")
  }
}

/**
 * hover/focus 态中禁止出现的布局属性。
 * 改这些属性会让鼠标一悬停就重排文字、改变盒子尺寸，同组卡片随即高低错落
 * —— 是「生成出来的主题卡片排版乱掉」最常见的确定性来源。
 */
const HOVER_LAYOUT_PROPS = [
  "font-size", "line-height", "letter-spacing", "word-spacing",
  "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
  "padding-inline", "padding-block", "margin", "margin-top", "margin-right",
  "margin-bottom", "margin-left", "width", "height", "min-width", "min-height",
  "max-width", "max-height", "gap", "row-gap", "column-gap", "display", "position",
  "top", "left", "right", "bottom", "inset", "flex", "flex-basis", "flex-grow",
  "grid-template-columns", "grid-template-rows", "border-width", "overflow",
  "white-space",
]

/** 卡片类重复单元的特征（用于位置选择器与一致性审计）。 */
const CARD_SELECTOR_RE = /(?:card|post|item|entry|article|tile)/i
const POSITION_PSEUDO_RE =
  /:nth-(?:child|of-type)|:first-child|:last-child|:only-child/
/** 会让同组卡片「长得不一样」的差异化声明。 */
const DIFFERENTIATING_DECL_RE =
  /(?:^|[;\n])\s*(?:font-size|font-weight|color|background-color|padding(?:-[\w-]+)?|margin(?:-[\w-]+)?|width|height|border-color|opacity)\s*:/i

/** 检查声明串里是否出现某个 CSS 属性（容忍缩进与换行）。 */
function hasDecl(body: string, prop: string): boolean {
  return new RegExp(`(?:^|[;\\n])\\s*${prop}\\s*:`, "i").test(body)
}

/**
 * 检查 hover 反馈态：
 * - 完全没有交互反馈 → warn；
 * - hover/focus 里改了布局属性或 transform 幅度过大 → error（会触发修订）。
 */
function checkHover(css: string, issues: string[], warnings: string[]): void {
  if (!/:hover|:focus/i.test(css)) {
    warnings.push("没有任何 :hover 交互反馈态")
    return
  }

  const found: string[] = []
  for (const block of parseRuleBlocks(css)) {
    const interactive = block.selectors.filter((s) => /:hover|:focus/i.test(s))
    if (interactive.length === 0) continue
    // 伪元素装饰（导航下划线展开、光晕、几何纹理）是绝对定位元素，
    // 改 width/left/transform 都不会影响文档流，不算布局问题。
    const flowTargets = interactive.filter(
      (s) => !/::?(?:before|after)/i.test(s)
    )
    if (flowTargets.length === 0) continue
    const label = flowTargets[0].trim().slice(0, 80)

    const badProps = HOVER_LAYOUT_PROPS.filter((p) => hasDecl(block.body, p))
    if (badProps.length > 0) {
      found.push(`${label} 改了布局属性 ${badProps.slice(0, 4).join("/")}`)
    }

    // transform 不引起 reflow，只有整卡位移会让同行卡片高低错落；
    // 卡片内部缩略图 scale 属纯视觉放大，放行。
    const transform = lastDecl(block.body, "transform")
    if (transform) {
      const ty = /translateY\(\s*(-?[\d.]+)px\s*\)/i.exec(transform)
      if (ty && Math.abs(parseFloat(ty[1])) > 4) {
        found.push(`${label} transform 位移 ${ty[1]}px 超过 4px`)
      }
    }
  }

  if (found.length > 0) {
    issues.push(
      `hover/focus 态改变了布局，会造成文字重排与同组卡片高低错落：${found
        .slice(0, 3)
        .join("；")}。请只改 color/background-color/border-color/box-shadow/opacity/text-shadow；transform 只用不引起重排的视觉变换，整卡 translateY 不超过 4px`
    )
  }
}

/**
 * 检查用位置选择器给同类卡片做差异化样式。
 * 渲染期会为每张卡片包一层 <a style="display:contents">（整卡可点），卡片不再是
 * 网格的直接子项，:nth-child / :first-child 必然失效或全部错配成同一规则。
 * 纯装饰性伪元素（::before/::after 的几何纹理）不改变布局与文字样式，放行。
 */
function checkCardPositionStyles(css: string, issues: string[]): void {
  const bad = new Set<string>()
  for (const block of parseRuleBlocks(css)) {
    for (const sel of block.selectors) {
      if (!POSITION_PSEUDO_RE.test(sel) || !CARD_SELECTOR_RE.test(sel)) continue
      if (/::?(?:before|after)/i.test(sel)) continue
      if (!DIFFERENTIATING_DECL_RE.test(block.body)) continue
      bad.add(sel.trim().slice(0, 80))
    }
  }
  if (bad.size === 0) return
  issues.push(
    `使用位置选择器给同类卡片做差异化：${Array.from(bad)
      .slice(0, 3)
      .join("、")}。渲染期会为每张卡片包裹链接，:nth-child / :first-child 会失效或错配，造成同组卡片样式不一致；请把差异化收敛到不改变布局与文字样式的装饰性伪元素上`
  )
}

/** 声明串里是否把水平外边距设为 auto（限宽容器居中的判据）。 */
const CENTERED_DECL_RE =
  /(?:^|[;\n])\s*margin(?:-inline|-left|-right)?\s*:\s*[^;]*\bauto\b/i

/**
 * 正文区宽度与填充审计：抓「内容只占左侧、右侧一大块空白」。
 *
 * 三类确定性成因：
 * 1. 限宽容器只写 max-width 却漏了 margin-inline:auto；
 * 2. 给 [data-page-host] 自身设宽度/栅格列，正文被挤进窄列；
 * 3. 卡片网格写死固定列数，宽屏上多出来的宽度没有列去填。
 */
function checkContentWidth(
  css: string,
  issues: string[],
  warnings: string[]
): void {
  const blocks = parseRuleBlocks(css)

  // 1. 限宽容器未居中
  const uncentered = new Set<string>()
  for (const block of blocks) {
    for (const sel of block.selectors) {
      if (!/(?:\.wrap|\.container|\.section|data-page-host|^\s*main\b)/i.test(sel)) {
        continue
      }
      // 只关心真正的「限宽」，且排除 theme-safety 的 max-width:100% 兜底
      const mw = /(?:^|[;\n])\s*max-width\s*:\s*([^;]+)/i.exec(block.body)
      if (!mw || /^\s*100%\s*$/.test(mw[1])) continue
      if (CENTERED_DECL_RE.test(block.body)) continue
      uncentered.add(sel.trim().slice(0, 70))
    }
  }
  if (uncentered.size > 0) {
    issues.push(
      `限宽容器未居中：${Array.from(uncentered)
        .slice(0, 3)
        .join("、")}。只写 max-width 不写 margin-inline:auto，宽屏上正文会全挤在左侧、右侧留出一大块空白；请补 width:100%; margin-inline:auto`
    )
  }

  // 2. host 自身被限宽 / 变成栅格
  //    注意：不能用 `(?!100%)` 负向前瞻 —— `\s*` 回溯会让它在 ": 100%" 的
  //    空格处通过，把 theme-safety 的 max-width:100% 兜底误判为限宽。
  //    一律先提取声明值再判断。
  const hostConstrained = blocks.some((block) => {
    if (!block.selectors.some((s) => /data-page-host/i.test(s))) return false
    if (/(?:^|[;\n])\s*grid-template-columns\s*:/i.test(block.body)) return true
    for (const prop of ["width", "max-width"]) {
      const m = new RegExp(
        `(?:^|[;\\n])\\s*${prop}\\s*:\\s*([^;]+)`,
        "i"
      ).exec(block.body)
      if (!m) continue
      const value = m[1].trim().toLowerCase()
      if (value !== "100%" && value !== "auto" && value !== "none") return true
    }
    return false
  })
  if (hostConstrained) {
    issues.push(
      "[data-page-host] 被设置了宽度或栅格列：它是全站正文容器，会把正文挤进窄列、右侧留白；请改为在内部 .wrap/.container 上限宽并用 margin-inline:auto 居中"
    )
  }

  // 3. 固定列数的文章网格
  const fixed: string[] = []
  for (const block of blocks) {
    const gtc = /(?:^|[;\n])\s*grid-template-columns\s*:\s*([^;]+)/i.exec(
      block.body
    )
    if (!gtc) continue
    const value = gtc[1].trim()
    if (/auto-fill|auto-fit/i.test(value)) continue
    const isRepeat = /^repeat\(\s*(\d+)\s*,\s*1fr\s*\)$/i.test(value)
    const isPlain = /^(?:1fr\s+){1,4}1fr$/i.test(value)
    if (!isRepeat && !isPlain) continue
    if (!block.selectors.some((s) => /grid|card|post|list|articles/i.test(s))) {
      continue
    }
    fixed.push(`${block.selectors[0].trim().slice(0, 48)} → ${value.slice(0, 36)}`)
  }
  if (fixed.length > 0) {
    warnings.push(
      `多列网格写死固定列数（${fixed
        .slice(0, 2)
        .join("；")}），大屏上右侧会空出整列；建议改用 repeat(auto-fill, minmax(280px, 1fr))`
    )
  }
}

/**
 * 卡片对齐稳定性（warn，不阻断）：等高、尾部贴底、行数钳制。
 * 缺这些时，长标题会把标签/按钮顶到不同高度，同行卡片内容上下错位。
 */
function checkCardConsistency(css: string, warnings: string[]): void {
  const cardBodies = parseRuleBlocks(css)
    .filter((b) => b.selectors.some((s) => CARD_SELECTOR_RE.test(s)))
    .map((b) => b.body)
    .join("\n")
  if (!cardBodies.trim()) return

  const missing: string[] = []
  if (
    !/align-items\s*:\s*stretch/i.test(css) &&
    !/height\s*:\s*100%/i.test(cardBodies)
  ) {
    missing.push("等高（align-items:stretch / 卡片 height:100%）")
  }
  if (!/margin-top\s*:\s*auto/i.test(cardBodies)) {
    missing.push("尾部元素贴底（margin-top:auto）")
  }
  if (!/(?:-webkit-)?line-clamp/i.test(cardBodies)) {
    missing.push("标题/摘要行数钳制（-webkit-line-clamp）")
  }
  if (missing.length === 0) return
  warnings.push(
    `重复卡片对齐稳定性不足，缺少：${missing.join("、")}。标题/摘要长短不一时，同行卡片内容会上下错位`
  )
}

/** 检查响应式断点（warn）。 */
function checkMediaQueries(css: string, warnings: string[]): void {
  if (!/@media[^{]*\(/i.test(css)) {
    warnings.push("缺少 @media 响应式断点，移动端适配存疑")
  }
}

/**
 * 检查字体栈特色度：所有 font-family 都只由系统默认无衬线字体组成时告警。
 * 衬线/等宽等通用族视为有特色（杂志风/工业风常用）。
 */
const BLAND_FONTS =
  /^(system-ui|-apple-system|segoe ui|roboto|helvetica neue|helvetica|arial|pingfang sc|hiragino sans gb|microsoft yahei|微软雅黑|sans-serif)$/i

function checkTypography(css: string, warnings: string[]): void {
  const stacks: string[] = []
  const re = /font-family\s*:\s*([^;}]+)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(css)) !== null) stacks.push(m[1])
  const hasDistinctive = stacks.some((stack) =>
    stack
      .split(",")
      .map((f) => f.trim().replace(/^['"]|['"]$/g, ""))
      .some((f) => f !== "" && !BLAND_FONTS.test(f))
  )
  if (stacks.length > 0 && !hasDistinctive) {
    warnings.push("标题/正文字体栈全是系统默认无衬线字体，缺乏排版个性")
  }
}

/** 检查 :root 设计变量数量（warn）。 */
function checkRootVars(css: string, warnings: string[]): void {
  const count = collectRootVars(css).size
  if (count > 0 && count < MIN_ROOT_VARS) {
    warnings.push(`:root 设计变量仅 ${count} 个（少于 ${MIN_ROOT_VARS} 个），色彩/圆角/阴影等参数体系单薄`)
  } else if (count === 0) {
    warnings.push(":root 未定义任何 CSS 设计变量，配色与间距未被统一管理")
  }
}

/** 选择器是否命中导航类元素（nav / header 标签或含 nav 的类，如 .main-nav/.navbar）。 */
function selectorIsNavOrHeader(s: string): boolean {
  return /navbar|\bnav\b|header/i.test(s)
}

/** 骨架是否存在固定导航：某条 nav/header 规则将 position 声明为 fixed。 */
function hasFixedNav(css: string): boolean {
  return parseRuleBlocks(css).some(
    (block) =>
      block.selectors.some(selectorIsNavOrHeader) &&
      /(?:^|;)\s*position\s*:\s*fixed/i.test(block.body)
  )
}

/**
 * body / html,body 规则是否已通过 padding/margin 引用导航变量提供顶部留白。
 * 识别 --nav-h（历史写法）与 --nav-clearance（现行契约：顶部留白只由它承担）。
 */
function hasBodyTopClearance(css: string): boolean {
  return parseRuleBlocks(css).some((block) => {
    const hitsBody = block.selectors.some((s) =>
      /(?:^|[\s,>+~(])(?:html\s*,\s*body|body)(?:$|[\s,.:#\[{>~+])/i.test(s)
    )
    return (
      hitsBody &&
      /(?:padding|margin)(?:-top)?\s*:\s*[^;}]*var\(\s*--(?:nav-h|nav-clearance)(?![-\w])/.test(
        block.body
      )
    )
  })
}

/** 检查固定导航是否预留 body 级留白（否则首页首屏会被导航遮挡）。 */
function checkNavClearance(css: string, issues: string[]): void {
  if (hasFixedNav(css) && !hasBodyTopClearance(css)) {
    issues.push(
      "固定导航（position:fixed）未预留 body 级顶部留白，首页首屏会被导航遮挡；请在 :root 定义 --nav-h 后增加 body{padding-top:var(--nav-clearance,0px)}（--nav-clearance 由运行时测量固定导航高度后写入）"
    )
  }
}

/** 收集片段中元素实际使用的类名（不含 CSS 声明）。 */
export function collectElementClasses(html: string): Set<string> {
  const dom = new JSDOM(html)
  const classes = new Set<string>()
  for (const el of Array.from(
    dom.window.document.querySelectorAll<HTMLElement>("[class]")
  )) {
    for (const cls of (el.getAttribute("class") ?? "").split(/\s+/)) {
      if (cls) classes.add(cls)
    }
  }
  return classes
}

/** 收集片段内联 style 中会导致横向溢出的刚性宽度（vw>100、px>1400）。 */
function collectInlineRigidSizes(html: string): string[] {
  const dom = new JSDOM(html)
  const found: string[] = []
  for (const el of Array.from(
    dom.window.document.querySelectorAll<HTMLElement>("[style]")
  )) {
    const style = el.getAttribute("style") ?? ""
    const re = /(?:width|min-width)\s*:\s*(\d+(?:\.\d+)?)(px|vw)/gi
    let m: RegExpExecArray | null
    while ((m = re.exec(style)) !== null) {
      const n = parseFloat(m[1])
      if ((m[2] === "vw" && n > 100) || (m[2] === "px" && n > 1400)) {
        found.push(`内联样式 ${(el.getAttribute("class") ?? el.tagName.toLowerCase())} 使用 ${m[0]}，可能横向溢出`)
        break
      }
    }
  }
  return found
}

/** 复用 theme-splitter 同款逻辑收集骨架类库（元素类名 + CSS 声明类名）。 */
function collectSkeletonClasses(layoutHtml: string): Set<string> {
  const dom = new JSDOM(layoutHtml)
  const classes = collectElementClasses(layoutHtml)
  for (const style of Array.from(
    dom.window.document.querySelectorAll("style")
  )) {
    const css = style.textContent ?? ""
    const re = /\.([a-zA-Z_][\w-]*)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(css)) !== null) {
      classes.add(m[1])
    }
  }
  return classes
}

/**
 * 对骨架与本次生成的页面做静态样式审计。
 * @param layoutHtml 完整骨架 HTML（含 head 样式）
 * @param pages 参与审计的页面片段（须为净化后的 fragment）
 */
export function analyzeSkeletonStyles(
  layoutHtml: string,
  pages: Record<string, string> = {}
): StyleAuditReport {
  const css = extractCssFromLayout(layoutHtml)
  const skeletonIssues: string[] = []
  const warnings: string[] = []

  if (!css.trim()) {
    skeletonIssues.push("骨架未包含任何 <style> 样式定义")
  } else {
    checkBackground(css, skeletonIssues)
    checkMotion(css, skeletonIssues)
    checkNavClearance(css, skeletonIssues)
    checkHover(css, skeletonIssues, warnings)
    checkCardPositionStyles(css, skeletonIssues)
    checkCardConsistency(css, warnings)
    checkContentWidth(css, skeletonIssues, warnings)
    checkMediaQueries(css, warnings)
    checkTypography(css, warnings)
    checkRootVars(css, warnings)
  }

  const pageIssues: Record<string, string[]> = {}
  if (css.trim()) {
    const skeletonClasses = collectSkeletonClasses(layoutHtml)
    for (const [type, html] of Object.entries(pages)) {
      if (!html) continue
      const used = collectElementClasses(html)
      const missing = Array.from(used)
        // 桥接源类名（如 .post-list）由映射到的目标类提供样式，不算「未定义」
        .filter((cls) => !skeletonClasses.has(cls))
        .filter((cls) => !CLASS_BRIDGE_SOURCE_CLASSES.has(cls))
      const ratio = used.size > 0 ? missing.length / used.size : 0
      if (
        missing.length >= MISSING_CLASS_MIN_COUNT &&
        ratio >= MISSING_CLASS_MIN_RATIO
      ) {
        pageIssues[type] = [
          `页面使用了骨架未定义的类名（将失去样式）：${missing
            .slice(0, MAX_MISSING_CLASSES)
            .join(", ")}`,
        ]
      }

      const rigidSizes = collectInlineRigidSizes(html)
      if (rigidSizes.length > 0) {
        ;(pageIssues[type] ??= []).push(...rigidSizes)
      }

      const pageAvatarCount = countAvatars(html)
      if (pageAvatarCount > 1) {
        ;(pageIssues[type] ??= []).push(
          `页面正文出现 ${pageAvatarCount} 个作者头像（同一区域重复展示），正文区应只保留 1 个；导航品牌区头像由布局提供，与正文各自独立`
        )
      }
      // 导航头像 + 正文头像并存是现行渲染契约（chrome 与正文各自最多 1 个），
      // 不再判为重复 —— 旧规则会让 LLM「放也错、删也错」，反复触发修订。

      const textAvatars = collectTextAvatarPlaceholders(html)
      if (textAvatars.length > 0) {
        ;(pageIssues[type] ??= []).push(
          `作者头像占位被写成非 <img> 的文本字段（${textAvatars
            .slice(0, 2)
            .join("、")}）：author-avatar 的值是图片 URL，会被渲染成一串可见字符；请改用 ${AVATAR_PLACEHOLDER_HINT} 或在容器内放 <img>`
        )
      }

      // 固定列数网格 + 子项数不整除：最后一行会露出容器背景形成大块空白。
      // 渲染期有确定性兜底，这里只给 warn，不为它额外触发一轮修订。
      for (const msg of collectIncompleteGridRows(css, html)) {
        warnings.push(`[${type}] ${msg}`)
      }
    }
  }

  return { skeletonIssues, warnings, pageIssues }
}

/** 统计 HTML 中的作者头像视觉元素数量（仅显式标记，不含装饰性渐变圆）。 */
function countAvatars(html: string): number {
  const dom = new JSDOM(html)
  return dom.window.document.querySelectorAll(
    '[data-content="author-avatar"], img.avatar'
  ).length
}

const AVATAR_PLACEHOLDER_HINT =
  '<img class="avatar" data-content="author-avatar" data-content-type="text" src="" alt="作者头像">'

/**
 * 找出「被标成 text 字段、但自身不是 img 且内部也没有 img」的头像占位。
 * author-avatar 的值是图片 URL，渲染器对普通元素会写 textContent，
 * 结果页面显示一串 /api/uploads/... 字符而不是头像。
 */
function collectTextAvatarPlaceholders(html: string): string[] {
  const doc = new JSDOM(html).window.document
  const out: string[] = []
  for (const el of Array.from(
    doc.querySelectorAll('[data-content*="avatar"][data-content-type="text"]')
  )) {
    if (el.tagName.toLowerCase() === "img" || el.querySelector("img")) continue
    const cls = el.getAttribute("class")
    out.push(`<${el.tagName.toLowerCase()}${cls ? ` class="${cls}"` : ""}>`)
  }
  return out
}

/**
 * 固定列数网格（repeat(N, ...)）里，静态子项数不是 N 的整数倍时，
 * 最后一行会露出容器背景，形成一大块空白并把下一区块顶出异常间隔。
 */
function collectIncompleteGridRows(css: string, html: string): string[] {
  const doc = new JSDOM(html).window.document
  const out = new Set<string>()
  for (const block of parseRuleBlocks(css)) {
    const gtc =
      /(?:^|[;\n])\s*grid-template-columns\s*:\s*repeat\(\s*(\d+)\s*,/i.exec(
        block.body
      )
    if (!gtc) continue
    const columns = Number(gtc[1])
    if (columns < 2) continue
    for (const selector of block.selectors) {
      const cls = /\.([a-zA-Z_][\w-]*)/.exec(selector)?.[1]
      if (!cls) continue
      let nodes: Element[]
      try {
        nodes = Array.from(doc.querySelectorAll("." + cls))
      } catch {
        continue
      }
      for (const node of nodes) {
        const count = Array.from(node.children).length
        if (count > columns && count % columns !== 0) {
          out.add(
            `.${cls} 写死 ${columns} 列但页面里有 ${count} 个子项，最后一行会空出容器背景；请改用 repeat(auto-fit, minmax(240px, 1fr))`
          )
          break
        }
      }
    }
  }
  return Array.from(out)
}
