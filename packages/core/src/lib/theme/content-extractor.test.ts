import { describe, it, expect } from "vitest"
import { JSDOM } from "jsdom"
import {
  mergeMissingNav,
  extractContentConfig,
  isDataDrivenNavHref,
  stripDataDrivenNavItems,
  stripHardCodedTaxonomyLinks,
} from "./content-extractor"
import type { ContentConfig, NavField, DynamicField } from "../types/content-config"

const NAV_HTML = `<!DOCTYPE html>
<html>
<head><style>.nav { display: flex; }</style></head>
<body>
  <nav data-content="main-nav" data-content-type="nav-list">
    <a href="/blog">首页</a>
    <a href="/blog/archive">归档</a>
  </nav>
  <footer>
    <ul data-content="footer-nav" data-content-type="nav-list">
      <li><a href="/blog">首页</a></li>
    </ul>
  </footer>
</body>
</html>`

describe("导航中的硬编码分类/标签/文章链接", () => {
  const NAV_WITH_FAKE_TAXONOMY = `<!DOCTYPE html>
<html><body>
  <nav data-content="main-nav" data-content-type="nav-list">
    <ul class="nav-links">
      <li><a href="/blog">首页</a></li>
      <li><a href="/blog/archive">归档</a></li>
      <li><a href="/blog/category/frontend">前端</a></li>
      <li><a href="/blog/tag/vue">Vue</a></li>
      <li><a href="/blog/sample-post">示例文章</a></li>
      <li><a href="https://github.com">GitHub</a></li>
    </ul>
  </nav>
</body></html>`

  it("isDataDrivenNavHref 识别数据驱动路由", () => {
    expect(isDataDrivenNavHref("/blog/category/frontend")).toBe(true)
    expect(isDataDrivenNavHref("/blog/tag/vue")).toBe(true)
    expect(isDataDrivenNavHref("/blog/sample-post")).toBe(true)
    expect(isDataDrivenNavHref("/collections/my-collection")).toBe(true)
    expect(isDataDrivenNavHref("/blog")).toBe(false)
    expect(isDataDrivenNavHref("/blog/archive")).toBe(false)
    expect(isDataDrivenNavHref("https://github.com")).toBe(false)
    expect(isDataDrivenNavHref("/")).toBe(false)
  })

  it("提取导航项时过滤掉硬编码的分类/标签/文章链接", () => {
    const { contentConfig } = extractContentConfig(NAV_WITH_FAKE_TAXONOMY)
    const nav = contentConfig["main-nav"] as NavField
    expect(nav.items.map((i) => i.label)).toEqual(["首页", "归档", "GitHub"])
    expect(nav.items.some((i) => i.href.includes("/blog/tag/"))).toBe(false)
  })

  it("导航项全部是数据驱动链接时保留原样（不清空导航）", () => {
    const html = `<!DOCTYPE html><html><body>
      <nav data-content="main-nav" data-content-type="nav-list">
        <ul class="nav-links">
          <li><a href="/blog/tag/vue">Vue</a></li>
          <li><a href="/blog/tag/react">React</a></li>
        </ul>
      </nav>
    </body></html>`
    const { contentConfig } = extractContentConfig(html)
    const nav = contentConfig["main-nav"] as NavField
    expect(nav.items).toHaveLength(2)
  })

  it("stripDataDrivenNavItems 清理存量配置里的假导航项", () => {
    const config: ContentConfig = {
      "main-nav": {
        type: "nav-list",
        label: "main-nav",
        items: [
          { label: "首页", href: "/blog" },
          { label: "Vue", href: "/blog/tag/vue" },
          { label: "示例文章", href: "/blog/sample-post" },
        ],
        itemTemplate: "<li><a href=\"{href}\">{label}</a></li>",
      },
      "hero-title": { type: "text", label: "Hero", value: "x" },
    }
    const out = stripDataDrivenNavItems(config) as ContentConfig
    const nav = out["main-nav"] as NavField
    expect(nav.items.map((i) => i.label)).toEqual(["首页"])
    // 非导航字段不受影响
    expect(out["hero-title"]).toBe(config["hero-title"])
  })

  it("stripDataDrivenNavItems 无变化时保持原对象引用", () => {
    const config: ContentConfig = {
      "main-nav": {
        type: "nav-list",
        label: "main-nav",
        items: [{ label: "首页", href: "/blog" }],
        itemTemplate: "",
      },
    }
    expect(stripDataDrivenNavItems(config)).toBe(config)
  })
})

