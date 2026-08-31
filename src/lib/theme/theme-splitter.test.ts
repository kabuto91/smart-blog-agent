import { describe, it, expect } from "vitest"
import { JSDOM } from "jsdom"
import {
  ensureLayoutContract,
  mergeThemePage,
  sanitizePageFragment,
  collectThemeClasses,
  validatePageFragment,
  normalizeThemeSpacing,
} from "@/lib/theme/theme-splitter"
import { injectPageIntoLayout, stripRedundantFragmentWrappers } from "@/lib/theme/layout-inject"

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
    // 安全兜底样式层里会引用 [data-page-host] 选择器，因此用 DOM 统计带该属性的元素而非子串。
    const dom = new JSDOM(fixed)
    const count = dom.window.document.querySelectorAll(
      '[data-page-host]'
    ).length
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

  it("旧版测量脚本被替换升级为遍历候选版本", () => {
    // 模拟历史版本：只取第一个匹配元素检查 fixed 的旧脚本
    const legacy = LAYOUT.replace(
      "</body>",
      `<script data-theme-nav-measure="">(function(){var sync=function(){var nav=document.querySelector('nav[data-content="main-nav"]')||document.querySelector('nav')||document.querySelector('header');var h=0;if(nav&&window.getComputedStyle(nav).position==='fixed'){h=nav.getBoundingClientRect().height;}document.documentElement.style.setProperty('--nav-h',h+'px');};sync();})();</script></body>`
    )
    const fixed = ensureLayoutContract(legacy)
    // 新版：遍历所有候选元素取第一个 fixed
    expect(fixed).toContain("querySelectorAll('nav[data-content=\"main-nav\"], nav, header')")
    // 旧版短路特征不再存在
    expect(fixed).not.toContain("||document.querySelector('nav')")
    // 仍只有一个脚本实例
    expect(fixed.match(/data-theme-nav-measure/g) ?? []).toHaveLength(1)
  })

  it("安全层幂等且旧版被替换升级（不产生重复 style）", () => {
    // 模拟历史版本：含旧的（特异性过高的）安全层
    const legacy = LAYOUT.replace(
      "</head>",
      `<style data-theme-safety="">[data-page-host] > * { max-width: 100%; }</style></head>`
    )
    const once = ensureLayoutContract(legacy)
    const twice = ensureLayoutContract(once)
    for (const html of [once, twice]) {
      const dom = new JSDOM(html)
      const styles = dom.window.document.querySelectorAll(
        "style[data-theme-safety]"
      )
      expect(styles.length).toBe(1)
      expect(styles[0].textContent).toContain(":where(")
    }
    // 升级后不应再残留旧版的高特异性规则
    expect(once).not.toMatch(
      /<style data-theme-safety="">\[data-page-host\] > \*/
    )
  })

  it("安全层容器子项选择器使用 :where() 以免覆盖设计系统限宽", () => {
    const fixed = ensureLayoutContract(LAYOUT)
    expect(fixed).toContain(":where([data-page-host] > *")
    // 不应再出现未降特异性的容器子项规则
    expect(fixed).not.toMatch(/^\[data-page-host\] > \*/m)
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
    expect(merged).toContain('style="padding-top: var(--nav-h, 0px);"')
  })

  it("首页场景（无 navClearance）也统一补 host 留白，避免被固定导航遮挡", () => {
    const merged = mergeThemePage(LAYOUT, "<p>x</p>")
    expect(merged).toContain('style="padding-top: var(--nav-h, 0px);"')
  })

  it("布局已有 body 级 var(--nav-h) 留白时不再叠加 host 留白", () => {
    const withBodyClearance = LAYOUT.replace(
      ".container { max-width: 800px; margin: 0 auto; }",
      "body { padding-top: var(--nav-h); } .container { max-width: 800px; margin: 0 auto; }"
    )
    const merged = mergeThemePage(withBodyClearance, "<p>x</p>", {
      navClearance: true,
    })
    expect(merged).not.toContain('style="padding-top: var(--nav-h')
    // 未开启 navClearance 的既有行为不受影响
    const plain = mergeThemePage(withBodyClearance, "<p>x</p>")
    expect(plain).not.toContain('style="padding-top: var(--nav-h')
  })

  it("injectPageIntoLayout 与 mergeThemePage 行为一致（占位缺失也不丢正文）", () => {
    const noHost = LAYOUT.replace("<div data-page-host=\"\"></div>", "")
    const merged = injectPageIntoLayout(noHost, "<p>注入</p>")
    expect(merged).toContain("注入")
    expect(merged.indexOf("注入")).toBeLessThan(merged.indexOf("<footer>"))
  })
})

