import { describe, it, expect } from "vitest"
import { renderContent } from "./content-renderer"
import type { ContentConfig } from "../types/content-config"

describe("renderContent pageSpecific", () => {
  const config: ContentConfig = {
    "hero-title": { type: "text", label: "Hero", value: "你好" },
  }

  it("拆分模式下跳过 hero/banner 启发式剪枝，保留正文", () => {
    const out = renderContent(SKELETON_TEMPLATE, config, undefined, undefined, {
      pageSpecific: true,
    })
    expect(out).toContain("你好")
    expect(out).toContain("article-list")
  })
})

const SKELETON_TEMPLATE = `<!DOCTYPE html>
<html>
<head><style>.hero{padding:40px}.post-list{display:grid}.container{max-width:900px}</style></head>
<body>
<nav><a href="/blog">首页</a></nav>
<main>
  <section class="hero" data-page-type="home"><h2 data-content="hero-title" data-content-type="text">Hero</h2></section>
  <div data-page-type="home list" class="container"></div>
  <section><div data-content="article-list" data-content-type="dynamic-articles"><article class="post-list"></article></div></section>
</main>
<footer>footer</footer>
</body>
</html>`

describe("renderContent legacy mode", () => {
  it("非拆分模式仍执行 data-page-type 剪枝（保留 home）", () => {
    // resolvePageType(undefined) => home
    const out = renderContent(SKELETON_TEMPLATE, {}, undefined, undefined)
    expect(out).toContain("Hero")
    expect(out).not.toContain('data-page-type="list"')
  })
})