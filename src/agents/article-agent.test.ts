import { describe, expect, it } from "vitest"
import { SystemMessage, HumanMessage } from "@langchain/core/messages"
import {
  ARTICLE_SYSTEM_PROMPT,
  buildArticleMessages,
} from "./article-agent"

describe("buildArticleMessages", () => {
  it("两个模式都返回 [System, Human] 结构，且系统提示词一致", () => {
    for (const mode of ["continue", "generate"] as const) {
      const messages = buildArticleMessages({ title: "T", mode })
      expect(messages.length).toBe(2)
      expect(messages[0]).toBeInstanceOf(SystemMessage)
      expect(messages[1]).toBeInstanceOf(HumanMessage)
      expect((messages[0] as SystemMessage).content).toBe(ARTICLE_SYSTEM_PROMPT)
    }
  })

  it("continue 模式包含系统消息与已有内容片段", () => {
    const [, human] = buildArticleMessages({
      title: "测试标题",
      content: "第一段已有内容",
      mode: "continue",
    })
    const text = (human as HumanMessage).content as string
    expect(text).toContain("测试标题")
    expect(text).toContain("第一段已有内容")
  })

  it("continue 模式无正文时提示直接生成完整文章", () => {
    const [, human] = buildArticleMessages({
      title: "标题",
      mode: "continue",
    })
    const text = (human as HumanMessage).content as string
    expect(text).toContain("直接生成一篇完整的文章")
  })

  it("generate 模式包含标题与写作要求，不包含旧正文", () => {
    const [, human] = buildArticleMessages({
      title: "生成标题",
      content: "旧正文不应出现",
      instruction: "围绕远程办公展开",
      mode: "generate",
    })
    const text = (human as HumanMessage).content as string
    expect(text).toContain("生成标题")
    expect(text).toContain("围绕远程办公展开")
    expect(text).not.toContain("旧正文不应出现")
  })

  it("excerpt 作为风格参考注入", () => {
    const [, human] = buildArticleMessages({
      title: "T",
      excerpt: "风格摘要",
      mode: "generate",
    })
    const text = (human as HumanMessage).content as string
    expect(text).toContain("风格摘要")
  })

  it("includeMeta 为 true 时提示输出 frontmatter 元信息", () => {
    const [, human] = buildArticleMessages({
      title: "T",
      mode: "generate",
      includeMeta: true,
    })
    const text = (human as HumanMessage).content as string
    expect(text).toContain("frontmatter")
    expect(text).toContain("title:")
    expect(text).toContain("excerpt:")
  })

  it("includeMeta 为 false 时不包含 frontmatter 说明", () => {
    const [, human] = buildArticleMessages({
      title: "T",
      mode: "generate",
      includeMeta: false,
    })
    const text = (human as HumanMessage).content as string
    expect(text).not.toContain("frontmatter")
  })

  it("authorProfile 注入写作风格参考", () => {
    const [, human] = buildArticleMessages({
      title: "T",
      mode: "generate",
      authorProfile: "画像内容",
    })
    const text = (human as HumanMessage).content as string
    expect(text).toContain("画像内容")
    expect(text).toContain("作者画像")
  })

  it("authorProfile 为空时不注入画像段落", () => {
    const [, human] = buildArticleMessages({
      title: "T",
      mode: "generate",
      authorProfile: "",
    })
    const text = (human as HumanMessage).content as string
    expect(text).not.toContain("作者画像")
  })
})
