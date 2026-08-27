import { describe, it, expect } from "vitest"
import {
  analyzeSkeletonStyles,
  extractCssFromLayout,
  stripStyleTags,
  collectElementClasses,
} from "./style-analyzer"

const GOOD_SKELETON = `<!DOCTYPE html><html><head><style>
:root { --nav-h:64px; --bg:#f7f4ef; --main:#1a1a2e; --accent:#e5a83d; --radius:8px; }
body { background:var(--bg); color:var(--main); font-family:"Noto Serif SC",Georgia,serif; transition:background .3s; }
.container { max-width:1080px; margin:0 auto; }
.post-card { border:1px solid #eee; border-radius:var(--radius); transition:box-shadow .2s; }
.post-card:hover { box-shadow:0 4px 16px rgba(0,0,0,.12); }
.section-title { font-size:28px; }
.page-title { font-size:32px; }
@media(max-width:768px) { .container{padding:0 16px} }
</style></head><body>
<nav data-content="main-nav"><a href="/blog" class="nav-link">首页</a></nav>
<div data-page-host=""></div>
<footer></footer>
</body></html>`

const BAD_SKELETON_WHITE = `<!DOCTYPE html><html><head><style>
:root { --nav-h:64px; }
body { background:#fff; color:#333; }
</style></head><body><div data-page-host=""></div></body></html>`

const BAD_SKELETON_NO_ANIM = `<!DOCTYPE html><html><head><style>
:root { --nav-h:64px; --bg:#f7f4ef; --main:#1a1a2e; --accent:#e5a83d; --radius:8px; }
body { background:var(--bg); color:var(--main); font-family:Georgia,serif; }
</style></head><body><div data-page-host=""></div></body></html>`

const BAD_SKELETON_NO_STYLE = `<!DOCTYPE html><html><head></head><body><div data-page-host=""></div></body></html>`

const GOOD_PAGE = `<section class="container post-card">
  <h2 class="section-title">标题</h2>
</section>`

const BAD_PAGE = `<section class="alien-list">
  <h2 class="alien-title">标题</h2>
</section>`

