import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/db/client", () => ({ prisma: {} }))
vi.mock("@/lib/uploads", () => ({ saveUpload: vi.fn(), getUpload: vi.fn() }))
vi.mock("@/lib/theme/theme-session", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/theme/theme-session")>()
  return { ...mod, addMessage: vi.fn(async () => {}) }
})

import { AIMessageChunk } from "@langchain/core/messages"
import type { BaseMessage } from "@langchain/core/messages"
import { BaseChatModel } from "@langchain/core/language_models/chat_models"
import type { BaseChatModelCallOptions } from "@langchain/core/language_models/chat_models"
import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager"
import { createThemeGraph } from "./theme-graph"

const SKELETON = `<!DOCTYPE html><html><head><style>
:root { --nav-h:64px; --bg:#f7f4ef; --main:#1a1a2e; --accent:#e5a83d; --radius:8px; --shadow:0 2px 8px rgba(0,0,0,.08); }
body { background:var(--bg); color:var(--main); font-family:"Noto Serif SC",Georgia,serif; transition:background .3s; }
.container{max-width:1080px;margin:0 auto}.post-card{border:1px solid #eee;border-radius:var(--radius);box-shadow:var(--shadow);transition:box-shadow .2s,transform .2s}.post-card:hover{box-shadow:0 4px 16px rgba(0,0,0,.12)}.hero{padding:80px 0}.section-title{font-size:28px}.page-title{font-size:32px}.article-body{line-height:1.8}.article-list{display:grid;gap:24px}.post-title{font-size:24px}
@media(max-width:768px){.container{padding:0 16px}.hero{padding:48px 0}}
</style></head><body>
<nav data-content="main-nav" data-content-type="nav-list"><a href="/blog">首页</a></nav>
<div data-page-host=""></div>
<footer><ul data-content="footer-nav" data-content-type="nav-list"><li><a href="/blog">首页</a></li></ul></footer>
</body></html>`
const HOME = `<section class="hero" data-page-type="home"><h1 class="section-title">我的博客</h1></section>`
const LIST = `<section class="container"><h1 class="page-title">全部文章</h1><div class="article-list" data-content="article-list" data-content-type="dynamic-articles"><article class="post-card"><h3 data-map="title">示例</h3></article></div></section>`
const DETAIL = `<section class="container"><article class="article-body"><h2 class="post-title">标题</h2><div data-map="body">正文</div></article></section>`

function contentFor(sys: string): string {
  if (sys.includes("设计总监")) return '{"style":"极简杂志","palette":"米白+黑"}'
  if (sys.includes("资深前端设计师")) return '{"dimensions":{"briefMatch":{"score":85,"issues":[]},"visualPolish":{"score":80,"issues":[]},"typography":{"score":78,"issues":[]},"color":{"score":82,"issues":[]},"layout":{"score":80,"issues":[]},"editability":{"score":85,"issues":[]}},"reason":"ok"}'
  if (sys.includes("任务分为两阶段")) return SKELETON
  if (sys.includes("博客首页")) return HOME
  if (sys.includes("文章列表页")) return LIST
  if (sys.includes("文章详情页")) return DETAIL
  return ""
}

/**
 * 流式脚本化模型：输出由系统提示词决定，并通过 handleLLMNewToken 触发
 * graph 的 messages-mode 流式回调（真实路由依赖该契约）。
 */
class StreamingScriptedModel extends BaseChatModel<BaseChatModelCallOptions> {
  constructor() {
    super({})
  }

  _llmType(): string {
    return "scripted-streaming"
  }

  bindTools(): this {
    return this
  }

  async _generate(
    messages: BaseMessage[],
    _options: BaseChatModelCallOptions,
    runManager?: CallbackManagerForLLMRun
  ) {
    const sys = String(messages[0]?.content ?? "")
    const text = contentFor(sys)

    await runManager?.handleLLMNewToken(text)
    return {
      generations: [
        {
          text,
          message: new AIMessageChunk({ content: text }),
        },
      ],
    }
  }
}

const input = () => ({
  userRequest: "做一个极简风格的博客",
  conversationId: "conv-stream",
  siteConfig: {},
})

describe("createThemeGraph 流式契约", () => {
  it("messages-mode 流能按节点产出 token，元数据携带 langgraph_node", async () => {
    const graph = await createThemeGraph({
      llm: new StreamingScriptedModel(),
      judgeEnabled: false,
    })
    const textByNode: Record<string, string> = {}
    const nodesSeen = new Set<string>()

    const iterable = await graph.stream(input(), {
      streamMode: "messages",
      configurable: { thread_id: "stream-happy" },
    })
    for await (const event of iterable) {
      const [chunk, metadata] = event as [
        BaseMessage,
        { langgraph_node?: string },
      ]
      if (chunk._getType() !== "ai") continue
      const node = metadata?.langgraph_node ?? "unknown"
      nodesSeen.add(node)
      const content = chunk.content
      if (typeof content === "string") textByNode[node] = (textByNode[node] ?? "") + content
    }

    // 骨架与三页的 token 都出现在流中
    expect(textByNode.skeleton).toBe(SKELETON)
    expect(textByNode.page_home).toBe(HOME)
    expect(textByNode.page_list).toBe(LIST)
    expect(textByNode.page_detail).toBe(DETAIL)
    for (const node of ["planner", "skeleton", "page_home", "page_list", "page_detail"]) {
      expect(nodesSeen.has(node)).toBe(true)
    }
  })
})