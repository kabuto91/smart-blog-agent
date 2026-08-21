import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/db/client", () => ({ prisma: {} }))
vi.mock("@/lib/uploads", () => ({
  saveUpload: vi.fn(async () => ({ id: "mock" })),
  getUpload: vi.fn(),
}))
vi.mock("@/lib/theme/theme-session", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/theme/theme-session")>()
  return { ...mod, addMessage: vi.fn(async () => {}) }
})

import { AIMessage } from "@langchain/core/messages"
import type { BaseMessage } from "@langchain/core/messages"
import type { BaseChatModel } from "@langchain/core/language_models/chat_models"
import { addMessage } from "@/lib/theme/theme-session"
import { createThemeGraph, type ThemeGraphEmitter } from "./theme-graph"

const SKELETON = `<!DOCTYPE html><html><head><style>
:root {
  --nav-h: 64px;
  --bg: #f7f4ef;
  --main: #1a1a2e;
  --accent: #e5a83d;
  --card-bg: #fff;
  --radius: 8px;
  --shadow: 0 2px 8px rgba(0,0,0,.08);
}
body { background: var(--bg); color: var(--main); font-family: "Noto Serif SC", Georgia, serif; transition: background .3s; }
.container { max-width: 1080px; margin: 0 auto; }
.nav { display: flex; }
.post-card { border: 1px solid #eee; border-radius: var(--radius); box-shadow: var(--shadow); transition: box-shadow .2s, transform .2s; }
.post-card:hover { box-shadow: 0 4px 16px rgba(0,0,0,.12); transform: translateY(-2px); }
.hero { padding: 80px 0; }
.btn { display: inline-block; transition: background .2s; }
.btn:hover { background: var(--accent); }
.section-title { font-size: 28px; font-family: "Noto Serif SC", Georgia, serif; }
.page-title { font-size: 32px; }
.article-body { line-height: 1.8; }
.article-header { margin-bottom: 24px; }
.sidebar { width: 260px; }
.post-title { font-size: 24px; }
.avatar { width: 40px; height: 40px; border-radius: 50%; overflow: hidden; }
.article-list { display: grid; gap: 24px; }
@media (max-width: 768px) {
  .container { padding: 0 16px; }
  .hero { padding: 48px 0; }
}
</style></head><body>
<nav data-content="main-nav" data-content-type="nav-list"><a href="/blog">首页</a><a href="/blog/archive">全部文章</a></nav>
<div data-page-host=""></div>
<footer><ul data-content="footer-nav" data-content-type="nav-list"><li><a href="/blog">首页</a></li></ul></footer>
</body></html>`

const HOME = `<section class="hero" data-page-type="home">
  <h1 class="section-title" data-content="blog-title" data-content-type="text">我的博客</h1>
  <img class="avatar" data-content="author-avatar" data-content-type="text" src="" alt="作者头像">
</section>
<section class="container" data-page-type="home">
  <h2 class="section-title">近期文章</h2>
  <div class="article-list" data-content="article-list" data-content-type="dynamic-articles">
    <article class="post-card"><h3 data-map="title">示例</h3></article>
  </div>
</section>`

const LIST = `<section class="container">
  <h1 class="page-title" data-page-type="list">全部文章</h1>
  <div class="article-list" data-content="article-list" data-content-type="dynamic-articles">
    <article class="post-card"><h3 data-map="title">示例</h3></article>
  </div>
</section>`

const BAD_LIST = `<section class="alien-list">
  <h1 class="alien-title">全部文章</h1>
  <div class="alien-item">内容</div>
</section>`

const DETAIL = `<section class="container">
  <article class="article-body" data-content="article-body" data-content-type="article-body">
    <h2 class="post-title" data-map="title">标题</h2>
    <div data-map="body">正文</div>
  </article>
</section>`