describe("stripHardCodedTaxonomyLinks（导航多组链接）", () => {
  it("移除导航中未受管理的分组里的硬编码分类/标签链接及其分组标题", () => {
    const html = `<!DOCTYPE html><html><body>
      <nav class="site-nav" data-content="main-nav" data-content-type="nav-list">
        <div class="nav-brand"><span class="brand">站名</span></div>
        <div class="nav-links">
          <div class="nav-section-label">导航</div>
          <ul class="nav-list"><li><a href="/blog">首页</a></li><li><a href="/blog/archive">归档</a></li></ul>
          <div class="nav-section-label">分类</div>
          <ul class="nav-list"><li><a href="/blog/category/tech">技术</a></li></ul>
          <div class="nav-section-label">标签</div>
          <ul class="nav-list"><li><a href="/blog/tag/css">CSS</a></li></ul>
        </div>
      </nav>
    </body></html>`
    const dom = new JSDOM(html)
    stripHardCodedTaxonomyLinks(dom.window.document)
    const out = dom.window.document.body.innerHTML
    // 核心路由保留
    expect(out).toContain('href="/blog"')
    expect(out).toContain('href="/blog/archive"')
    // 硬编码的分类/标签链接移除
    expect(out).not.toContain("/blog/category/tech")
    expect(out).not.toContain("/blog/tag/css")
    // 分组标题不留下孤儿
    expect(out).not.toContain("分类")
    expect(out).not.toContain("标签")
    // 品牌区不受影响
    expect(out).toContain("站名")
  })

  it("站外链接与核心路由不受影响", () => {
    const html = `<!DOCTYPE html><html><body>
      <nav data-content="main-nav" data-content-type="nav-list">
        <ul class="nav-links">
          <li><a href="/blog">首页</a></li>
          <li><a href="https://github.com">GitHub</a></li>
        </ul>
      </nav>
    </body></html>`
    const dom = new JSDOM(html)
    stripHardCodedTaxonomyLinks(dom.window.document)
    const out = dom.window.document.body.innerHTML
    expect(out).toContain("/blog")
    expect(out).toContain("https://github.com")
  })
})

describe("mergeMissingNav", () => {
  it("从布局补齐缺失的导航字段", () => {
    const config = mergeMissingNav({}, NAV_HTML)
    expect(config).not.toBeNull()
    const mainNav = config?.["main-nav"] as NavField | undefined
    expect(mainNav?.type).toBe("nav-list")
    expect(mainNav?.items).toEqual([
      { label: "首页", href: "/blog" },
      { label: "归档", href: "/blog/archive" },
    ])
    const footerNav = config?.["footer-nav"] as NavField | undefined
    expect(footerNav?.items).toEqual([{ label: "首页", href: "/blog" }])
  })

  it("已有导航配置不被覆盖", () => {
    const existing: ContentConfig = {
      "main-nav": {
        type: "nav-list",
        label: "main-nav",
        items: [{ label: "自定义", href: "/custom" }],
        itemTemplate: '<a href="{href}">{label}</a>',
      },
    }
    const config = mergeMissingNav(existing, NAV_HTML)!
    expect((config["main-nav"] as NavField).items).toEqual([
      { label: "自定义", href: "/custom" },
    ])
    expect((config["footer-nav"] as NavField | undefined)?.type).toBe("nav-list")
  })

  it("未识别的导航（无 <nav>/无标记）不产生字段", () => {
    const html = `<body><div class="navbar"><a href="/blog">首页</a></div><h1 data-content="blog-title" data-content-type="text">标题</h1></body>`
    const config = mergeMissingNav({}, html)
    expect(config).toEqual({})
    expect(config?.["main-nav"]).toBeUndefined()
  })

  it("无补丁时保持原配置对象不变", () => {
    const html = `<body><h1 data-content="blog-title" data-content-type="text">标题</h1></body>`
    expect(mergeMissingNav({}, html)).toEqual({})
    expect(mergeMissingNav(null, html)).toBeNull()
  })
})

