import { JSDOM } from "jsdom"

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

/** 检查 hover 反馈态（warn）。 */
function checkHover(css: string, warnings: string[]): void {
  if (!/:hover/i.test(css)) {
    warnings.push("没有任何 :hover 交互反馈态")
  }
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
    checkHover(css, warnings)
    checkMediaQueries(css, warnings)
    checkTypography(css, warnings)
    checkRootVars(css, warnings)
  }

  const pageIssues: Record<string, string[]> = {}
  if (css.trim()) {
    const skeletonClasses = collectSkeletonClasses(layoutHtml)
    for (const [type, html] of Object.entries(pages)) {
      if (!html) continue
      const missing = Array.from(collectElementClasses(html))
        .filter((cls) => !skeletonClasses.has(cls))
        .slice(0, MAX_MISSING_CLASSES)
      if (missing.length > 0) {
        pageIssues[type] = [
          `页面使用了骨架未定义的类名（将失去样式）：${missing.join(", ")}`,
        ]
      }
    }
  }

  return { skeletonIssues, warnings, pageIssues }
}
