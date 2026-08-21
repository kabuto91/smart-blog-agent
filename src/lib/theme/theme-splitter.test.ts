import { describe, it, expect } from "vitest"
import {
  ensureLayoutContract,
  mergeThemePage,
  sanitizePageFragment,
  collectThemeClasses,
  validatePageFragment,
  normalizeThemeSpacing,
} from "@/lib/theme/theme-splitter"
import { injectPageIntoLayout } from "@/lib/theme/layout-inject"

const LAYOUT = `<!DOCTYPE html>
<html>
<head>
  <style>
    :root { --nav-h: 72px; --primary: #c0392b; }
    .container { max-width: 800px; margin: 0 auto; }
    .post-title { font-size: 2rem; }
    .article-list { display: grid; }
  </style>
</head>
<body>
  <nav data-content="main-nav"><a href="/blog">首页</a></nav>
  <div class="container"></div>
  <div data-page-host=""></div>
  <footer>footer</footer>
</body>
</html>`

const SPLIT_LAYOUT = `<!DOCTYPE html>
<html>
<head><style>.container{max-width:800px}.card{padding:8px}</style></head>
<body>
  <nav>nav</nav>
  <header>sub-header</header>
  <div data-page-host=""></div>
  <footer>footer</footer>
</body>
</html>`

