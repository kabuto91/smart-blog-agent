import { SystemMessage, HumanMessage } from "@langchain/core/messages"
import { createLLM } from "@/lib/llm/client"

/** 画像生成所需的最小文章信息。 */
export interface ProfileArticleInput {
  title: string
  excerpt?: string | null
  category?: string | null
  tags: string[]
  /** 正文节选，用于捕捉写作风格（调用方截断控制长度）。 */
  contentPreview?: string
}

export const USER_PROFILE_SYSTEM_PROMPT = `你是一位资深内容策划与编辑。请基于给定博客的文章列表，提炼一份「用户画像」，用于后续 AI 生成主题与文章时保持一致的内容方向与写作风格。

输出要求：
- 用中文输出一段 200~300 字的紧凑画像，不要输出 JSON、不要额外解释。
- 内容必须完全基于给定文章，禁止编造。

画像需覆盖以下维度：
1. 主要领域/主题：作者最常写作的领域与高频关键词；
2. 写作风格：语言风格（口语/专业/技术向等）、语气（理性/犀利/温和/幽默等）、常用结构；
3. 文章特征：常见篇幅、格式习惯（列表/代码块/引用等）；
4. 目标读者：文章面向的人群；
5. 一句话总结：作者是谁、博客的核心价值。`

/** 把文章列表拼成画像生成用的 Human 输入。 */
export function buildProfilePrompt(articles: ProfileArticleInput[]): string {
  const lines = articles.map((a) => {
    const parts = [
      `标题：${a.title}`,
      a.category ? `分类：${a.category}` : "",
      a.tags.length > 0 ? `标签：${a.tags.join("、")}` : "",
      a.excerpt?.trim() ? `摘要：${a.excerpt.trim()}` : "",
    ]
    const head = parts.filter(Boolean).join("｜")
    return a.contentPreview ? `${head}\n正文片段：${a.contentPreview}` : head
  })
  return `请基于以下 ${lines.length} 篇文章提炼用户画像：\n\n${lines.join("\n\n")}`
}

/** 基于文章列表调用 LLM 生成用户画像文本（调用方负责兜底错误）。 */
export async function generateUserProfile(
  articles: ProfileArticleInput[]
): Promise<string> {
  const llm = await createLLM(false)
  const response = await llm.invoke([
    new SystemMessage(USER_PROFILE_SYSTEM_PROMPT),
    new HumanMessage(buildProfilePrompt(articles)),
  ])
  const content = response.content
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .map((b) => (typeof b === "string" ? b : "text" in b ? b.text : ""))
            .join("")
        : ""
  return text.trim()
}
