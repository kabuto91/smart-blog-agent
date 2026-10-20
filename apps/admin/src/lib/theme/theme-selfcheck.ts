import { JSDOM } from "jsdom"
import {
  mergeThemePage,
  collectThemeClasses,
  CLASS_BRIDGE_SOURCE_CLASSES,
} from "@smart-blog/core/lib/theme/theme-splitter"
import { isDataDrivenNavHref } from "@smart-blog/core/lib/theme/content-extractor"

/**
 * 主题渲染后自检（Theme Integrity Check）。
 *
 * 【为什么需要】
 * 现有校验全部作用于**片段级**（生成阶段），用户看到的却是**合并产物**。
 * 中间这段（布局契约补全 → 片段合并 → 动态内容渲染）没有任何检查，
 * 于是「校验通过但上线错乱」长期存在：
 *   - 页面片段自带 <nav>：校验只报告不剥离，修订次数用完就直接提交 → 线上两个导航；
 *   - 页面用了骨架没定义的类名：样式直接丢失，audit 只在片段级报；
 *   - CSS 引用了未定义的 var(--x)：浏览器会**整条丢弃该声明** → 样式凭空失效；
 *   - 合并后出现第二个 [data-page-host]：正文被塞进嵌套容器。
 *
 * 本模块对**合并后的产物**做确定性检查，产出 blocker（必须修复，否则拒绝保存）
 * 与 error（应触发修订）两级结论。
 */

export type IssueLevel = "blocker" | "error" | "warn"

export interface ThemeIntegrityIssue {
  level: IssueLevel
  /** "skeleton" 或页面类型（home/list/detail/custom…） */
  scope: string
  message: string
}

export interface ThemeIntegrityReport {
  issues: ThemeIntegrityIssue[]
  /** 必须修复的问题（存在则拒绝保存） */
  blockers: ThemeIntegrityIssue[]
  /** 无 blocker 即视为可保存 */
  ok: boolean
}

/** 页面未定义类名达到该数量即判定为 blocker（样式大面积丢失）。 */
const MISSING_CLASS_BLOCK_COUNT = 3
/** 页面未定义类名占比达到该比例即判定为 blocker。 */
const MISSING_CLASS_BLOCK_RATIO = 0.3

/** 收集 CSS 中声明过的全部自定义属性（含非 :root 作用域，避免误报）。 */
function collectDeclaredCssVars(css: string): Set<string> {
  const vars = new Set<string>()
  const re = /(--[a-zA-Z][\w-]*)\s*:/g
  let m: RegExpExecArray | null
  while ((m = re.exec(css)) !== null) vars.add(m[1])
  return vars
}

/**
 * 收集 CSS 中被 var() 引用、且**没有 fallback** 的自定义属性。
 *
 * 只有 `var(--x)` 这种无兜底写法才有风险：变量未定义时浏览器会丢弃整条声明
 * （表现为样式凭空失效）。`var(--x, 0px)` 带 fallback，即使变量未定义也能正常回退，
 * 不算问题（例如顶部留白的 var(--nav-clearance, 0px) 就是刻意留给运行时写入的）。
 */
function collectUnresolvedCssVars(css: string): Set<string> {
  const vars = new Set<string>()
  const re = /var\(\s*(--[a-zA-Z][\w-]*)(?![-\w])\s*([,)])/g
  let m: RegExpExecArray | null
  while ((m = re.exec(css)) !== null) {
    // 逗号表示带 fallback → 安全；右括号表示无 fallback → 需检查
    if (m[2] === ",") continue
    vars.add(m[1])
  }
  return vars
}

/** 提取整段 HTML 中所有 <style> 的 CSS 文本。 */
function collectCss(html: string): string {
  const out: string[] = []
  const re = /<style\b[^>]*>([\s\S]*?)<\/style>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) out.push(m[1])
  return out.join("\n")
}

