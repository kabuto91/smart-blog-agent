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
.post-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(280px,1fr)); gap:20px; align-items:stretch; }
.post-card { border:1px solid #eee; border-radius:var(--radius); transition:box-shadow .2s; display:flex; flex-direction:column; height:100%; }
.post-card:hover { box-shadow:0 4px 16px rgba(0,0,0,.12); }
.post-card__title { display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
.post-card__excerpt { display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
.post-card__tags { margin-top:auto; }
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

  it("少量自创类名（1~2 个）不触发修订，避免每次生成都无谓重来", () => {
    const report = analyzeSkeletonStyles(GOOD_SKELETON, { list: BAD_PAGE })
    expect(report.pageIssues.list).toBeUndefined()
  })

  it("大面积自创类名（≥3 且占比 ≥30%）→ 仍报 error", () => {
    const page = `<section class="alien-list"><h2 class="alien-title">标题</h2>
      <p class="alien-text alien-hint">内容</p></section>`
    const report = analyzeSkeletonStyles(GOOD_SKELETON, { list: page })
    expect(report.pageIssues.list).toBeDefined()
    expect(report.pageIssues.list[0]).toContain("alien-list")
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

  it("导航含头像且正文也放头像 → 新契约下不判重复", () => {
    const skeleton = `<!DOCTYPE html><html><head><style>:root{--nav-h:64px}</style></head><body>
      <nav><img class="avatar" data-content="author-avatar" src="" alt="nav"></nav>
      <div data-page-host=""></div></body></html>`
    const page = `<aside class="author-bio"><img class="avatar" data-content="author-avatar" src="" alt="bio"></aside>`
    const report = analyzeSkeletonStyles(skeleton, { home: page })
    // 导航头像（布局）与正文头像（页面）各自独立，只有正文区 >1 个才报错
    expect(report.pageIssues.home ?? []).toHaveLength(0)
  })

  it("正文仅 1 个作者头像、导航无头像 → 不报重复", () => {
    const page = `<section class="container"><img data-content="author-avatar" src="" alt="bio"></section>`
    const report = analyzeSkeletonStyles(GOOD_SKELETON, { home: page })
    expect(report.pageIssues.home ?? []).toHaveLength(0)
  })

  it("固定导航但未在 body 声明顶部留白 → 报遮挡 error", () => {
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
    // 现行契约：顶部留白由 --nav-clearance 承担（运行时实测固定导航高度后写入）
    expect(
      report.skeletonIssues.some((s) =>
        s.includes("padding-top:var(--nav-clearance")
      )
    ).toBe(true)
  })

  it("固定导航且已在 body 声明 var(--nav-clearance) 留白 → 不报遮挡", () => {
    const skeleton = `<!DOCTYPE html><html><head><style>
:root { --nav-h:64px; --bg:#f7f4ef; --main:#1a1a2e; --accent:#e5a83d; --radius:8px; }
body { padding-top: var(--nav-clearance, 0px); background:var(--bg); color:var(--main); }
.navbar { position: fixed; top:0; left:0; right:0; height:64px; }
</style></head><body>
<nav data-content="main-nav"><a href="/blog">首页</a></nav>
<div data-page-host=""></div>
</body></html>`
    const report = analyzeSkeletonStyles(skeleton)
    expect(report.skeletonIssues.some((s) => s.includes("遮挡"))).toBe(false)
  })

  it("固定导航且 body 声明了历史写法 var(--nav-h) 留白 → 同样不报遮挡", () => {
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

/** 满足其它审计项的基础 CSS，便于单独验证卡片一致性规则。 */
const CARD_BASE_CSS = `
:root { --nav-h:64px; --bg:#f7f4ef; --main:#1a1a2e; --accent:#e5a83d; --radius:8px; }
body { background:var(--bg); color:var(--main); font-family:Georgia,serif; transition:background .3s; }
.post-grid { display:grid; align-items:stretch; }
.post-card { display:flex; flex-direction:column; height:100%; }
.post-card__title { display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
.post-card__tags { margin-top:auto; }
.post-card:hover { color:var(--accent); box-shadow:0 4px 16px rgba(0,0,0,.12); }
@media(max-width:768px) { .post-grid{grid-template-columns:1fr} }
`

function cardSkeleton(extraCss: string): string {
  return `<!DOCTYPE html><html><head><style>${CARD_BASE_CSS}\n${extraCss}</style></head><body>
<nav data-content="main-nav"><a href="/blog">首页</a></nav>
<div data-page-host=""></div></body></html>`
}

describe("重复卡片一致性审计", () => {
  it("hover 只改颜色/阴影 → 不报布局问题", () => {
    const report = analyzeSkeletonStyles(cardSkeleton(""))
    expect(
      report.skeletonIssues.some((s) => s.includes("hover/focus"))
    ).toBe(false)
  })

  it("hover 放大标题字号 → 报 error（会造成文字重排）", () => {
    const report = analyzeSkeletonStyles(
      cardSkeleton(`.post-card:hover .post-card__title { font-size: 1.4em; color:#0ff; }`)
    )
    expect(
      report.skeletonIssues.some((s) => s.includes("hover/focus") && s.includes("font-size"))
    ).toBe(true)
  })

  it("hover 改内边距 → 报 error", () => {
    const report = analyzeSkeletonStyles(
      cardSkeleton(`.post-card:hover { padding: 24px; }`)
    )
    expect(report.skeletonIssues.some((s) => s.includes("padding"))).toBe(true)
  })

  it("hover 大幅上浮 translateY(-12px) → 报 error，小幅 -3px 放行", () => {
    const big = analyzeSkeletonStyles(
      cardSkeleton(`.post-card:hover { transform: translateY(-12px); }`)
    )
    expect(big.skeletonIssues.some((s) => s.includes("超过 4px"))).toBe(true)
    const small = analyzeSkeletonStyles(
      cardSkeleton(`.post-card:hover { transform: translateY(-3px); }`)
    )
    expect(small.skeletonIssues.some((s) => s.includes("超过 4px"))).toBe(false)
  })

  it("伪元素装饰（导航下划线展开）与卡片内缩略图 scale → 不误报", () => {
    const report = analyzeSkeletonStyles(
      cardSkeleton(`
.nav-links li a:hover::after { width: 100%; left: 0; }
.post-card:hover .post-thumb-inner { transform: scale(1.04); }
`)
    )
    expect(report.skeletonIssues.some((s) => s.includes("hover/focus"))).toBe(
      false
    )
  })

  it("用 :nth-child 给同类卡片设置不同字号/颜色 → 报 error", () => {
    const report = analyzeSkeletonStyles(
      cardSkeleton(`.post-card:nth-child(2n) .post-card__title { font-size: 1.3em; color:#0ff; }`)
    )
    expect(report.skeletonIssues.some((s) => s.includes("位置选择器"))).toBe(true)
  })

  it(":nth-child 只做装饰性伪元素几何纹理 → 放行", () => {
    const report = analyzeSkeletonStyles(
      cardSkeleton(`.post-card:nth-child(3n+1) .post-thumb::before { content:""; width:60px; height:60px; }`)
    )
    expect(report.skeletonIssues.some((s) => s.includes("位置选择器"))).toBe(false)
  })

  it("卡片缺等高/贴底/行数钳制 → warn 提示对齐稳定性", () => {
    const skeleton = `<!DOCTYPE html><html><head><style>
:root { --nav-h:64px; --bg:#f7f4ef; --main:#1a1a2e; --accent:#e5a83d; --radius:8px; }
body { background:var(--bg); color:var(--main); font-family:Georgia,serif; transition:background .3s; }
.post-card { border:1px solid #eee; }
</style></head><body><div data-page-host=""></div></body></html>`
    const report = analyzeSkeletonStyles(skeleton)
    expect(report.warnings.some((w) => w.includes("对齐稳定性不足"))).toBe(true)
  })

  it("卡片契约齐全（等高+贴底+clamp）→ 无该 warn", () => {
    const report = analyzeSkeletonStyles(cardSkeleton(""))
    expect(report.warnings.some((w) => w.includes("对齐稳定性不足"))).toBe(false)
  })
})

describe("正文区宽度与填充审计", () => {
  const widthBase = `
:root { --nav-h:64px; --bg:#f7f4ef; --main:#1a1a2e; --accent:#e5a83d; --radius:8px; }
body { background:var(--bg); color:var(--main); font-family:Georgia,serif; transition:background .3s; }
.post-card { display:flex; flex-direction:column; height:100%; }
.post-card__title { display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
.post-card__tags { margin-top:auto; }
.post-card:hover { color:var(--accent); box-shadow:0 4px 16px rgba(0,0,0,.12); }
@media(max-width:768px) { .wrap{padding:0 12px} }
`
  function widthSkeleton(extraCss: string): string {
    return `<!DOCTYPE html><html><head><style>${widthBase}\n${extraCss}</style></head><body>
<nav data-content="main-nav"><a href="/blog">首页</a></nav>
<div data-page-host=""></div></body></html>`
  }

  it("限宽容器只写 max-width 忘记居中 → error（右侧大片空白）", () => {
    const report = analyzeSkeletonStyles(
      widthSkeleton(`.wrap { max-width: 1200px; padding: 0 24px; }`)
    )
    expect(report.skeletonIssues.some((s) => s.includes("限宽容器未居中"))).toBe(
      true
    )
  })

  it("限宽容器带 margin-inline:auto / margin:0 auto → 不报错", () => {
    const a = analyzeSkeletonStyles(
      widthSkeleton(`.wrap { max-width: 1200px; margin-inline: auto; padding: 0 24px; }`)
    )
    expect(a.skeletonIssues.some((s) => s.includes("限宽容器未居中"))).toBe(false)
    const b = analyzeSkeletonStyles(
      widthSkeleton(`.wrap { max-width: 1200px; margin: 0 auto; padding: 0 24px; }`)
    )
    expect(b.skeletonIssues.some((s) => s.includes("限宽容器未居中"))).toBe(false)
  })

  it("theme-safety 的 max-width:100% 兜底不被误判为限宽", () => {
    const report = analyzeSkeletonStyles(
      widthSkeleton(`:where([data-page-host]) { box-sizing:border-box; max-width: 100%; }`)
    )
    expect(report.skeletonIssues.some((s) => s.includes("限宽容器未居中"))).toBe(
      false
    )
  })

  it("给 [data-page-host] 自身设百分比宽度 → error", () => {
    const report = analyzeSkeletonStyles(
      widthSkeleton(`[data-page-host] { width: 65%; }`)
    )
    expect(
      report.skeletonIssues.some((s) => s.includes("[data-page-host] 被设置"))
    ).toBe(true)
  })

  it("左侧导航布局只写 margin-left → 不误报", () => {
    const report = analyzeSkeletonStyles(
      widthSkeleton(`[data-page-host] { margin-left: 240px; min-height:100vh; }`)
    )
    expect(
      report.skeletonIssues.some((s) => s.includes("[data-page-host] 被设置"))
    ).toBe(false)
  })

  it("文章网格写死 repeat(2, 1fr) → warn 建议自适应列数", () => {
    const report = analyzeSkeletonStyles(
      widthSkeleton(`.post-grid { display:grid; grid-template-columns: repeat(2, 1fr); gap:20px; }`)
    )
    expect(report.warnings.some((w) => w.includes("固定列数"))).toBe(true)
  })

  it("文章网格用 auto-fill → 无该 warn", () => {
    const report = analyzeSkeletonStyles(
      widthSkeleton(`.post-grid { display:grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap:20px; }`)
    )
    expect(report.warnings.some((w) => w.includes("固定列数"))).toBe(false)
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

describe("头像占位与固定列网格审计", () => {
  const AVATAR_DIV = `<div class="avatar" data-content="author-avatar" data-content-type="text"></div>`
  const AVATAR_IMG = `<img class="avatar" data-content="author-avatar" data-content-type="text" src="" alt="作者头像">`

  it("div 头像 text 字段报 error（URL 会被当文本显示）", () => {
    const report = analyzeSkeletonStyles(GOOD_SKELETON, { list: AVATAR_DIV })
    expect(report.pageIssues.list?.join(" ")).toContain("作者头像占位")
  })

  it("img 头像不报该 error", () => {
    const report = analyzeSkeletonStyles(GOOD_SKELETON, { list: AVATAR_IMG })
    expect(report.pageIssues.list?.join(" ") ?? "").not.toContain("作者头像占位")
  })

  it("固定 3 列网格放 4 个子项时给 warn", () => {
    const skeleton = GOOD_SKELETON.replace(
      ".post-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(280px,1fr)); gap:20px; align-items:stretch; }",
      ".stat-strip { display:grid; grid-template-columns:repeat(3, 1fr); gap:1px; }"
    )
    const page = `<div class="stat-strip"><div>1</div><div>2</div><div>3</div><div>4</div></div>`
    const report = analyzeSkeletonStyles(skeleton, { list: page })
    expect(report.warnings.join(" ")).toContain("写死 3 列")
  })
})
