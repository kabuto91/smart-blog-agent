/**
 * 导航留白（nav clearance）契约 —— 服务端渲染（mergeThemePage）与客户端预览
 * （injectPageIntoLayout）共用同一份实现，避免两端口径分叉。
 *
 * 【为什么必须拆成两个变量】
 * 历史上只有一个 `--nav-h`，同时承担「导航自身高度」与「body 顶部留白」两个语义，
 * 而运行时测量脚本会把它**无条件覆盖**为测量值（内联样式优先级高于 `:root`）：
 *   - 吸顶(sticky)/静态导航 → 找不到 fixed 元素 → 写成 0px；
 *   - 左侧全高固定侧栏 → 被「全屏浮层」过滤 → 写成 0px。
 * 于是骨架里声明的设计令牌（`--nav-h: 64px`）在运行时被抹掉，
 * 连带把 `.sidebar { top: calc(var(--nav-h) + 16px) }` 之类的设计计算一并破坏，
 * 表现为导航塌陷、首屏被遮挡、侧栏错位。
 *
 * 【新契约】
 * - `--nav-h`：导航元素**自身高度**（设计值）。只由骨架 CSS 声明，运行时**永不修改**。
 *   骨架可自由用于 sticky 偏移、侧栏定位等计算。
 * - `--nav-clearance`：为**固定顶部导航**预留的额外顶部空间（运行时测量值）。
 *   仅在检测到固定顶部导航时由脚本写入；否则移除内联值（保持未定义，回落 0）。
 *
 * 顶部留白**只由 `--nav-clearance` 产生**，确保留白与设计令牌互不污染。
 */

/** 导航自身高度的设计令牌名。 */
export const NAV_HEIGHT_VAR = "--nav-h"
/** 固定导航顶部留白的运行时令牌名。 */
export const NAV_CLEARANCE_VAR = "--nav-clearance"

/**
 * body/html 规则块匹配（供留白判定与留白归一化共用）。
 *
 * 用零宽 lookbehind 表达「前面是分隔符或字符串开头」而不是消费分隔符：
 * 若把分隔符消费掉，上一条规则的 `}` 会被吃掉，紧接着的 body 规则就再也匹配不到
 * （规则之间有换行时前缀无法再匹配），导致归一化静默失效。
 * lookbehind 检查的是源字符串而非已消费区间，因此不会��此问题。
 *
 * 捕获组 1 = 选择器+花括号，捕获组 2 = 声明块内容。
 */
const BODY_BLOCK_RE =
  /(?<=^|[{};,]\s*)((?:html\s*,\s*body|body\s*,\s*html|html|body)\s*\{)([^}]*)\}/gim

/** body/html 顶部留白声明里是否引用了导航变量。 */
const NAV_VAR_REF_RE = /var\(\s*--(?:nav-h|nav-clearance)(?![-\w])/

/** 归一化时把 `var(--nav-h…)` 替换成的留白表达式。 */
const CLEARANCE_EXPR = `var(${NAV_CLEARANCE_VAR}, 0px)`

/** 从整段 HTML 中提取所有 <style> 的 CSS 文本。 */
export function extractStyleCss(html: string): string {
  const out: string[] = []
  const re = /<style\b[^>]*>([\s\S]*?)<\/style>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) out.push(m[1])
  return out.join("\n")
}

/**
 * 判定布局 CSS 是否已在 body/html 上提供顶部留白。
 * 识别 padding / padding-top / margin / margin-top 引用 --nav-h 或 --nav-clearance。
 */
export function hasBodyTopClearance(css: string): boolean {
  const re = new RegExp(BODY_BLOCK_RE.source, "gim")
  let m: RegExpExecArray | null
  while ((m = re.exec(css)) !== null) {
    if (NAV_VAR_REF_RE.test(m[2])) return true
  }
  return false
}

/**
 * 判定整段布局 HTML 是否已在 body/html 上提供顶部留白。
 * 服务端与客户端预览统一走这里，保证「预览所见 = 线上所得」。
 */
export function hasBodyNavClearance(html: string): boolean {
  return hasBodyTopClearance(extractStyleCss(html))
}

/**
 * 归一化 body/html 上的顶部留白表达式：
 * 把 `var(--nav-h)` / `var(--nav-h, 72px)` 改写为 `var(--nav-clearance, 0px)`。
 *
 * 效果：
 * - 固定顶部导航 → `--nav-clearance` 被脚本写成实测高度 → 顶部留白 = 导航实测高度；
 * - 吸顶/静态/侧栏布局 → `--nav-clearance` 未定义 → 回落 0px（不留多余空白），
 *   而 `--nav-h` 设计令牌保持原值，继续服务于 sticky 偏移等计算。
 *
 * 只处理 body/html 的 padding/margin 声明，其它选择器里的 --nav-h 不受影响。
 */
export function normalizeNavClearanceCss(css: string): string {
  return css.replace(
    BODY_BLOCK_RE,
    (full: string, open: string, body: string) => {
      const rewritten = body.replace(
        /((?:padding|margin)(?:-top)?\s*:\s*)([^;{}]+)/gi,
        (decl: string, prop: string, value: string) => {
          if (!/var\(\s*--nav-h(?![-\w])/.test(value)) return decl
          return (
            prop +
            value.replace(
              /var\(\s*--nav-h(?![-\w])\s*(?:,[^)]*)?\)/g,
              CLEARANCE_EXPR
            )
          )
        }
      )
      // open 已包含选择器与左花括号，补回右花括号即可
      return open + rewritten + "}"
    }
  )
}