describe("stripRedundantFragmentWrappers", () => {
  it("剥离线外层 data-page-host 与嵌套的 page-content 包裹（列表/详情形态）", () => {
    const frag = `<div data-page-host="">
  <div class="page-content">
    <div class="container"><h1>标题</h1><p>正文</p></div>
  </div>
</div>`
    const out = stripRedundantFragmentWrappers(frag)
    expect(out).not.toContain("data-page-host")
    expect(out).not.toContain('class="page-content"')
    expect(out).toContain('class="container"')
    // 内容保留
    expect(out).toContain("<h1>标题</h1>")
    // 结构应变为 container 直接作为根
    expect(out.startsWith('<div class="container">')).toBe(true)
  })

  it("剥离 <main class=\"page-content\" data-page-host> 首页形态", () => {
    const frag = `<main class="page-content" data-page-host="">
  <section class="hero"><h1>首页标题</h1></section>
  <div class="container"><p>列表</p></div>
</main>`
    const out = stripRedundantFragmentWrappers(frag)
    expect(out).not.toContain("data-page-host")
    expect(out).not.toContain('class="page-content"')
    expect(out).toContain('class="hero"')
    expect(out).toContain("<h1>首页标题</h1>")
  })

  it("无冗余包裹的普通片段保持不变", () => {
    const frag = '<div class="container"><p>保持</p></div>'
    expect(stripRedundantFragmentWrappers(frag)).toBe(frag)
  })

  it("保留片段内部合法的 page-content 子容器（不误伤）", () => {
    const frag = '<div class="container"><div class="page-content">x</div></div>'
    expect(stripRedundantFragmentWrappers(frag)).toBe(frag)
  })

  it("注入时剥离冗余包裹，避免侧边栏偏移翻倍", () => {
    const frag = `<div data-page-host=""><div class="page-content"><div class="container">正文</div></div></div>`
    const merged = injectPageIntoLayout(LAYOUT, frag)
    expect(merged).toContain("正文")
    // host 内不应再出现嵌套的 page-content 根包裹
    const host = new JSDOM(merged).window.document.querySelector(
      "[data-page-host]"
    )
    expect(host?.querySelector(":scope > .page-content")).toBeNull()
    expect(host?.querySelector(":scope > div[data-page-host]")).toBeNull()
    expect(host?.querySelector(":scope > .container")?.textContent).toContain(
      "正文"
    )
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

  it("多处标题/段落未标记 data-content 时校验失败", () => {
    const html = `<div class="card"><section class="container">
      <article class="post-card"><h3 class="post-title">卡片一</h3><p class="post-card-excerpt">摘要一</p></article>
      <article class="post-card"><h3 class="post-title">卡片二</h3><p class="post-card-excerpt">摘要二</p></article>
    </section></div>`
    const res = validatePageFragment(html, layoutClasses)
    expect(res.ok).toBe(false)
    expect(res.issues.join("\n")).toContain("未标记 data-content")
  })

  it("文本被 data-content 祖先覆盖时不误报", () => {
    const html = `<div class="card">
      <h2 class="container" data-content="t" data-content-type="text">标题</h2>
      <p class="container" data-content="d" data-content-type="text">描述</p>
    </div>`
    const res = validatePageFragment(html, layoutClasses)
    expect(res.issues.join("\n")).not.toContain("未标记 data-content")
  })
})

describe("detectUnmarkedArticleList（经 validatePageFragment）", () => {
  const layoutClasses = collectThemeClasses(SPLIT_LAYOUT)

  it("重复文章卡片未标记动态列表时校验失败", () => {
    const html = `<section class="container">
      <article class="post-card"><h2 data-content="t1" data-content-type="text">标题一</h2><a href="/blog/a"></a></article>
      <article class="post-card"><h2 data-content="t2" data-content-type="text">标题二</h2><a href="/blog/b"></a></article>
    </section>`
    const res = validatePageFragment(html, layoutClasses)
    expect(res.ok).toBe(false)
    expect(res.issues.join("\n")).toContain("未标记为动态文章列表")
  })

  it("已标记 dynamic-articles 的列表不误报", () => {
    const html = `<section class="container" data-content="article-list" data-content-type="dynamic-articles">
      <article class="post-card" data-map="title">模板标题<a href="/blog/a"></a></article>
    </section>`
    const res = validatePageFragment(html, layoutClasses)
    expect(res.ok).toBe(true)
    expect(res.issues.join("\n")).not.toContain("未标记为动态文章列表")
  })

  it("仅单个含链接卡片不误报", () => {
    const html = `<section class="container">
      <article class="post-card" data-content="t" data-content-type="text">标题<a href="/blog/a"></a></article>
    </section>`
    const res = validatePageFragment(html, layoutClasses)
    expect(res.issues.join("\n")).not.toContain("未标记为动态文章列表")
  })

  it("导航内的链接项不误报", () => {
    const html = `<div class="container"><nav>
      <a href="/blog/a">文章甲</a><a href="/blog/b">文章乙</a>
    </nav></div>`
    const res = validatePageFragment(html, layoutClasses)
    // 避免被当作未标记文本/文章卡片簇误报
    expect(res.issues.join("\n")).not.toContain("未标记为动态文章列表")
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
    expect(result).toMatch(/padding-top:\s*60px/)
    expect(result).not.toMatch(/padding-top:\s*72px/)
  })

  it("clamp section padding-bottom 超限值", () => {
    const result = normalizeThemeSpacing(layoutWithBigSpacing)
    expect(result).toMatch(/padding-bottom:\s*60px/)
    expect(result).not.toMatch(/padding-bottom:\s*64px/)
  })

  it("hero 区块用放宽上限，大留白不被削平", () => {
    const result = normalizeThemeSpacing(layoutWithBigSpacing)
    // hero 用放宽上限（padding ≤120px），80px 属于合法大留白，保留
    expect(result).toMatch(/padding-top:\s*80px/)
    expect(result).toMatch(/padding-bottom:\s*56px/)
  })

  it("hero 区块超放宽上限仍被 clamp", () => {
    const layout = `<!DOCTYPE html>
<html>
<head>
  <style>
    .hero { padding-top: 200px; padding-bottom: 140px; margin-top: 128px; gap: 64px; }
  </style>
</head>
<body><div data-page-host=""></div></body>
</html>`
    const result = normalizeThemeSpacing(layout)
    expect(result).toMatch(/padding-top:\s*120px/)
    expect(result).toMatch(/padding-bottom:\s*120px/)
    expect(result).toMatch(/margin-top:\s*96px/)
    expect(result).toMatch(/gap:\s*48px/)
  })

  it("hero 内超大展示标题保留，全局超大标题仍被 clamp", () => {
    const layout = `<!DOCTYPE html>
<html>
<head>
  <style>
    .hero h1 { font-size: 72px; }
    .banner h2 { font-size: 48px; }
    h1 { font-size: 72px; }
    section h1 { font-size: 60px; }
  </style>
</head>
<body><div data-page-host=""></div></body>
</html>`
    const result = normalizeThemeSpacing(layout)
    // hero 上下文内 h1 ≤80 / h2 ≤56：72px、48px 保留
    expect(result).toMatch(/\.hero h1\s*\{\s*font-size:\s*72px/)
    expect(result).toMatch(/\.banner h2\s*\{\s*font-size:\s*48px/)
    // 全局 h1 ≤56：72px、60px 均 clamp
    expect(result).toMatch(/^\s*h1\s*\{\s*font-size:\s*56px/m)
    expect(result).toMatch(/section h1\s*\{\s*font-size:\s*56px/)
  })

  it("clamp footer margin-top 超限值", () => {
    const result = normalizeThemeSpacing(layoutWithBigSpacing)
    expect(result).toMatch(/margin-top:\s*64px/)
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