describe("mergeMissingNav 跳过品牌链接", () => {
  const BRANDED_HTML = `<!DOCTYPE html>
<body>
  <nav data-content="main-nav" data-content-type="nav-list">
    <a href="/blog" class="nav-brand"><span>极简日志</span></a>
    <a href="/blog">首页</a>
    <a href="/blog/archive">归档</a>
  </nav>
</body>`

  it("提取导航项时排除品牌链接", () => {
    const config = mergeMissingNav({}, BRANDED_HTML)!
    const mainNav = config["main-nav"] as NavField
    expect(mainNav.items).toEqual([
      { label: "首页", href: "/blog" },
      { label: "归档", href: "/blog/archive" },
    ])
    expect(mainNav.itemTemplate).not.toBeNull()
    expect(mainNav.itemTemplate).not.toContain("nav-brand")
    expect(mainNav.itemTemplate).not.toContain("极简日志")
  })

  it("修复被展平的旧导航：模板套回 li，品牌另存", () => {
    // 旧版 extractNavField 把品牌模板 <a class=nav-brand> 套在所有链接上
    const flattened: ContentConfig = {
      "main-nav": {
        type: "nav-list",
        label: "main-nav",
        items: [
          { label: "首页", href: "/blog" },
          { label: "归档", href: "/blog/archive" },
        ],
        itemTemplate:
          '<a href="{href}" class="nav-brand" data-content="blog-title" data-content-type="text">{label}</a>',
      },
    }
    const config = mergeMissingNav(flattened, BRANDED_HTML)!
    const mainNav = config["main-nav"] as NavField
    expect(mainNav.itemTemplate).toContain("<li>")
    expect(mainNav.itemTemplate).not.toContain("nav-brand")
    expect(mainNav.items).toEqual([
      { label: "首页", href: "/blog" },
      { label: "归档", href: "/blog/archive" },
    ])
  })
})

