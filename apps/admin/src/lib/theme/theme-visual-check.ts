import { existsSync, readdirSync } from "fs"
import { join } from "path"
import { mergeThemePage } from "@smart-blog/core/lib/theme/theme-splitter"

/**
 * 主题几何验证（Playwright）。
 *
 * 【定位】
 * 静态检查（theme-selfcheck）能发现「结构/CSS 层面」的确定性缺陷，
 * 但发现不了「渲染后几何层面」的问题：
 *   - 固定导航高度塌成 0（sticky 导航 + --nav-h 被运行时覆盖）；
 *   - 固定导航遮挡首屏正文（没有预留顶部留白）；
 *   - 横向溢出（某个元素宽度超过视口）；
 *   - 导航/正文重叠、正文被推到视口之外。
 *
 * 这些正是用户实际看到的「导航栏样式失效 / 排版错乱」，
 * 用真实浏览器量一次 boundingBox 就能确定性地抓住。
 *
 * 【设计取舍】
 * - **非阻断**：几何断言受字体加载/环境影响可能抖动，直接用于拒绝保存会误伤，
 *   因此结论只作为 warning 反馈给修订流程，不进 blocker 集合。
 * - **可选启用**：默认关闭（避免每次生成都启动浏览器带来的延迟与不稳定），
 *   设置环境变量 `THEME_VISUAL_CHECK=1` 开启。
 * - **优雅降级**：找不到可用浏览器时直接跳过并说明原因，不影响主流程。
 */

export interface VisualCheckResult {
  /** 是否真正执行了（false 表示被跳过） */
  ran: boolean
  /** 跳过原因 */
  skippedReason?: string
  /** 发现的问题（人类可读） */
  issues: string[]
}

/** 候选浏览器可执行文件路径（按优先级）。 */
function findChromiumExecutable(): string | null {
  const fromEnv = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  if (fromEnv && existsSync(fromEnv)) return fromEnv

  // 从当前目录逐级向上找 .browsers（monorepo 里层级不固定，硬编码 ../../ 会失效）
  const roots: string[] = []
  const fromBrowsersEnv = process.env.PLAYWRIGHT_BROWSERS_PATH
  if (fromBrowsersEnv) roots.push(fromBrowsersEnv)
  let dir = process.cwd()
  for (let i = 0; i < 5; i++) {
    roots.push(join(dir, ".browsers"))
    const parent = join(dir, "..")
    if (parent === dir) break
    dir = parent
  }

  for (const root of roots) {
    if (!existsSync(root)) continue
    // 目录形如 <root>/chromium-<版本>/chrome-win64/chrome.exe
    let entries: string[] = []
    try {
      entries = readdirSync(root)
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.startsWith("chromium")) continue
      for (const rel of [
        ["chrome-win64", "chrome.exe"],
        ["chrome-win", "chrome.exe"],
        ["chrome-linux", "chrome"],
      ]) {
        const p = join(root, entry, ...rel)
        if (existsSync(p)) return p
      }
    }
  }
  return null
}

