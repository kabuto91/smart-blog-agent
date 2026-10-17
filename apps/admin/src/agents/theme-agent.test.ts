import { describe, it, expect } from "vitest"
import {
  minifyCss,
  truncateCssRules,
  buildPagePromptContext,
} from "./theme-agent"

const INDENTED_CSS = `
/*
 * ======================================================================
 * 骨架设计系统令牌（仅供引用，禁止覆盖）
 * 包含：色彩令牌 / 字体系统 / 间距节奏 / 动效参数
 * 各页面仅允许从下列变量与类名中取值，禁止自创样式
 * 也禁止书写自定义媒体查询，响应式已由骨架统一处理
 * ======================================================================
 */
/* ===== 全局变量 ===== */
:root {
  --nav-h: 64px;
  --bg: #f7f4ef;
  --accent: #e5a83d;
}
body {
  background: var(--bg);
  color: #1a1a2e;
  font-family: "Noto Serif SC", Georgia, serif;
}
.container {
  max-width: 1080px;
  margin: 0 auto;
}
.nav {
  display: flex;
  gap: 1rem;
}
.nav a:hover { color: var(--accent); }
.hero { padding: 80px 0; }
.btn { display: inline-block; transition: background .2s; }
`

describe("minifyCss", () => {
  it("去除块注释并压缩缩进/换行", () => {
    const result = minifyCss(INDENTED_CSS)
    expect(result).not.toContain("/*")
    expect(result).not.toContain("\n")
    // 冒号两侧空白保留，分号两侧被压缩（无多余空白）
    expect(result).toContain("background: var(--bg)")
    expect(result).toMatch(/;color: #1a1a2e/)
  })

  it("保留字符串字面量内容不被破坏", () => {
    const css = `.a { content: "a,  b"; background: url('x ,  y'); }`
    const result = minifyCss(css)
    expect(result).toContain('content: "a,  b"')
    expect(result).toContain("url('x ,  y')")
  })

  it("区分后代选择器 a :hover 与伪类 a:hover（冒号两侧空白不压缩）", () => {
    const withSpace = `.nav a :hover { color: red; }`
    const withoutSpace = `.nav a:hover { color: red; }`
    expect(minifyCss(withSpace)).toContain("a :hover")
    expect(minifyCss(withoutSpace)).toContain("a:hover")
  })

  it("@media 嵌套块保持完整", () => {
    const css = `@media (max-width: 600px) {
  .nav { display: block; }
  .nav a { padding: 8px; }
}`
    const result = minifyCss(css)
    expect(result).toContain("@media (max-width: 600px){")
    expect(result).toContain(".nav{display: block;}.nav a{padding: 8px;}")
  })
})

describe("truncateCssRules", () => {
  it("未超限时原样返回", () => {
    expect(truncateCssRules("a { color: red; }", 1000)).toBe(
      "a { color: red; }"
    )
  })

  it("超限时结尾为完整规则且括号配对", () => {
    let css = ""
    for (let i = 0; i < 300; i++) {
      css += `.r${i}{content:"${"x".repeat(80)}";}`
    }
    const result = truncateCssRules(css, 5000)
    expect(result).toBeDefined()
    expect(result.length).toBeLessThanOrEqual(5000)
    expect(result.endsWith("}")).toBe(true)
    const opens = (result.match(/{/g) ?? []).length
    const closes = (result.match(/}/g) ?? []).length
    expect(opens).toBe(closes)
  })

  it("空或短输入安全返回", () => {
    expect(truncateCssRules("", 100)).toBe("")
    expect(truncateCssRules("a{}", 0)).toBe("a{}")
  })
})

describe("buildPagePromptContext", () => {
  const skeletonHtml = `<!DOCTYPE html><html><head><style>\n${INDENTED_CSS}\n</style></head><body>
<nav class="container nav"><a href="/">首页</a><a href="/blog">文章</a></nav>
<div class="container hero"><h1 class="page-title">深藏骨架</h1></div>
<div class="post-card"><h2>卡片</h2></div>
</body></html>`

  it("注入的 CSS 体积显著小于原始 CSS", () => {
    const context = buildPagePromptContext(skeletonHtml)
    const block = context.match(/```css\n([\s\S]*?)\n```/)
    expect(block).toBeTruthy()
    const injected = block?.[1] ?? ""
    expect(injected.length).toBeLessThan(INDENTED_CSS.length * 0.7)
  })

  it("类名清单完整（含 DOM 类与 CSS 定义类）", () => {
    const context = buildPagePromptContext(skeletonHtml)
    const manifest = context.match(/类名清单（[\s\S]*?）：\n([^\n]+)/)
    expect(manifest).toBeTruthy()
    const classes = manifest?.[1] ?? ""
    expect(classes).toContain("container")
    expect(classes).toContain("hero")
    expect(classes).toContain("post-card")
    expect(classes).toContain("page-title")
  })

  it("超长 CSS 截断场景下结尾是完整规则", () => {
    let huge = INDENTED_CSS
    for (let i = 0; i < 400; i++) {
      huge += `.gen-${i} { content: "${"y".repeat(90)}"; padding: 0 0 0 ${i}px; }`
    }
    const html = `<!DOCTYPE html><html><head><style>${huge}</style></head><body></body></html>`
    const context = buildPagePromptContext(html)
    const block = context.match(/```css\n([\s\S]*?)\n```/)
    const injected = block?.[1] ?? ""
    if (injected) {
      const opens = (injected.match(/{/g) ?? []).length
      const closes = (injected.match(/}/g) ?? []).length
      expect(opens).toBe(closes)
    }
  })
})