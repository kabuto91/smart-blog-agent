import { describe, expect, it } from "vitest"
import { parseGenerated } from "./article-generate-dialog"

describe("parseGenerated", () => {
  it("无 frontmatter 时整段作为正文", () => {
    const result = parseGenerated("## 标题\n\n一段正文")
    expect(result.content).toBe("## 标题\n\n一段正文")
    expect(result.title).toBeUndefined()
    expect(result.excerpt).toBeUndefined()
  })

  it("解析 frontmatter 中的标题与摘要，并剥离出正文", () => {
    const result = parseGenerated(
      "---\ntitle: 我的标题\nexcerpt: 一句话摘要\n---\n\n## 小标题\n\n正文内容"
    )
    expect(result.title).toBe("我的标题")
    expect(result.excerpt).toBe("一句话摘要")
    expect(result.content).toBe("## 小标题\n\n正文内容")
  })

  it("frontmatter 未闭合（流式中）时先原样返回", () => {
    const result = parseGenerated("---\ntitle: 未完")
    expect(result.content).toBe("---\ntitle: 未完")
  })

  it("兼容 description 键作为摘要", () => {
    const result = parseGenerated("---\ndescription: 摘要A\n---\n正文")
    expect(result.excerpt).toBe("摘要A")
    expect(result.content).toBe("正文")
  })

  it("忽略空值字段", () => {
    const result = parseGenerated("---\ntitle: \nexcerpt: 有摘要\n---\n正文")
    expect(result.title).toBeUndefined()
    expect(result.excerpt).toBe("有摘要")
  })
})