describe("extractContentConfig 动态列表项模板", () => {
  it("首子元素是整块面板时，钻取到真正列表项作为模板", () => {
    const html = `<section class="section" data-content="article-list" data-content-type="dynamic-articles">
      <div class="container">
        <h2 class="section-title">近期文章</h2>
        <ul class="archive-list">
          <li class="archive-item" data-map="template">
            <span class="archive-item__date" data-map="date">2024.03.01</span>
            <a href="#" class="archive-item__title" data-map="link">模板标题</a>
            <span class="archive-item__cat" data-map="category">设计</span>
          </li>
          <li class="archive-item">
            <span class="archive-item__date">2024.02.22</span>
            <a href="/blog/a-sample-slug" class="archive-item__title">示例</a>
            <span class="archive-item__cat">设计</span>
          </li>
        </ul>
        <div style="text-align:center"><a href="/blog/archive" class="btn">查看归档</a></div>
      </div>
    </section>`
    const { contentConfig } = extractContentConfig(html)
    const field = contentConfig["article-list"] as DynamicField
    expect(field.type).toBe("dynamic-articles")
    expect(field.itemTemplate).toContain("<li")
    expect(field.itemTemplate).not.toContain("近期文章")
    expect(field.itemTemplate).not.toContain("查看归档")
    expect(field.itemTemplate).not.toContain("<ul")
  })

  it("首子元素即列表项时保持原模板不变", () => {
    const html = `<ul class="archive-list" data-content="articles" data-content-type="dynamic-articles">
      <li class="archive-item">
        <time class="archive-item__date" data-map="date">2023.10.24</time>
        <a href="#" class="archive-item__title" data-map="link"><span data-map="title">模板</span></a>
        <span class="archive-item__cat" data-map="category">设计</span>
      </li>
    </ul>`
    const { contentConfig } = extractContentConfig(html)
    const field = contentConfig["articles"] as DynamicField
    expect(field.itemTemplate).toContain("<li")
    expect(field.itemTemplate).toContain('data-map="title"')
  })

  it("卡片内嵌分类标签组 ul 时不误判为包装容器", () => {
    // 复现真实 bug：卡片（article.post-card）内部有 ul.tag-list 分类标签组，
    // 提取器曾把标签组 li 当成项模板导致 fieldMapping 只剩 category
    const html = `<section data-content="article-list" data-content-type="dynamic-articles">
      <article class="post-card">
        <div class="meta" data-map="date">2049.10.24</div>
        <h3 class="post-title"><a data-map="link" href="/blog/x"><span data-map="title">样本标题</span></a></h3>
        <p class="excerpt" data-map="excerpt">样本摘要</p>
        <ul class="tag-list"><li><span class="tag" data-map="category">CYBER</span></li></ul>
      </article>
    </section>`
    const { contentConfig } = extractContentConfig(html)
    const field = contentConfig["article-list"] as DynamicField
    // 模板是整张卡片而非标签组 li
    expect(field.itemTemplate).toContain("<article")
    expect(field.itemTemplate).toContain('data-map="title"')
    // fieldMapping 收齐全部字段
    expect(field.fieldMapping).toMatchObject({
      date: "date",
      link: "link",
      title: "title",
      excerpt: "excerpt",
      category: "category",
    })
  })

  it("包装容器内 ul 的 li 字段齐全时仍取 li 作模板", () => {
    const html = `<section data-content="article-list" data-content-type="dynamic-articles">
      <div class="post-list">
        <ul>
          <li><span data-map="date">2023.10.24</span><a href="#" data-map="link"><span data-map="title">模板</span></a></li>
        </ul>
      </div>
    </section>`
    const { contentConfig } = extractContentConfig(html)
    const field = contentConfig["article-list"] as DynamicField
    expect(field.itemTemplate).toContain("<li")
    expect(field.fieldMapping).toMatchObject({
      date: "date",
      link: "link",
      title: "title",
    })
  })

  it("卡片内部的 archive-row 包装不抢模板，整张卡片保留全部动态字段", () => {
    // 复现「主题 6」列表页没有文章：卡片内层 .archive-row 命中 row 词根，
    // 旧逻辑把首个子元素 <span data-map="date"> 记成 itemTemplate，
    // fieldMapping 又漏掉模板根节点自身的 data-map，最终只剩一串日期。
    const html = `<section data-content="article-list" data-content-type="dynamic-articles">
      <article class="archive-item">
        <div class="archive-row">
          <span class="archive-date" data-map="date">2025.06.18</span>
          <h3 class="archive-title"><a href="#" data-map="link"><span data-map="title">样本标题</span></a></h3>
          <span class="archive-read" data-map="category">设计随笔</span>
        </div>
      </article>
    </section>`
    const { contentConfig } = extractContentConfig(html)
    const field = contentConfig["article-list"] as DynamicField
    expect(field.itemTemplate).toContain('<article class="archive-item">')
    expect(field.itemTemplate).toContain('data-map="title"')
    expect(field.fieldMapping).toMatchObject({
      date: "date",
      link: "link",
      title: "title",
      category: "category",
    })
  })

  it("模板根节点自身带 data-map 时也计入 fieldMapping", () => {
    const html = `<div data-content="article-list" data-content-type="dynamic-articles">
      <span class="archive-date" data-map="date">2025.06.18</span>
    </div>`
    const { contentConfig } = extractContentConfig(html)
    const field = contentConfig["article-list"] as DynamicField
    // 模板根节点即带 data-map 的 span：旧逻辑只扫后代，fieldMapping 会是 {}
    expect(field.itemTemplate).toContain('data-map="date"')
    expect(field.fieldMapping).toMatchObject({ date: "date" })
  })
})

