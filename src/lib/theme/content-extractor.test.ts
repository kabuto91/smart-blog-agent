import { describe, it, expect } from "vitest"
import { mergeMissingNav, extractContentConfig } from "@/lib/theme/content-extractor"
import type { ContentConfig, NavField, DynamicField } from "@/lib/types/content-config"

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
})