/** 在浏览器里执行的页面内断言脚本。 */
const PAGE_ASSERTIONS = `() => {
  const out = []
  const vw = window.innerWidth
  const vh = window.innerHeight

  // 1. 横向溢出
  const scrollW = document.documentElement.scrollWidth
  if (scrollW > vw + 1) {
    out.push('页面出现横向溢出：scrollWidth=' + scrollW + ' > 视口宽度=' + vw)
  }

  // 2. 导航元素可见性（高度塌陷 = 样式失效）
  const navs = Array.from(document.querySelectorAll('nav, header'))
  for (const nav of navs) {
    const r = nav.getBoundingClientRect()
    const cs = getComputedStyle(nav)
    if (cs.display === 'none' || cs.visibility === 'hidden') continue
    if (r.height <= 0.5) {
      out.push('导航元素高度塌陷为 ' + r.height + 'px（' + (nav.className || nav.tagName) + '），样式可能已失效')
    }
  }

  // 3. 固定导航是否遮挡正文
  const fixedNav = navs.find(n => getComputedStyle(n).position === 'fixed')
  const host = document.querySelector('[data-page-host]')
  if (fixedNav && host) {
    const navRect = fixedNav.getBoundingClientRect()
    // 只检查顶部固定栏（横向通栏），忽略左侧竖排侧边栏
    const isTopBar = navRect.top <= 8 && navRect.width > vw * 0.6
    if (isTopBar) {
      const first = host.querySelector('section, article, main, header, p, h1')
      if (first) {
        const fr = first.getBoundingClientRect()
        if (fr.top < navRect.bottom - 1 && fr.height > 0) {
          out.push('固定导航遮挡了正文：导航底部 ' + Math.round(navRect.bottom) +
            'px，正文顶部 ' + Math.round(fr.top) + 'px（缺少顶部留白）')
        }
      }
    }
  }

  // 4. 导航留白变量是否解析成功
  //    --nav-h 是设计令牌，必须始终有值；
  //    --nav-clearance 只在存在「固定顶部导航」时才需要（侧边栏布局本就没有顶部留白）。
  const rootStyle = getComputedStyle(document.documentElement)
  if (rootStyle.getPropertyValue('--nav-h').trim() === '') {
    out.push('CSS 变量 --nav-h 未解析出值（未声明或声明无效）')
  }
  const hasFixedTopNav = navs.some(n => {
    const r = n.getBoundingClientRect()
    return getComputedStyle(n).position === 'fixed' &&
      r.top <= 8 && r.width > vw * 0.6 && r.height < vh * 0.5
  })
  if (hasFixedTopNav && rootStyle.getPropertyValue('--nav-clearance').trim() === '') {
    out.push('存在固定顶部导航，但 --nav-clearance 未解析出值（顶部留白将失效，正文会被导航遮挡）')
  }

  // 5. 正文区是否有零高度但有内容的容器
  if (host) {
    for (const el of Array.from(host.querySelectorAll('section, article, div'))) {
      const r = el.getBoundingClientRect()
      if (r.height <= 0.5 && (el.textContent || '').trim().length > 0) {
        out.push('正文区存在高度塌陷的容器：' + (el.className || el.tagName))
        break
      }
    }
  }

  return out
}`

/**
 * 对合并后的页面做几何验证。
 *
 * @param layoutHtml 共享布局 HTML
 * @param pages 页面类型 → 页面片段
 */
export async function runVisualCheck(
  layoutHtml: string,
  pages: Record<string, string> = {}
): Promise<VisualCheckResult> {
  if (process.env.THEME_VISUAL_CHECK !== "1") {
    return {
      ran: false,
      skippedReason: "未启用（设置 THEME_VISUAL_CHECK=1 开启）",
      issues: [],
    }
  }

  const executablePath = findChromiumExecutable()
  let chromium: typeof import("playwright").chromium
  try {
    ;({ chromium } = (await import("playwright")) as typeof import("playwright"))
  } catch {
    return {
      ran: false,
      skippedReason: "playwright 未安装，跳过几何验证",
      issues: [],
    }
  }

  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null
  try {
    browser = await chromium.launch({
      headless: true,
      ...(executablePath ? { executablePath } : {}),
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message.split("\n")[0] : "未知错误"
    return {
      ran: false,
      skippedReason: `浏览器启动失败，跳过几何验证：${msg}`,
      issues: [],
    }
  }

  const issues: string[] = []
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    for (const [type, html] of Object.entries(pages)) {
      if (!html) continue
      let merged: string
      try {
        merged = mergeThemePage(layoutHtml, html)
      } catch {
        continue
      }
      await page.setContent(merged, { waitUntil: "load" })
      // 等待运行时脚本（--nav-clearance 测量）执行完毕
      await page.waitForTimeout(120)
      // PAGE_ASSERTIONS 是函数字符串，需以 IIFE 形式调用
      const found = (await page.evaluate(`(${PAGE_ASSERTIONS})()`)) as string[]
      for (const f of found) issues.push(`[${type}] ${f}`)
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message.split("\n")[0] : "未知错误"
    issues.push(`几何验证执行异常：${msg}`)
  } finally {
    await browser.close().catch(() => {})
  }

  return { ran: true, issues }
}