describe("extractContentConfig 兜底补标", () => {
  it("未标记的标题/段落自动补 text 标记，key 取类名", () => {
    const html = `<div class="card"><h3 class="post-title">卡片标题</h3><p class="post-card-excerpt">摘要文本</p></div>`
    const { contentConfig, htmlTemplate } = extractContentConfig(html)
    expect(contentConfig["post-title"]).toMatchObject({
      type: "text",
      value: "卡片标题",
    })
    expect(contentConfig["post-card-excerpt"]).toMatchObject({
      type: "text",
      value: "摘要文本",
    })
    expect(htmlTemplate).toContain('data-content="post-title"')
    expect(htmlTemplate).toContain(
      'data-content="post-card-excerpt" data-content-type="text"'
    )
  })

  it("重复类名自动去重（post-title / post-title-2）", () => {
    const html = `<div class="card"><h3 class="post-title">A</h3><h3 class="post-title">B</h3></div>`
    const { contentConfig } = extractContentConfig(html)
    expect(contentConfig["post-title"]).toMatchObject({ value: "A" })
    expect(contentConfig["post-title-2"]).toMatchObject({ value: "B" })
  })

  it("与已标记文本相同的漏标元素复用同一 key，不生成 blog-title-2", () => {
    const html = `<h1 data-content="blog-title" data-content-type="text">我的博客</h1><h2 class="blog-title">我的博客</h2>`
    const { contentConfig, htmlTemplate } = extractContentConfig(html)
    expect(contentConfig["blog-title-2"]).toBeUndefined()
    expect(contentConfig["blog-title"]).toMatchObject({ value: "我的博客" })
    // 两处都是同 key，随单一字段整体更新
    expect(htmlTemplate).toContain('data-content="blog-title"')
    expect(htmlTemplate.match(/data-content="blog-title"/g)?.length).toBe(2)
  })

  it("同文本的多个未标记元素只产生一个字段", () => {
    const html = `<h3 class="section-title">章节</h3><h3 class="section-title">章节</h3>`
    const { contentConfig, htmlTemplate } = extractContentConfig(html)
    expect(contentConfig["section-title-2"]).toBeUndefined()
    expect(contentConfig["section-title"]).toMatchObject({ value: "章节" })
    expect(htmlTemplate.match(/data-content="section-title"/g)?.length).toBe(2)
  })

  it("非 text 类型同 key 容器仍拆成 -N，避免误合并同类元素", () => {
    const html = `<div data-content="tag-cloud" data-content-type="dynamic-tags"><a data-map="name">A</a></div><div data-content="tag-cloud" data-content-type="dynamic-tags"><a data-map="name">B</a></div>`
    const { contentConfig, htmlTemplate } = extractContentConfig(html)
    expect(contentConfig["tag-cloud"]).toBeTruthy()
    expect(contentConfig["tag-cloud-2"]).toBeTruthy()
    expect(htmlTemplate).toContain('data-content="tag-cloud-2"')
  })

  it("文本匹配已配置的全局字段值时，绑定到全局 key（hero-title→blog-title）", () => {
    const html = `<h1 class="hero-title">我的博客</h1>`
    const { contentConfig, htmlTemplate } = extractContentConfig(html, {
      "blog-title": "我的博客",
    })
    expect(contentConfig["hero-title"]).toBeUndefined()
    expect(contentConfig["blog-title"]).toMatchObject({
      type: "text",
      value: "我的博客",
    })
    expect(htmlTemplate).toContain('data-content="blog-title"')
  })

  it("文本不匹配全局字段值时，仍按类名派生 key", () => {
    const html = `<h1 class="hero-title">探索 AI 世界</h1>`
    const { contentConfig } = extractContentConfig(html, {
      "blog-title": "我的博客",
    })
    expect(contentConfig["hero-title"]).toMatchObject({ value: "探索 AI 世界" })
    expect(contentConfig["blog-title"]).toBeUndefined()
  })

  it("已有 data-content 祖先覆盖的文本不重复补标", () => {
    const html = `<section data-content="article-list" data-content-type="dynamic-articles"><div><h3 class="post-title">模板标题</h3></div></section>`
    const { contentConfig, htmlTemplate } = extractContentConfig(html)
    expect(contentConfig["post-title"]).toBeUndefined()
    expect(htmlTemplate).not.toContain('data-content="post-title"')
  })

  it("无类名元素用标签名作为 key", () => {
    const html = `<div><h3>无类标题</h3></div>`
    const { contentConfig } = extractContentConfig(html)
    expect(contentConfig["h3"]).toMatchObject({
      type: "text",
      value: "无类标题",
    })
  })

  it("全局字段 key 被不同文本手标重复占用时不生成 blog-title-2，退回标签名派生 key", () => {
    const html = `<h1 data-content="blog-title" data-content-type="text">我的博客</h1><h2 data-content="blog-title" data-content-type="text">开始探索</h2>`
    const { contentConfig, htmlTemplate } = extractContentConfig(html)
    expect(contentConfig["blog-title"]).toMatchObject({ value: "我的博客" })
    expect(contentConfig["blog-title-2"]).toBeUndefined()
    // 第二处退回标签名派生 key，仍可独立编辑
    expect(contentConfig["h2"]).toMatchObject({ value: "开始探索" })
    expect(htmlTemplate).toContain('data-content="h2"')
  })

  it("未标元素复用全局名类但文本不同时不生成 blog-title-2", () => {
    const html = `<h1 class="blog-title">我的博客</h1><p class="blog-title">开始探索</p>`
    const { contentConfig } = extractContentConfig(html, {
      "blog-title": "我的博客",
    })
    expect(contentConfig["blog-title"]).toMatchObject({ value: "我的博客" })
    expect(contentConfig["blog-title-2"]).toBeUndefined()
    expect(contentConfig["p"]).toMatchObject({ value: "开始探索" })
  })

  it("非全局 key 不同文本仍追加 -N（post-title-2 行为保留）", () => {
    const html = `<h3 class="post-title">A</h3><h3 class="post-title">B</h3>`
    const { contentConfig } = extractContentConfig(html)
    expect(contentConfig["post-title"]).toMatchObject({ value: "A" })
    expect(contentConfig["post-title-2"]).toMatchObject({ value: "B" })
  })
})

