import { describe, it, expect } from "vitest"
import { checkThemeIntegrity } from "./theme-selfcheck"

const GOOD_LAYOUT = `<!DOCTYPE html><html><head><style>
:root { --nav-h: 64px; --bg: #f7f4ef; --main: #1a1a2e; --radius: 8px; }
body { background: var(--bg); color: var(--main); }
.container { max-width: 1080px; margin: 0 auto; }
.post-card { border: 1px solid #eee; border-radius: var(--radius); }
.article-list { display: grid; gap: 24px; }
</style></head><body>
<nav data-content="main-nav" data-content-type="nav-list"><a href="/blog">首页</a></nav>
<div data-page-host=""></div>
<footer>footer</footer>
</body></html>`

const GOOD_PAGE = `<section class="container">
  <div class="article-list" data-content="article-list" data-content-type="dynamic-articles">
    <article class="post-card"><h3 data-map="title">示例</h3></article>
  </div>
</section>`

describe("checkThemeIntegrity", () => {
  it("健康的骨架与页面通过自检", () => {
    const report = checkThemeIntegrity(GOOD_LAYOUT, { home: GOOD_PAGE })
    expect(report.ok).toBe(true)
    expect(report.blockers).toHaveLength(0)
  })

  it("布局缺少 <style> 判定为 blocker", () => {
    const layout = GOOD_LAYOUT.replace(/<style>[\s\S]*?<\/style>/, "")
    const report = checkThemeIntegrity(layout, {})
    expect(report.ok).toBe(false)
    expect(report.blockers.some((b) => b.message.includes("<style>"))).toBe(true)
  })

  it("CSS 引用未定义变量（无 fallback）判定为 blocker", () => {
    const layout = GOOD_LAYOUT.replace(
      "body { background: var(--bg); color: var(--main); }",
      "body { background: var(--bg); color: var(--not-defined); }"
    )
    const report = checkThemeIntegrity(layout, {})
    expect(report.ok).toBe(false)
    expect(
      report.blockers.some((b) => b.message.includes("--not-defined"))
    ).toBe(true)
  })

  it("带 fallback 的 var() 不算未定义变量", () => {
    const layout = GOOD_LAYOUT.replace(
      "body { background: var(--bg); color: var(--main); }",
      "body { background: var(--bg); padding-top: var(--nav-clearance, 0px); }"
    )
    const report = checkThemeIntegrity(layout, {})
    expect(
      report.blockers.some((b) => b.message.includes("--nav-clearance"))
    ).toBe(false)
  })

  it("未声明 --nav-h 判定为 blocker", () => {
    const layout = GOOD_LAYOUT.replace("--nav-h: 64px; ", "")
    const report = checkThemeIntegrity(layout, {})
    expect(report.ok).toBe(false)
    expect(report.blockers.some((b) => b.message.includes("--nav-h"))).toBe(true)
  })

  it("页面自带 nav/footer 判定为 blocker（重复 chrome）", () => {
    const page = `<nav class="site-nav"><a href="/blog">首页</a></nav>${GOOD_PAGE}`
    const report = checkThemeIntegrity(GOOD_LAYOUT, { home: page })
    expect(report.ok).toBe(false)
    expect(report.blockers.some((b) => b.message.includes("nav"))).toBe(true)
  })

  it("页面大面积使用骨架未定义类名判定为 blocker", () => {
    const page = `<section class="alien-a"><div class="alien-b"><span class="alien-c">x</span></div></section>`
    const report = checkThemeIntegrity(GOOD_LAYOUT, { home: page })
    expect(report.ok).toBe(false)
    expect(
      report.blockers.some((b) => b.message.includes("未定义的类名"))
    ).toBe(true)
  })

  it("桥接源类名不算未定义类名（避免假阳性）", () => {
    // .post-list 由映射目标 .article-list 提供样式
    const layout = GOOD_LAYOUT.replace(
      ".article-list { display: grid; gap: 24px; }",
      ".article-list { display: grid; gap: 24px; } .post-list { display: flex; }"
    )
    const page = `<div class="post-list article-list">列表</div>`
    const report = checkThemeIntegrity(layout, { home: page })
    expect(
      report.issues.some((i) => i.message.includes("未定义的类名"))
    ).toBe(false)
  })

  it("少量未定义类名只告警不阻断（交由修订流程处理）", () => {
    const page = `<section class="container"><span class="tiny-utility">x</span></section>`
    const report = checkThemeIntegrity(GOOD_LAYOUT, { home: page })
    expect(report.ok).toBe(true)
    expect(report.issues.some((i) => i.level === "warn")).toBe(true)
  })

  it("合并后出现多个 host 判定为 error（触发修订而非直接拒绝）", () => {
    // 片段根部的 host 会在合并时被剥离，这里构造的是「嵌套 host」
    const page = `<section class="container"><div data-page-host=""><p>x</p></div></section>`
    const report = checkThemeIntegrity(GOOD_LAYOUT, { home: page })
    expect(report.ok).toBe(true)
    expect(
      report.issues.some(
        (i) => i.level === "error" && i.message.includes("data-page-host")
      )
    ).toBe(true)
  })
})
