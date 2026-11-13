import { describe, it, expect } from "vitest"
import { JSDOM } from "jsdom"
import {
  ensureLayoutContract,
  mergeThemePage,
  sanitizePageFragment,
  createSanitizeReport,
  collectThemeClasses,
  validatePageFragment,
  normalizeThemeSpacing,
} from "./theme-splitter"
import { injectPageIntoLayout, stripRedundantFragmentWrappers } from "./layout-inject"
import {
  hasBodyNavClearance,
  hasBodyTopClearance,
  normalizeNavClearanceCss,
} from "./nav-clearance"

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

  it("限宽容器漏写居中 → 安全层补齐，避免宽屏右侧大片留白", () => {
    const uncentered = LAYOUT.replace(
      ".container { max-width: 800px; margin: 0 auto; }",
      ".container { max-width: 1200px; margin: 0; }"
    )
    const out = ensureLayoutContract(uncentered)
    expect(out).toContain("margin-inline: auto !important")
  })

  it("限宽容器已正确居中 → 不追加 !important，不覆盖设计系统", () => {
    const out = ensureLayoutContract(LAYOUT)
    expect(out).not.toContain("margin-inline: auto !important")
  })
})

describe("导航留白契约（--nav-h / --nav-clearance 分离）", () => {
  it("测量脚本只写 --nav-clearance，绝不改写设计令牌 --nav-h", () => {
    const fixed = ensureLayoutContract(LAYOUT)
    const script = fixed.match(
      /<script data-theme-nav-measure="">([\s\S]*?)<\/script>/
    )?.[1]
    expect(script).toBeTruthy()
    expect(script).toContain("--nav-clearance")
    expect(script).not.toContain("--nav-h")
    // 明确断言：没有任何对 --nav-h 的写操作
    expect(script).not.toMatch(/setProperty\(\s*['"]--nav-h/)
    expect(script).not.toMatch(/removeProperty\(\s*['"]--nav-h/)
  })

  it("body 的 var(--nav-h) 顶部留白归一为 var(--nav-clearance, 0px)", () => {
    const fixed = ensureLayoutContract(
      LAYOUT.replace(
        ":root { --nav-h: 72px; --primary: #c0392b; }",
        ":root { --nav-h: 72px; --primary: #c0392b; } body { padding-top: var(--nav-h); }"
      )
    )
    expect(fixed).toContain("padding-top: var(--nav-clearance, 0px)")
    expect(fixed).not.toContain("padding-top: var(--nav-h)")
    // 设计令牌本身必须保留（骨架还要用它做 sticky 偏移等计算）
    expect(fixed).toContain("--nav-h: 72px")
  })

  it("归一化只作用于 body/html 的顶部留白，其它选择器里的 --nav-h 不变", () => {
    const css = `.sidebar { top: calc(var(--nav-h) + 16px); } body { padding-top: var(--nav-h); }`
    const out = normalizeNavClearanceCss(css)
    expect(out).toContain(".sidebar { top: calc(var(--nav-h) + 16px); }")
    expect(out).toContain("body { padding-top: var(--nav-clearance, 0px); }")
  })

  it("body 已有顶部留白时不再叠加 host 留白（避免双重间距）", () => {
    expect(hasBodyTopClearance(`body { padding-top: var(--nav-clearance, 0px); }`)).toBe(true)
    expect(hasBodyTopClearance(`body { padding-top: var(--nav-h); }`)).toBe(true)
    expect(hasBodyTopClearance(`.a { padding-top: var(--nav-h); }`)).toBe(false)
    expect(hasBodyTopClearance(`body { padding-top: 40px; }`)).toBe(false)
  })

  it("服务端与客户端预览对留白的判定口径一致", () => {
    const html = `<html><head><style>body{margin-top:var(--nav-h)}</style></head><body></body></html>`
    // margin-top 也算顶部留白（两端一致，不再分叉）
    expect(hasBodyNavClearance(html)).toBe(true)
    expect(hasBodyTopClearance(`body{margin-top:var(--nav-h)}`)).toBe(true)
  })
})

describe("安全兜底层不覆盖骨架设计（低特异性）", () => {
  it("不再声明 img { height: auto }（会压掉骨架封面高度）", () => {
    const fixed = ensureLayoutContract(LAYOUT)
    expect(fixed).not.toMatch(/\[data-page-host\]\s+img\s*\{[^}]*height:\s*auto/)
  })

  it("文本换行用 break-word 而非 anywhere（不改 flex/grid 的 min-content 尺寸）", () => {
    const fixed = ensureLayoutContract(LAYOUT)
    expect(fixed).not.toContain("overflow-wrap: anywhere")
    expect(fixed).toContain("overflow-wrap: break-word")
  })

  it("兜底规则全部经 :where() 降特异性，骨架设计系统优先", () => {
    const fixed = ensureLayoutContract(LAYOUT)
    const safety = new JSDOM(fixed).window.document.querySelector(
      "style[data-theme-safety]"
    )?.textContent
    expect(safety).toBeTruthy()
    // 去掉注释后，逐条规则的选择器都必须以 :where( 开头
    const withoutComments = (safety ?? "").replace(/\/\*[\s\S]*?\*\//g, "")
    const selectors = Array.from(
      withoutComments.matchAll(/([^{}]+)\{/g)
    ).map((m) => m[1].trim())
    expect(selectors.length).toBeGreaterThan(0)
    for (const sel of selectors) {
      expect(sel.startsWith(":where(")).toBe(true)
    }
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

  it("navClearance 应用 --nav-clearance 留白", () => {
    const merged = mergeThemePage(LAYOUT, "<p>x</p>", { navClearance: true })
    expect(merged).toContain('style="padding-top: var(--nav-clearance, 0px);"')
  })

  it("首页场景（无 navClearance）也统一补 host 留白，避免被固定导航遮挡", () => {
    const merged = mergeThemePage(LAYOUT, "<p>x</p>")
    expect(merged).toContain('style="padding-top: var(--nav-clearance, 0px);"')
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
    expect(merged).not.toContain('style="padding-top: var(--nav-clearance')
    // 未开启 navClearance 的既有行为不受影响
    const plain = mergeThemePage(withBodyClearance, "<p>x</p>")
    expect(plain).not.toContain('style="padding-top: var(--nav-h')
    expect(plain).not.toContain('style="padding-top: var(--nav-clearance')
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
    // 追加式桥接：保留原类名 + 追加骨架设计系统类
    expect(out).toContain('class="article-hero__title post-title"')
    expect(out).toContain('class="article-main article-body"')
  })

  it("追加式桥接不会丢弃页面自身的类名（排版不被改写）", () => {
    const layoutClasses = new Set(["article-list", "article-body"])
    const out = sanitizePageFragment(
      '<div class="post-list">列表</div>',
      layoutClasses
    )
    // 原类名保留（纵向流不被改成网格），同时补上骨架类
    expect(out).toContain('class="post-list article-list"')
    expect(out).not.toContain('class="article-list"')
  })

  it("桥接命中情况通过 SanitizeReport 回传（观察用）", () => {
    const layoutClasses = new Set(["article-list"])
    const report = createSanitizeReport()
    sanitizePageFragment(
      '<div class="post-list">列表</div><script>x</script>',
      layoutClasses,
      report
    )
    expect(report.bridges).toEqual({ "post-list": "article-list" })
    expect(report.removedTags).toContain("script")
  })

  it("保留未映射的类", () => {
    const out = sanitizePageFragment('<div class="unique-abc card">x</div>')
    expect(out).toContain("unique-abc")
    expect(out).toContain("card")
  })

  it("侧边栏时间锚点归档条目标题不被桥接成 page-title", () => {
    const raw = `<ul class="archive-list">
  <li class="archive-item">
    <span class="archive-date">2024.05</span>
    <a href="#" class="archive-title">五月跃迁记录</a>
  </li>
</ul>
<h1 class="archive-title">全部文章</h1>`
    const out = sanitizePageFragment(raw)
    // 列表项内的 archive-title 保留原类
    expect(out).toContain('class="archive-title">五月跃迁记录')
    // 页面级归档标题追加 page-title（保留原类）
    expect(out).toContain('class="archive-title page-title">全部文章')
  })
})

describe("sanitizePageFragment 强制剥离站点 chrome", () => {
  it("剥离页面自带的 nav / footer / 站点级 header", () => {
    const raw = `<header class="site-head">站点页头</header>
<nav class="site-nav"><a href="/blog">首页</a></nav>
<main class="container"><p>正文</p></main>
<footer class="site-footer">页脚</footer>`
    const out = sanitizePageFragment(raw)
    expect(out).not.toContain("<nav")
    expect(out).not.toContain("<footer")
    expect(out).not.toContain("site-head")
    expect(out).toContain("正文")
  })

  it("保留文章/卡片内部的 header（合法语义结构）", () => {
    const raw = `<article class="post-card">
  <header class="post-header"><h2 class="post-title">标题</h2></header>
  <p class="post-excerpt">摘要</p>
</article>`
    const out = sanitizePageFragment(raw)
    expect(out).toContain("post-header")
    expect(out).toContain("post-title")
  })

  it("剥离片段根部的 data-page-host 包裹（布局已提供正文容器）", () => {
    const raw = `<div data-page-host=""><section class="hero"><h1>标题</h1></section></div>`
    const out = sanitizePageFragment(raw)
    expect(out).not.toContain("data-page-host")
    expect(out).toContain('<section class="hero">')
  })

  it("剥离结果在合并后不产生第二个 host", () => {
    const frag = sanitizePageFragment(
      `<div data-page-host=""><div class="page-content"><p>正文</p></div></div>`
    )
    const merged = mergeThemePage(LAYOUT, frag)
    const doc = new JSDOM(merged).window.document
    expect(doc.querySelectorAll("[data-page-host]").length).toBe(1)
  })

  it("渲染期兜底：页面片段自带 nav 时合并后只剩布局那一个导航", () => {
    // 存量主题/绕过 sanitize 的路径：片段里残留了第二个导航
    const frag = `<nav class="page-nav"><a href="/blog">首页</a></nav><p>正文</p>`
    const merged = mergeThemePage(LAYOUT, frag)
    const doc = new JSDOM(merged).window.document
    expect(doc.querySelectorAll("nav").length).toBe(1)
    expect(doc.querySelectorAll("[data-page-host] nav").length).toBe(0)
    expect(merged).toContain("正文")
  })

  it("渲染期兜底：页面片段自带 <aside> 形态的导航时也被剥离", () => {
    // LLM 常把侧边导航写成 <aside class="sidebar-nav"> 而非 <nav>，
    // 只按标签名判定会漏掉 → 页面上出现两个导航栏
    const frag = `<aside class="sidebar-nav">
      <div class="nav-brand"><span class="brand-text">站名</span></div>
      <ul class="nav-list"><li><a href="/blog">首页</a></li><li><a href="/blog/archive">归档</a></li></ul>
    </aside><p>正文</p>`
    const merged = mergeThemePage(LAYOUT, frag)
    const doc = new JSDOM(merged).window.document
    expect(doc.querySelectorAll("aside").length).toBe(0)
    expect(merged).toContain("正文")
  })

  it("页面片段复制了布局骨架容器时，整块骨架被剥离（不叠成两层栅格）", () => {
    const layout = `<!DOCTYPE html><html><head><style>
      .layout-grid { display:grid; grid-template-columns: 240px 1fr; }
      .content-area { padding: 24px; }
      .article-body { max-width: 720px; }
    </style></head><body>
      <div class="layout-grid">
        <aside class="sidebar-nav" data-content="main-nav" data-content-type="nav-list"><a href="/blog">首页</a></aside>
        <main class="content-area"><div data-page-host=""></div></main>
      </div>
    </body></html>`
    // 页面片段把整块布局抄了一遍（含导航）
    const frag = `<div class="layout-grid">
      <aside class="sidebar-nav"><ul class="nav-list"><li><a href="/blog">首页</a></li></ul></aside>
      <main class="content-area"><article class="article-body">正文</article></main>
    </div>`
    const merged = mergeThemePage(layout, frag)
    const doc = new JSDOM(merged).window.document
    // 只剩布局那一层骨架
    expect(doc.querySelectorAll(".layout-grid").length).toBe(1)
    expect(doc.querySelectorAll(".content-area").length).toBe(1)
    expect(doc.querySelectorAll("aside").length).toBe(1)
    // 正文仍在正文宿主里
    const host = doc.querySelector("[data-page-host]")
    expect(host?.querySelector(".article-body")?.textContent).toContain("正文")
  })

  it("渲染期兜底：页面片段自带站点级 header 时被剥离，文章内 header 保留", () => {
    const frag = `<header class="page-head">站点页头</header>
      <article><header class="post-header"><h1>标题</h1></header><p>正文</p></article>`
    const merged = mergeThemePage(LAYOUT, frag)
    const doc = new JSDOM(merged).window.document
    expect(merged).not.toContain("page-head")
    expect(merged).toContain("post-header")
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

describe("固定列数网格不满行兜底", () => {
  const layout = `<!DOCTYPE html><html><head><style>
  .stat-strip{ display:grid; grid-template-columns:repeat(3, 1fr); gap:1px; }
  .post-grid{ display:grid; grid-template-columns:repeat(3, 1fr); }
  @media (max-width:640px){ .stat-strip{ grid-template-columns:1fr; } }
  </style></head><body><nav>nav</nav><div data-page-host=""></div><footer>f</footer></body></html>`

  it("4 个静态子项 + 3 列改为 repeat(4)，媒体查询仍保留", () => {
    const page = `<div class="stat-strip">
      <div class="stat-cell">1</div><div class="stat-cell">2</div>
      <div class="stat-cell">3</div><div class="stat-cell">4</div>
    </div>`
    const out = mergeThemePage(layout, page)
    expect(out).toMatch(
      /\.stat-strip\{[^}]*grid-template-columns:repeat\(4, minmax\(0, 1fr\)\)/
    )
    expect(out).toContain("@media (max-width:640px)")
    // 区块间距兜底（:where() 特异性 0，主题自有规则优先）
    expect(out).toContain(".crumbs")
    expect(out).toMatch(/stat-strip\)\s*\{\s*margin-top/)
  })

  it("6 个子项整除 3 列时保持原样", () => {
    const page = `<div class="stat-strip">${'<div class="stat-cell">x</div>'.repeat(6)}</div>`
    const out = mergeThemePage(layout, page)
    expect(out).toMatch(/\.stat-strip\{[^}]*grid-template-columns:repeat\(3, 1fr\)/)
  })

  it("文章列表只有 1 个模板项时不误伤", () => {
    const page = `<div class="post-grid"><article class="post-card">模板</article></div>`
    const out = mergeThemePage(layout, page)
    expect(out).toMatch(/\.post-grid\{[^}]*grid-template-columns:repeat\(3, 1fr\)/)
  })
})