/** 页面片段中不应出现的标签（导航/页脚由布局统一提供）。 */
const FORBIDDEN_IN_PAGE = "nav, footer, style, script, link, meta, title, template"

/** 收集片段中元素实际使用的类名（不含 CSS 声明）。 */
function collectUsedClasses(html: string): Set<string> {
  const dom = new JSDOM(html)
  const classes = new Set<string>()
  for (const el of dom.window.document.querySelectorAll<HTMLElement>("[class]")) {
    for (const cls of (el.getAttribute("class") ?? "").split(/\s+/)) {
      if (cls) classes.add(cls)
    }
  }
  return classes
}

/** 站点级 header（body 直属）属于布局职责，片段里出现即为重复 chrome。 */
function hasSiteLevelHeader(html: string): boolean {
  const dom = new JSDOM(html)
  for (const el of dom.window.document.querySelectorAll("header")) {
    const parent = el.parentElement
    if (!parent) continue
    const tag = parent.tagName.toLowerCase()
    if (tag === "body" || tag === "html") return true
  }
  return false
}

function issue(
  level: IssueLevel,
  scope: string,
  message: string
): ThemeIntegrityIssue {
  return { level, scope, message }
}

/**
 * 对骨架 + 各页面片段做渲染后自检。
 *
 * @param layoutHtml 共享布局 HTML（须已过 ensureLayoutContract）
 * @param pages 页面类型 → 页面正文片段
 */
