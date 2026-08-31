import { describe, expect, it } from "vitest"
import {
  USER_PROFILE_SYSTEM_PROMPT,
  buildProfilePrompt,
  type ProfileArticleInput,
} from "./user-profile"

const articles: ProfileArticleInput[] = [
  {
    title: "第一篇标题",
    category: "前端",
    tags: ["React", "性能"],
    excerpt: "这是第一篇的摘要",
    contentPreview: "这是第一篇的正文片段内容",
  },
  {
    title: "第二篇标题",
    tags: ["工程化"],
  },
]

describe("buildProfilePrompt", () => {
  it("输出包含每篇文章的标题、分类、标签、摘要与正文片段", () => {
    const prompt = buildProfilePrompt(articles)
    expect(prompt).toContain("第一篇标题")
    expect(prompt).toContain("前端")
    expect(prompt).toContain("React、性能")
    expect(prompt).toContain("这是第一篇的摘要")
    expect(prompt).toContain("这是第一篇的正文片段内容")
    expect(prompt).toContain("第二篇标题")
    expect(prompt).toContain("工程化")
  })

  it("缺省字段（分类/摘要/正文片段）不产生空占位", () => {
    const prompt = buildProfilePrompt(articles)
    // 无缺省数据的第二篇文章不应出现空的「分类：」或「摘要：」
    const secondArticle = prompt.split("\n\n")[2] ?? ""
    expect(secondArticle).not.toContain("分类：")
    expect(secondArticle).not.toContain("摘要：")
    expect(secondArticle).not.toContain("正文片段：")
  })

  it("包含文章数量说明", () => {
    const prompt = buildProfilePrompt(articles)
    expect(prompt).toContain("2 篇文章")
  })
})

describe("USER_PROFILE_SYSTEM_PROMPT", () => {
  it("覆盖写作风格与目标读者等画像维度", () => {
    expect(USER_PROFILE_SYSTEM_PROMPT).toContain("写作风格")
    expect(USER_PROFILE_SYSTEM_PROMPT).toContain("目标读者")
    expect(USER_PROFILE_SYSTEM_PROMPT).toContain("主要领域")
  })
})
