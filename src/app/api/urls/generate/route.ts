import { createLLM } from "@/lib/llm"
import { getUrlOptions } from "@/lib/url-options"

export const runtime = "nodejs"

interface GenerateRequest {
  query: string
}

interface GenerateResult {
  url: string
  reason: string
}

const GENERATE_PROMPT = `你负责把用户对链接的自然语言描述解析为本站的具体 URL。
本站可用链接（label 与 url）如下：
{links}

规则：
1. 根据用户描述选择最匹配的站内链接，优先精确匹配 label 或语义内容。
2. 只有当你判断用户明确需要站外地址（例如包含完整域名 http/https）时，才返回外部 URL。
3. 必须只输出一个 JSON 对象，格式：{"url": "...", "reason": "简短的匹配原因"}

示例：
- "博客首页" -> {"url":"/blog","reason":"首页"}
- "最新一篇 React 文章" -> 选择 label 最接近的文章链接
- "分类 技术的列表页" -> {"url":"/blog/category/xxx","reason":"技术分类"}
- "查看全部" -> {"url":"/blog/archive","reason":"全部文章"}`

function extractJson(text: string): GenerateResult | null {
  try {
    const trimmed = text.trim()
    const fenced = trimmed.match(/\{[\s\S]*\}/)
    const raw = fenced ? fenced[0] : trimmed
    const parsed = JSON.parse(raw) as { url?: unknown; reason?: unknown }
    if (typeof parsed.url === "string" && parsed.url.trim()) {
      return { url: parsed.url.trim(), reason: String(parsed.reason ?? "") }
    }
  } catch {
    // fall through
  }
  return null
}

export async function POST(request: Request) {
  try {
    const { query } = (await request.json()) as GenerateRequest
    const q = query?.trim()
    if (!q) {
      return Response.json({ error: "请输入描述" }, { status: 400 })
    }

    const options = await getUrlOptions()
    const links = options
      .map((o) => `- ${o.label}（${o.url}）`)
      .join("\n")

    const prompt = GENERATE_PROMPT.replace("{links}", links)

    const llm = await createLLM(false)
    const response = await llm.invoke([
      { role: "system", content: prompt },
      { role: "user", content: `用户需求：${q}` },
    ])

    const text = typeof response.content === "string" ? response.content : JSON.stringify(response.content)
    const result = extractJson(text)

    if (!result) {
      return Response.json({ url: "", reason: "未能解析匹配结果" })
    }

    const linked = options.some((o) => o.url === result.url)
    if (!linked && !/^https?:\/\//i.test(result.url)) {
      return Response.json({ url: "", reason: "未能匹配到站内链接，请换个说法" })
    }

    return Response.json(result)
  } catch (error) {
    const msg = error instanceof Error ? error.message : "未知错误"
    return Response.json({ error: msg }, { status: 500 })
  }
}