import { describe, it, expect } from "vitest"
import { mergeMissingNav } from "@/lib/theme/content-extractor"
import type { ContentConfig, NavField } from "@/lib/types/content-config"

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