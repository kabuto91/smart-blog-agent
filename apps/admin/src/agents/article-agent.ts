import { HumanMessage, SystemMessage } from "@langchain/core/messages"
import type { BaseMessage } from "@langchain/core/messages"

export type ArticleGenMode = "continue" | "generate"

export interface ArticleGenParams {
  title: string
  excerpt?: string
  content?: string
  instruction?: string
  mode: ArticleGenMode
  /** 是否同时生成标题与摘要（以 frontmatter 形式输出在正文前） */
  includeMeta?: boolean
  /** 作者画像：帮助保持一致的选题与写作风格（用户本次明确要求优先） */
  authorProfile?: string
}

export const ARTICLE_SYSTEM_PROMPT = `你是一位热爱写作、经验丰富的博客作者，用中文写文章时就像一个真人博主在跟读者面对面聊天：有观点、有温度、有幽默感，读起来自然流畅，而不是冷冰冰的机器腔。

【写作风格：要像真人】
1. 用口语化、接地气的表达，可以适当使用第一人称（我/我们）、反问、举例和设问，让读者感觉有人在分享经验，而不是在念教科书。
2. 句子长短错落有致，避免千篇一律的排比和三段式；段落之间过渡自然，不要机械地接「首先……其次……最后」。
3. 严禁 AI 腔套话：不要出现「在当今社会」「随着科技的不断发展」「众所周知」「综上所述」「总而言之」「不言而喻」这类陈词滥调。
4. 可以带一点个人色彩和观点倾向，敢于下判断、给态度，必要时自嘲或调侃一句，让文章有辨识度。

【结构要求】
1. 直接输出文章正文，使用标准 GitHub 风格 markdown。
2. 正文从二级标题（##）开始组织小节，不要输出文章大标题（#），文章标题由文章管理单独维护。
3. 合理使用分段、列表（- / 1.）、引用（>）、代码块等格式，让文章层次分明、可读性强，但不要为了排版而牺牲自然表达。

【其它】
1. 语言默认中文；如果用户要求使用其它语言或语气，请遵循用户要求。
2. 不要输出与文章内容无关的解释性文字、前言或结尾寒暄（但自然的、像真人一样的收尾句除外）。
3. 内容要完整、有干货、有深度，观点要落地，避免空洞的套话和重复。`

/**
 * 根据生成模式与输入信息构造 [System, Human] 消息序列。
 * - continue：在已有正文基础上续写/补全为完整文章（无正文时退化为全文生成）。
 * - generate：忽略旧正文，按标题 + 写作要求生成完整文章。
 */
export function buildArticleMessages(params: ArticleGenParams): BaseMessage[] {
  const mode = params.mode === "generate" ? "generate" : "continue"
  const parts: string[] = []

  if (params.title.trim()) {
    parts.push(`文章标题：${params.title.trim()}`)
  }
  if (params.excerpt?.trim()) {
    parts.push(`摘要（可作风格参考）：${params.excerpt.trim()}`)
  }
  if (params.instruction?.trim()) {
    parts.push(`写作要求/要点：\n${params.instruction.trim()}`)
  }
  if (params.authorProfile?.trim()) {
    parts.push(
      `【作者画像（保持一致的选题与写作风格，但以用户本次明确要求为准）】\n${params.authorProfile.trim()}`
    )
  }

  if (mode === "continue") {
    const content = params.content?.trim()
    if (content) {
      parts.push(
        `已有正文（请在其基础上续写/补全为完整文章，不要重复已有内容）：\n\`\`\`markdown\n${content}\n\`\`\``
      )
    } else {
      parts.push("当前正文为空，请根据以上信息直接生成一篇完整的文章。")
    }
  } else {
    parts.push("请根据以上信息生成一篇完整的文章（无需理会可能存在的旧正文）。")
  }

  if (params.includeMeta) {
    parts.push(
      `请在正文最开头输出如下 frontmatter 元信息（不要用代码块包裹），然后空一行再输出 markdown 正文：\n---\ntitle: 你建议的文章标题\nexcerpt: 一句话概括全文的摘要\n---`
    )
  }

  return [
    new SystemMessage(ARTICLE_SYSTEM_PROMPT),
    new HumanMessage(parts.join("\n\n")),
  ]
}