export function checkThemeIntegrity(
  layoutHtml: string,
  pages: Record<string, string> = {}
): ThemeIntegrityReport {
  const issues: ThemeIntegrityIssue[] = []

  // ── 骨架级 ──────────────────────────────────────────────
  const css = collectCss(layoutHtml)
  if (!css.trim()) {
    issues.push(
      issue("blocker", "skeleton", "骨架未包含任何 <style> 样式定义，整站将完全没有样式")
    )
  } else {
    // CSS 变量完整性：var(--x) 无 fallback 且变量未定义时，
    // 浏览器会直接丢弃整条声明 —— 这是「样式凭空失效」最常见的成因。
    const declared = collectDeclaredCssVars(css)
    const used = collectUnresolvedCssVars(css)
    const missing = Array.from(used).filter((v) => !declared.has(v))
    if (missing.length > 0) {
      issues.push(
        issue(
          "blocker",
          "skeleton",
          `CSS 引用了未定义的自定义属性：${missing.join(", ")}。浏览器会丢弃包含这些 var() 的整条声明（表现为样式凭空失效），请在 :root 中补齐定义`
        )
      )
    }
    if (!/--nav-h\s*:/.test(css)) {
      issues.push(
        issue(
          "blocker",
          "skeleton",
          ":root 未声明 --nav-h（导航自身高度），导航高度不可控，布局留白无法与导航对齐"
        )
      )
    }
  }

  const layoutClasses = collectThemeClasses(layoutHtml)

  // ── 骨架级：导航里硬编码的数据驱动链接 ──────────────────
  // 分类/标签/具体文章的 slug 是 LLM 编造的，点了会失效；且会与正文里
  // 按真实数据渲染的动态标签云/分类列表重复展示同一批标签。
  // 提取阶段已过滤掉这些项，这里作为提示反馈给修订流程。
  {
    const navDoc = new JSDOM(layoutHtml).window.document
    const hardCoded: string[] = []
    for (const el of Array.from(navDoc.querySelectorAll("nav a[href]"))) {
      const href = el.getAttribute("href") ?? ""
      if (!isDataDrivenNavHref(href)) continue
      const label = (el.textContent ?? "").trim().slice(0, 20)
      hardCoded.push(`${label || "(无标题)"} → ${href}`)
    }
    if (hardCoded.length > 0) {
      issues.push(
        issue(
          "warn",
          "skeleton",
          `导航里硬编码了分类/标签/具体文章链接（${hardCoded.join("、")}），这些 slug 是编造的且会与动态标签云/分类列表重复；导航只应保留核心路由（/blog、/blog/archive）`
        )
      )
    }
  }

  // ── 页面级 ──────────────────────────────────────────────
  for (const [type, html] of Object.entries(pages)) {
    if (!html) continue

    const forbidden = Array.from(
      new JSDOM(html).window.document.querySelectorAll(FORBIDDEN_IN_PAGE)
    )
    if (forbidden.length > 0) {
      const tags = Array.from(new Set(forbidden.map((e) => e.tagName.toLowerCase())))
      issues.push(
        issue(
          "blocker",
          type,
          `页面正文包含布局已提供的标签 <${tags.join("> <")}>，会渲染出重复的导航/页脚或独立样式作用域，必须移除`
        )
      )
    }
    if (hasSiteLevelHeader(html)) {
      issues.push(
        issue(
          "blocker",
          type,
          "页面正文包含站点级 <header>（body 直属），与布局的页头重复，必须移除"
        )
      )
    }

    const used = collectUsedClasses(html)
    const missing = Array.from(used)
      .filter((c) => !layoutClasses.has(c))
      // 桥接源类名由映射到的目标类提供样式，不算「未定义」
      .filter((c) => !CLASS_BRIDGE_SOURCE_CLASSES.has(c))
    if (missing.length > 0) {
      const ratio = used.size > 0 ? missing.length / used.size : 0
      // 只有「大面积」未定义才判定为 blocker —— 少量未定义类（如动效工具类）
      // 由 audit 阶段以 error 级反馈给 LLM 修订即可，不必直接拒绝保存。
      const level: IssueLevel =
        missing.length >= MISSING_CLASS_BLOCK_COUNT &&
        ratio >= MISSING_CLASS_BLOCK_RATIO
          ? "blocker"
          : "warn"
      issues.push(
        issue(
          level,
          type,
          `页面使用了骨架未定义的类名（将失去样式）：${missing.join(", ")}。请改用骨架已定义的类名，或在骨架 CSS 中补充定义`
        )
      )
    }
  }

  // ── 合并产物级 ──────────────────────────────────────────
  for (const [type, html] of Object.entries(pages)) {
    if (!html) continue
    let merged: string
    try {
      merged = mergeThemePage(layoutHtml, html)
    } catch {
      issues.push(
        issue("blocker", type, "页面正文与布局合并失败（渲染时会直接报错）")
      )
      continue
    }
    const doc = new JSDOM(merged).window.document
    const hosts = doc.querySelectorAll("[data-page-host]")
    if (hosts.length !== 1) {
      // 多余的 host 属于契约违反（正文被塞进嵌套容器），但视觉影响有限，
      // 归为 error：交给修订流程修掉，不直接拒绝保存。
      issues.push(
        issue(
          "error",
          type,
          `合并后存在 ${hosts.length} 个 [data-page-host]（应为 1 个），正文被塞进嵌套容器，会与布局的容器样式叠加造成排版错乱`
        )
      )
      continue
    }
    const host = hosts[0]
    const leaked = Array.from(host.querySelectorAll(FORBIDDEN_IN_PAGE))
    if (leaked.length > 0) {
      const tags = Array.from(new Set(leaked.map((e) => e.tagName.toLowerCase())))
      issues.push(
        issue(
          "blocker",
          type,
          `合并后正文区内仍存在 <${tags.join("> <")}>，渲染期会输出重复的导航/样式`
        )
      )
    }
  }

  const blockers = issues.filter((i) => i.level === "blocker")
  return { issues, blockers, ok: blockers.length === 0 }
}

/** 把自检结论格式化为可读文本（用于提示 LLM 修订 / 展示给用户）。 */
export function formatIntegrityIssues(
  report: ThemeIntegrityReport,
  level?: IssueLevel
): string {
  const list = level
    ? report.issues.filter((i) => i.level === level)
    : report.issues
  return list
    .map((i) => `- [${i.scope}] ${i.message}`)
    .join("\n")
}