describe("analyzeSkeletonStyles", () => {
  it("好骨架：背景非纯白、有动效、有 hover、有 @media、有字体特色、变量足够", () => {
    const report = analyzeSkeletonStyles(GOOD_SKELETON, { home: GOOD_PAGE })
    expect(report.skeletonIssues).toHaveLength(0)
    expect(report.warnings).toHaveLength(0)
    expect(Object.keys(report.pageIssues)).toHaveLength(0)
  })

  it("好骨架无页面：不报页面问题", () => {
    const report = analyzeSkeletonStyles(GOOD_SKELETON)
    expect(report.skeletonIssues).toHaveLength(0)
    expect(report.pageIssues).toEqual({})
  })

  it("背景纯白 + 无纹理 → error", () => {
    const report = analyzeSkeletonStyles(BAD_SKELETON_WHITE)
    expect(report.skeletonIssues.some((s) => s.includes("纯白"))).toBe(true)
  })

  it("无动效 → error", () => {
    const report = analyzeSkeletonStyles(BAD_SKELETON_NO_ANIM)
    expect(report.skeletonIssues.some((s) => s.includes("动效"))).toBe(true)
  })

  it("无样式 → error", () => {
    const report = analyzeSkeletonStyles(BAD_SKELETON_NO_STYLE)
    expect(report.skeletonIssues.some((s) => s.includes("未包含"))).toBe(true)
  })

  it("页面自创类名不在骨架中 → error", () => {
    const report = analyzeSkeletonStyles(GOOD_SKELETON, { list: BAD_PAGE })
    expect(report.pageIssues.list).toBeDefined()
    expect(report.pageIssues.list[0]).toContain("alien-list")
    expect(report.pageIssues.list[0]).toContain("alien-title")
  })

  it("页面使用骨架类名 → 不报页面问题", () => {
    const report = analyzeSkeletonStyles(GOOD_SKELETON, { home: GOOD_PAGE })
    expect(Object.keys(report.pageIssues)).toHaveLength(0)
  })

  it("页面正文出现 2 个作者头像 → 报重复头像 error", () => {
    const page = `<section class="hero"><img class="avatar" data-content="author-avatar" src="" alt="hero"></section>
      <aside class="author-bio"><img class="avatar" data-content="author-avatar" src="" alt="bio"></aside>`
    const report = analyzeSkeletonStyles(GOOD_SKELETON, { home: page })
    expect(report.pageIssues.home).toBeDefined()
    expect(
      report.pageIssues.home.some((s) => s.includes("作者头像") && s.includes("重复"))
    ).toBe(true)
  })

  it("导航含头像且正文又放头像 → 报同页重复 error", () => {
    const skeleton = `<!DOCTYPE html><html><head><style>:root{--nav-h:64px}</style></head><body>
      <nav><img class="avatar" data-content="author-avatar" src="" alt="nav"></nav>
      <div data-page-host=""></div></body></html>`
    const page = `<aside class="author-bio"><img class="avatar" data-content="author-avatar" src="" alt="bio"></aside>`
    const report = analyzeSkeletonStyles(skeleton, { home: page })
    expect(report.pageIssues.home).toBeDefined()
    expect(
      report.pageIssues.home.some((s) => s.includes("导航已含作者头像"))
    ).toBe(true)
  })

  it("正文仅 1 个作者头像、导航无头像 → 不报重复", () => {
    const page = `<section class="container"><img data-content="author-avatar" src="" alt="bio"></section>`
    const report = analyzeSkeletonStyles(GOOD_SKELETON, { home: page })
    expect(report.pageIssues.home ?? []).toHaveLength(0)
  })

  it("固定导航但未在 body 声明 var(--nav-h) 留白 → 报遮挡 error", () => {
    const skeleton = `<!DOCTYPE html><html><head><style>
:root { --nav-h:64px; --bg:#f7f4ef; --main:#1a1a2e; --accent:#e5a83d; --radius:8px; }
body { background:var(--bg); color:var(--main); }
.navbar { position: fixed; top:0; left:0; right:0; height:64px; }
</style></head><body>
<nav data-content="main-nav"><a href="/blog">首页</a></nav>
<div data-page-host=""></div>
</body></html>`
    const report = analyzeSkeletonStyles(skeleton)
    expect(report.skeletonIssues.some((s) => s.includes("遮挡"))).toBe(true)
    expect(
      report.skeletonIssues.some((s) =>
        s.includes("padding-top:var(--nav-h)")
      )
    ).toBe(true)
  })

  it("固定导航且已在 body 声明 var(--nav-h) 留白 → 不报遮挡", () => {
    const skeleton = `<!DOCTYPE html><html><head><style>
:root { --nav-h:64px; --bg:#f7f4ef; --main:#1a1a2e; --accent:#e5a83d; --radius:8px; }
body { padding-top: var(--nav-h); background:var(--bg); color:var(--main); }
.navbar { position: fixed; top:0; left:0; right:0; height:64px; }
</style></head><body>
<nav data-content="main-nav"><a href="/blog">首页</a></nav>
<div data-page-host=""></div>
</body></html>`
    const report = analyzeSkeletonStyles(skeleton)
    expect(report.skeletonIssues.some((s) => s.includes("遮挡"))).toBe(false)
  })

  it("静态导航（无 position:fixed）→ 不报遮挡", () => {
    const report = analyzeSkeletonStyles(GOOD_SKELETON)
    expect(report.skeletonIssues.some((s) => s.includes("遮挡"))).toBe(false)
  })
})

describe("extractCssFromLayout", () => {
  it("提取所有 <style> 内容", () => {
    const css = extractCssFromLayout(GOOD_SKELETON)
    expect(css).toContain("--nav-h")
    expect(css).toContain("body")
  })

  it("无 <style> 返回空串", () => {
    const css = extractCssFromLayout(BAD_SKELETON_NO_STYLE)
    expect(css).toBe("")
  })
})

describe("stripStyleTags", () => {
  it("去掉 <style> 块", () => {
    const result = stripStyleTags(GOOD_SKELETON)
    expect(result).not.toContain("<style")
    expect(result).toContain("<body")
  })
})

describe("collectElementClasses", () => {
  it("收集元素 class", () => {
    const classes = collectElementClasses(`<div class="a b"><span class="c"></span></div>`)
    expect(classes.has("a")).toBe(true)
    expect(classes.has("b")).toBe(true)
    expect(classes.has("c")).toBe(true)
    expect(classes.size).toBe(3)
  })

  it("空 class 属性不影响", () => {
    const classes = collectElementClasses(`<div class="  x  "></div>`)
    expect(classes.has("x")).toBe(true)
    expect(classes.size).toBe(1)
  })
})