describe("extractContentConfig 正文占位区卫生", () => {
  it("data-map=body 内的段落不补标、已手写的 data-content 被剥离", () => {
    const html = `<div class="container">
      <article data-content="article-body" data-content-type="article-body">
        <h2 data-map="title">样本标题</h2>
        <div data-map="body">
          <p>未标记的占位段落</p>
          <p data-content="p-1" data-content-type="text">LLM 手写标记的占位段落</p>
        </div>
      </article>
      <p>容器外的正常文本</p>
    </div>`
    const { contentConfig, htmlTemplate } = extractContentConfig(html)
    // body 占位区内的文本不进 contentConfig（无论是否被标记）
    expect(contentConfig["p-1"]).toBeUndefined()
    expect(Object.values(contentConfig).some((f) => f.type === "text" && f.value?.includes("占位段落"))).toBe(false)
    // 手写标记被剥离
    expect(htmlTemplate).not.toContain('data-content="p-1"')
    // 容器外正常文本仍被兜底补标
    expect(contentConfig["h2-1"]).toBeUndefined() // article-body 容器内的 data-map 标题不被补标（有 data-content 祖先）
    const outer = Object.entries(contentConfig).find(([k, f]) => f.type === "text" && f.value === "容器外的正常文本")
    expect(outer).toBeTruthy()
  })
})