function scriptedModel(failPage?: "list"): BaseChatModel {
  const invoke = async (messages: BaseMessage[]): Promise<AIMessage> => {
    const sys = String(messages[0]?.content ?? "")
    let text = ""
    if (sys.includes("设计总监")) {
      text = '{"style":"极简杂志","palette":"米白+黑+赭石","typography":"衬线标题","layout":"居中","image":"none","notes":""}'
    } else if (sys.includes("资深前端设计师")) {
      text = '{"dimensions":{"briefMatch":{"score":88,"issues":[]},"visualPolish":{"score":85,"issues":[]},"typography":{"score":82,"issues":[]},"color":{"score":80,"issues":[]},"layout":{"score":84,"issues":[]},"editability":{"score":86,"issues":[]}},"reason":"整体精致"}'
    } else if (sys.includes("任务分为两阶段")) {
      text = SKELETON
    } else if (sys.includes("博客首页")) {
      text = HOME
    } else if (sys.includes("文章列表页")) {
      text = failPage === "list" ? BAD_LIST : LIST
    } else if (sys.includes("文章详情页")) {
      text = DETAIL
    }
    return new AIMessage({ content: text })
  }
  return {
    invoke,
    bindTools: () => ({ invoke }),
  } as unknown as BaseChatModel
}

const input = (overrides: Record<string, unknown> = {}) => ({
  userRequest: "做一个极简风格的博客",
  conversationId: "conv-1",
  siteConfig: {},
  ...overrides,
})

const stages: string[] = []
const emitter: ThemeGraphEmitter = {
  stage: (stage) => stages.push(stage),
  tool: () => {},
  warn: () => {},
}

describe("createThemeGraph", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    stages.length = 0
  })

  it("首次生成：planner → skeleton → 并行三页 → validator → audit → judge → commit", async () => {
    const graph = await createThemeGraph({
      llm: scriptedModel(),
      emitter,
      judgeEnabled: true,
    })
    const res = await graph.invoke(input(), {
      configurable: { thread_id: "t-happy" },
    })

    expect(res.layoutHtml).toContain("data-page-host")
    expect(res.pages.home).toContain("hero")
    expect(res.pages.list).toContain("page-title")
    expect(res.pages.detail).toContain("article-body")
    expect(res.reviseCount).toBe(0)
    expect(res.validation.home?.ok).toBe(true)
    expect(res.validation.list?.ok).toBe(true)
    expect(res.validation.detail?.ok).toBe(true)
    expect(res.qualityScore).toBeGreaterThan(0)
    expect(Object.keys(res.qualityDimensions).length).toBeGreaterThan(0)

    expect(stages).toContain("planner")
    expect(stages).toContain("skeleton")
    expect(stages).toContain("validator")
    expect(stages).toContain("audit")
    expect(stages).toContain("judge")
    expect(stages).toContain("commit")

    expect(addMessage).toHaveBeenCalledTimes(1)
    const [conversationId, role, , , , pagesJson] = vi.mocked(addMessage).mock
      .calls[0]
    expect(conversationId).toBe("conv-1")
    expect(role).toBe("assistant")
    const savedPages = JSON.parse(pagesJson as string)
    expect(savedPages.home).toBeTruthy()
    expect(savedPages.list).toBeTruthy()
    expect(savedPages.detail).toBeTruthy()
  })

  it("校验失败自动进入 revise 修订，且不超过 maxAttempts", async () => {
    const graph = await createThemeGraph({
      llm: scriptedModel("list"),
      emitter,
      judgeEnabled: false,
      maxAttempts: 1,
    })
    const res = await graph.invoke(input(), {
      configurable: { thread_id: "t-retry" },
    })

    // list 始终不通过（类名与骨架零重叠），最多修订 1 轮后收敛
    expect(res.reviseCount).toBe(1)
    expect(res.validation.list?.ok).toBe(false)
    expect(res.pages.list).toContain("alien-list")
    expect(stages).toContain("revise")
    // 只对失败的页面触发修订
    expect(res.validation.home?.ok).toBe(true)
    expect(res.validation.detail?.ok).toBe(true)
  })

  it("迭代模式：已有骨架时仅重生成 targetPage", async () => {
    const graph = await createThemeGraph({
      llm: scriptedModel(),
      emitter,
      judgeEnabled: false,
    })
    const res = await graph.invoke(
      input({
        iteration: true,
        targetPage: "home",
        layoutHtml: SKELETON,
        pages: {
          home: "<div class=\"old-home\">旧首页</div>",
          list: LIST,
          detail: DETAIL,
        },
      }),
      { configurable: { thread_id: "t-iter" } }
    )

    expect(res.pages.home).toContain("hero")
    expect(res.pages.home).not.toContain("old-home")
    expect(res.pages.list).toBe(LIST)
    expect(res.pages.detail).toBe(DETAIL)
    expect(stages).not.toContain("skeleton")
    expect(stages).not.toContain("planner")
  })
})