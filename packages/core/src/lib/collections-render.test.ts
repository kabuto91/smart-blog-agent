import { describe, it, expect } from "vitest"
import {
  escapeHtml,
  buildCollectionNavHtml,
  buildCollectionHeadHtml,
  buildCollectionsGridHtml,
} from "./collections-render"
import type { CollectionNavItem } from "./collections"

describe("escapeHtml", () => {
  it("转义 HTML 特殊字符", () => {
    expect(escapeHtml(`<a href="x"> & '`)).toBe(
      "&lt;a href=&quot;x&quot;&gt; &amp; &#39;"
    )
  })
})

describe("buildCollectionNavHtml", () => {
  const base: CollectionNavItem = {
    collection: { id: "c1", name: "前端进阶", slug: "frontend-advanced" },
    total: 3,
    current: 2,
    prev: { slug: "part-1", title: "第一篇" },
    next: { slug: "part-3", title: "第三篇" },
  }

  it("空数组返回空字符串", () => {
    expect(buildCollectionNavHtml([])).toBe("")
  })

  it("输出合集名链接、进度、上一篇/下一篇链接", () => {
    const html = buildCollectionNavHtml([base])
    expect(html).toContain("/collections/frontend-advanced")
    expect(html).toContain("前端进阶")
    expect(html).toContain("第 2 篇 / 共 3 篇")
    expect(html).toContain('href="/blog/part-1"')
    expect(html).toContain("← 上一篇")
    expect(html).toContain('href="/blog/part-3"')
    expect(html).toContain("下一篇 →")
  })

  it("无上一篇/下一篇时输出占位", () => {
    const html = buildCollectionNavHtml([
      {
        collection: { id: "c1", name: "前端进阶", slug: "frontend-advanced" },
        total: 1,
        current: 1,
        prev: null,
        next: null,
      },
    ])
    expect(html).toContain("已是第一篇")
    expect(html).toContain("已是最后一篇")
    expect(html).not.toContain('href="/blog/part-')
  })

  it("多个合集逐个渲染卡片", () => {
    const html = buildCollectionNavHtml([
      base,
      {
        collection: { id: "c2", name: "设计灵感", slug: "design" },
        total: 2,
        current: 1,
        prev: null,
        next: { slug: "d2", title: "第二篇" },
      },
    ])
    expect(html).toContain("前端进阶")
    expect(html).toContain("设计灵感")
    expect(html.match(/class="jjc-nav__card"/g)?.length).toBe(2)
  })

  it("合集名中的特殊字符被转义", () => {
    const html = buildCollectionNavHtml([
      {
        collection: { id: "c1", name: `<b>合集</b> & "引号"`, slug: "x" },
        total: 1,
        current: 1,
        prev: null,
        next: null,
      },
    ])
    expect(html).not.toContain("<b>合集</b>")
    expect(html).toContain("&lt;b&gt;合集&lt;/b&gt;")
  })
})

describe("buildCollectionHeadHtml", () => {
  it("输出名称、简介、文章数", () => {
    const html = buildCollectionHeadHtml({
      name: "前端进阶系列",
      description: "从入门到进阶",
      articleCount: 5,
    })
    expect(html).toContain("前端进阶系列")
    expect(html).toContain("从入门到进阶")
    expect(html).toContain("共 5 篇文章")
  })

  it("无简介时不输出简介段落", () => {
    const html = buildCollectionHeadHtml({
      name: "合集",
      description: null,
      articleCount: 0,
    })
    expect(html).toContain("合集")
    expect(html).not.toContain('class="jjc-head__desc"')
  })
})

describe("buildCollectionsGridHtml", () => {
  it("空列表输出空状态文案", () => {
    const html = buildCollectionsGridHtml([])
    expect(html).toContain("暂无合集")
  })

  it("输出合集卡片与链接", () => {
    const html = buildCollectionsGridHtml([
      {
        name: "前端进阶",
        slug: "frontend-advanced",
        description: "系列文章",
        articleCount: 3,
      },
      { name: "设计灵感", slug: "design", description: null, articleCount: 0 },
    ])
    expect(html).toContain('href="/collections/frontend-advanced"')
    expect(html).toContain("前端进阶")
    expect(html).toContain("系列文章")
    expect(html).toContain("3 篇文章")
    expect(html).toContain('href="/collections/design"')
    expect(html.match(/class="jjc-card"/g)?.length).toBe(2)
  })
})
