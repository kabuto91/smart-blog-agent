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

describe("renderContent author-avatar", () => {
  const AVATAR_URL = "/api/uploads/abc"

  it("无 data-content 的 .avatar 容器，img src 为空时自动填充全局头像", () => {
    const html = `<div class="avatar"><img src="" alt="头像"></div>`
    const out = renderContent(
      html,
      {},
      undefined,
      { "author-avatar": AVATAR_URL },
      { pageSpecific: true }
    )
    expect(out).toContain(`src="${AVATAR_URL}"`)
  })

  it("带 data-content=\"author-avatar\" 的元素会被全局头像填充", () => {
    const html = `<img class="avatar" data-content="author-avatar" data-content-type="text" src="" alt="头像">`
    const out = renderContent(
      html,
      {},
      undefined,
      { "author-avatar": AVATAR_URL },
      { pageSpecific: true }
    )
    expect(out).toContain(`src="${AVATAR_URL}"`)
  })

  it(".avatar 内已有非空 src 时不被覆盖", () => {
    const html = `<div class="avatar"><img src="https://example.com/x.png" alt="头像"></div>`
    const out = renderContent(
      html,
      {},
      undefined,
      { "author-avatar": AVATAR_URL },
      { pageSpecific: true }
    )
    expect(out).toContain('src="https://example.com/x.png"')
    expect(out).not.toContain(`src="${AVATAR_URL}"`)
  })

  it("未配置全局头像时不注入", () => {
    const html = `<div class="avatar"><img src="" alt="头像"></div>`
    const out = renderContent(html, {}, undefined, undefined, {
      pageSpecific: true,
    })
    expect(out).toContain('src=""')
  })
})

describe("renderContent 渐变圆形头像占位兜底", () => {
  const AVATAR_URL = "/api/uploads/abc"

  it("圆形+渐变的空 div 会被填充为头像背景", () => {
    const html = `<div class="sidebar-widget">
      <div style="width:64px;height:64px;border-radius:var(--radius-full);background:linear-gradient(135deg,#111,#222);margin-bottom:8px;"></div>
      <p data-content="author-name" data-content-type="text">作者</p>
    </div>`
    const out = renderContent(
      html,
      {},
      undefined,
      { "author-avatar": AVATAR_URL },
      { pageSpecific: true }
    )
    expect(out).toContain("background-image: url")
    expect(out).toContain(AVATAR_URL)
  })

  it("有内容或含 img 的圆形元素不被覆盖", () => {
    const withText = `<div style="width:64px;height:64px;border-radius:50%;background:linear-gradient(#111,#222);">文字</div>`
    expect(
      renderContent(withText, {}, undefined, { "author-avatar": AVATAR_URL }, {
        pageSpecific: true,
      })
    ).not.toContain(`background-image: url("${AVATAR_URL}")`)

    const withImg = `<div style="width:64px;height:64px;border-radius:50%;background:linear-gradient(#111,#222);"><img src=""></div>`
    expect(
      renderContent(withImg, {}, undefined, { "author-avatar": AVATAR_URL }, {
        pageSpecific: true,
      })
    ).not.toContain(`background-image: url("${AVATAR_URL}")`)
  })

  it("未配置头像时保持渐变占位", () => {
    const html = `<div style="width:64px;height:64px;border-radius:50%;background:linear-gradient(#111,#222);"></div>`
    const out = renderContent(html, {}, undefined, undefined, {
      pageSpecific: true,
    })
    expect(out).not.toContain("background-image:")
    expect(out).toContain("linear-gradient")
  })
})