describe("ensureLayoutContract", () => {
  it("补插缺失的 data-page-host 占位节点", () => {
    const hasHostRes = ensureLayoutContract(LAYOUT)
    const noHost = LAYOUT.replace("<div data-page-host=\"\"></div>", "")
    const fixed = ensureLayoutContract(noHost)
    expect(hasHostRes).toContain(`data-page-host=""`)
    expect(fixed).toContain(`data-page-host=""`)
    // 插入位置应在 footer 之前
    const fixedIdx = fixed.indexOf("data-page-host")
    const footerIdx = fixed.indexOf("<footer>")
    expect(fixedIdx).toBeGreaterThan(-1)
    expect(fixedIdx).toBeLessThan(footerIdx)
  })

  it("仅保留唯一占位节点", () => {
    const dup = LAYOUT.replace(
      '<div class="container"></div>',
      '<div data-page-host=""></div>'
    )
    const fixed = ensureLayoutContract(dup)
    const count = (fixed.match(/data-page-host/g) ?? []).length
    expect(count).toBe(1)
  })

  it("缺失 --nav-h 时注入默认声明", () => {
    const withoutVar = LAYOUT.replace("--nav-h: 72px;", "")
    const fixed = ensureLayoutContract(withoutVar)
    expect(fixed).toMatch(/:root\s*\{\s*--nav-h:\s*0px/)
  })

  it("注入幂等的运行时测量脚本", () => {
    const once = ensureLayoutContract(LAYOUT)
    const twice = ensureLayoutContract(once)
    expect(twice.match(/data-theme-nav-measure/g) ?? []).toHaveLength(1)
  })
})

describe("mergeThemePage / injectPageIntoLayout", () => {
  it("页面正文插入占位节点", () => {
    const merged = mergeThemePage(LAYOUT, '<div class="container">正文</div>')
    expect(merged).toContain("正文")
    expect(merged).toContain('class="container"')
  })

  it("占位缺失时在 footer 前补插（不丢正文）", () => {
    const noHost = LAYOUT.replace("<div data-page-host=\"\"></div>", "")
    const merged = mergeThemePage(noHost, "<p>内容</p>")
    expect(merged).toContain("内容")
    const pageIdx = merged.indexOf("内容")
    const footerIdx = merged.indexOf("<footer>")
    expect(pageIdx).toBeLessThan(footerIdx)
  })

  it("navClearance 应用 --nav-h 留白", () => {
    const merged = mergeThemePage(LAYOUT, "<p>x</p>", { navClearance: true })
    expect(merged).toContain("--nav-h")
  })

  it("injectPageIntoLayout 与 mergeThemePage 行为一致（占位缺失也不丢正文）", () => {
    const noHost = LAYOUT.replace("<div data-page-host=\"\"></div>", "")
    const merged = injectPageIntoLayout(noHost, "<p>注入</p>")
    expect(merged).toContain("注入")
    expect(merged.indexOf("注入")).toBeLessThan(merged.indexOf("<footer>"))
  })
})

describe("sanitizePageFragment", () => {
  it("剥离样式/脚本与完整文档包裹", () => {
    const raw = `<!DOCTYPE html>
<html><head><style>h1{color:red}</style></head>
<body>
  <h1 class="article-hero__title">标题</h1>
  <p class="article-main">正文</p>
  <script>alert(1)</script>
  <div class="back-to-top"></div>
</body></html>`
    const out = sanitizePageFragment(raw)
    expect(out).not.toContain("<style")
    expect(out).not.toContain("<script")
    expect(out).not.toContain("back-to-top")
    expect(out).not.toContain("<html")
    // 桥接：article-hero__title -> post-title，且删除原类
    expect(out).toContain('class="post-title"')
    expect(out).not.toContain("article-hero__title")
    // 映射即替换：article-main -> article-body
    expect(out).toContain('class="article-body"')
    expect(out).not.toContain("article-main")
  })

  it("保留未映射的类", () => {
    const out = sanitizePageFragment('<div class="unique-abc card">x</div>')
    expect(out).toContain("unique-abc")
    expect(out).toContain("card")
  })
})

describe("validatePageFragment", () => {
  const layoutClasses = collectThemeClasses(SPLIT_LAYOUT)

  it("合法片段通过校验", () => {
    const good = '<div class="card"><h2 class="container">标题</h2></div>'
    const res = validatePageFragment(good, layoutClasses)
    expect(res.issues).toHaveLength(0)
  })

  it("包含 style/nav/footer 时校验失败", () => {
    const badStyle =
      '<div class="card"><style>.card{color:red}</style></div>'
    expect(validatePageFragment(badStyle, layoutClasses).ok).toBe(false)

    const badNav = '<div class="card"><nav>nav</nav></div>'
    expect(validatePageFragment(badNav, layoutClasses).ok).toBe(false)
  })

  it("类名与骨架类库重叠率过低时校验失败", () => {
    const alien =
      '<div class="make-rich-body wow-anim"><div class="flash-grid"></div></div>'
    const res = validatePageFragment(alien, layoutClasses)
    expect(res.ok).toBe(false)
    expect(res.overlap).toBeLessThan(0.15)
  })
})

describe("normalizeThemeSpacing", () => {
  const layoutWithBigSpacing = `<!DOCTYPE html>
<html>
<head>
  <style>
    .section { padding-top: 72px; padding-bottom: 64px; }
    .hero { padding-top: 80px; padding-bottom: 56px; }
    footer { margin-top: 72px; }
    .post-grid { gap: 32px; }
    .compact { padding: 8px; margin: 4px; gap: 12px; }
  </style>
</head>
<body>
  <div data-page-host=""></div>
</body>
</html>`

  it("clamp section padding-top 超限值", () => {
    const result = normalizeThemeSpacing(layoutWithBigSpacing)
    expect(result).toMatch(/padding-top:\s*40px/)
    expect(result).not.toMatch(/padding-top:\s*72px/)
  })

  it("clamp section padding-bottom 超限值", () => {
    const result = normalizeThemeSpacing(layoutWithBigSpacing)
    expect(result).toMatch(/padding-bottom:\s*40px/)
    expect(result).not.toMatch(/padding-bottom:\s*64px/)
  })

  it("clamp hero padding 超限值", () => {
    const result = normalizeThemeSpacing(layoutWithBigSpacing)
    // hero 也是 section，padding-top:80px 应被 clamp 到 40px
    expect(result).not.toMatch(/padding-top:\s*80px/)
    expect(result).not.toMatch(/padding-bottom:\s*56px/)
  })

  it("clamp footer margin-top 超限值", () => {
    const result = normalizeThemeSpacing(layoutWithBigSpacing)
    expect(result).toMatch(/margin-top:\s*48px/)
    expect(result).not.toMatch(/margin-top:\s*72px/)
  })

  it("不修改未超限的值", () => {
    const result = normalizeThemeSpacing(layoutWithBigSpacing)
    // .compact 的 padding: 8px 不应被修改
    expect(result).toMatch(/padding:\s*8px/)
    expect(result).toMatch(/margin:\s*4px/)
    expect(result).toMatch(/gap:\s*12px/)
  })

  it("不修改非目标选择器的值", () => {
    const layout = `<!DOCTYPE html>
<html>
<head>
  <style>
    .card { padding: 72px; margin: 80px; gap: 40px; }
  </style>
</head>
<body><div data-page-host=""></div></body>
</html>`
    const result = normalizeThemeSpacing(layout)
    // .card 不是 section/hero/footer 选择器，不应被修改
    expect(result).toMatch(/padding:\s*72px/)
    expect(result).toMatch(/margin:\s*80px/)
    expect(result).toMatch(/gap:\s*40px/)
  })

  it("保留 rem/em/% 等非 px 单位不处理", () => {
    const layout = `<!DOCTYPE html>
<html>
<head>
  <style>
    .section { padding-top: 4rem; padding-bottom: 3em; gap: 5%; }
  </style>
</head>
<body><div data-page-host=""></div></body>
</html>`
    const result = normalizeThemeSpacing(layout)
    expect(result).toMatch(/padding-top:\s*4rem/)
    expect(result).toMatch(/padding-bottom:\s*3em/)
    expect(result).toMatch(/gap:\s*5%/)
  })
})