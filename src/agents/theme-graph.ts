import {
  StateGraph,
  Annotation,
  START,
  END,
  Send,
  Command,
  MemorySaver,
} from "@langchain/langgraph"
import { ToolNode } from "@langchain/langgraph/prebuilt"
import { SystemMessage, HumanMessage } from "@langchain/core/messages"
import type { BaseMessage, AIMessageChunk } from "@langchain/core/messages"
import type { BaseChatModel } from "@langchain/core/language_models/chat_models"
import { createLLM } from "@/lib/llm/client"
import { extractContentConfig } from "@/lib/theme/content-extractor"
import { ensureAvatarOverflow } from "@/lib/theme/content-renderer"
import {
  sanitizePageFragment,
  ensureLayoutContract,
  collectThemeClasses,
  validatePageFragment,
  type PageFragmentIssue,
} from "@/lib/theme/theme-splitter"
import { addMessage } from "@/lib/theme/theme-session"
import { searchImageTool } from "@/agents/tools/image-search"
import {
  PAGE_TYPES,
  SKELETON_SYSTEM_PROMPT,
  buildPageSystemPrompt,
  buildPagePromptContext,
  extractHtmlFromContent,
  pageTypeLabel,
  type ThemePageType,
} from "@/agents/theme-agent"

/** SSE 事件里下发的阶段名。 */
export type ThemeStage =
  | "planner"
  | "skeleton"
  | "pages"
  | "page_home"
  | "page_list"
  | "page_detail"
  | "validator"
  | "judge"
  | "revise"
  | "commit"

/** 单次生成的运行指标（各阶段耗时/轮次/质量分）。 */
export interface ThemeMetrics {
  /** 各阶段累计耗时（ms），跨多轮修订会累加。 */
  stages: Record<string, number>
  /** 整个生成流程总耗时（ms）。 */
  totalMs: number
  reviseCount: number
  pageCount: number
  qualityScore: number
  iteration: boolean
}

export interface ThemeGraphEmitter {
  stage: (
    stage: ThemeStage,
    label?: string,
    status?: "start" | "done",
    detail?: string
  ) => void
  tool: (page: string, name: string, args: unknown) => void
  warn: (message: string) => void
  /** 生成结束时下发运行指标。 */
  metrics?: (metrics: ThemeMetrics) => void
}

export interface ThemeGraphOptions {
  /** 传入 LLM 以便测试注入；默认 createLLM(true)。 */
  llm?: BaseChatModel
  emitter?: ThemeGraphEmitter
  /** 是否运行 LLM 质量评估节点。 */
  judgeEnabled?: boolean
  /** 质量分阈值，低于则触发一次修订。 */
  scoreThreshold?: number
  /** 最多修订轮数（默认 1）。 */
  maxAttempts?: number
}

export interface ThemeGraphInput {
  userRequest: string
  conversationId: string
  /** 是否迭代模式（已有骨架，仅重生成 targetPage）。 */
  iteration?: boolean
  targetPage?: string
  /** 已有布局快照（迭代/整体重生成时的上下文）。 */
  layoutHtml?: string
  prevLayout?: string
  pages?: Record<string, string>
  contentConfig?: string
  siteConfig?: Record<string, string>
}

export type PageValidation = PageFragmentIssue

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const last = <T>(defaultValue: () => T) =>
  Annotation<T>({ reducer: (_left, right: T) => right, default: defaultValue })

const ThemeStateAnnotation = Annotation.Root({
  userRequest: Annotation<string>({ reducer: (_l, r) => r, default: () => "" }),
  conversationId: Annotation<string>({ reducer: (_l, r) => r, default: () => "" }),
  iteration: last<boolean>(() => false),
  targetPage: last<string>(() => "skeleton"),
  prevLayout: last<string>(() => ""),
  siteConfig: last<Record<string, string>>(() => ({})),

  designBrief: last<string>(() => ""),
  layoutHtml: last<string>(() => ""),
  contentConfig: last<string>(() => ""),

  /** 本次参与生成的页面类型集合（由 dispatch/revise 下发）。 */
  activePages: last<ThemePageType[]>(() => []),

  pages: Annotation<Record<string, string>>({
    reducer: (left, right) => ({ ...left, ...right }),
    default: () => ({}),
  }),
  pageConfigs: Annotation<Record<string, string>>({
    reducer: (left, right) => ({ ...left, ...right }),
    default: () => ({}),
  }),
  validation: Annotation<Record<string, PageValidation>>({
    reducer: (left, right) => ({ ...left, ...right }),
    default: () => ({}),
  }),
  feedback: Annotation<Record<string, string>>({
    reducer: (left, right) => ({ ...left, ...right }),
    default: () => ({}),
  }),
  reviseCount: last<number>(() => 0),
  qualityScore: last<number>(() => 0),
  qualityReason: last<string>(() => ""),
})

type GraphState = typeof ThemeStateAnnotation.State

// ---------------------------------------------------------------------------
// 工具 loop：模型调用 + 工具回流，token 经 callbacks 进入 graph 的 messages 流
// ---------------------------------------------------------------------------

interface AgentModel {
  invoke: (messages: BaseMessage[]) => Promise<AIMessageChunk>
}

function bindTools(
  llm: BaseChatModel,
  tools: unknown[]
): AgentModel {
  if (!llm.bindTools) throw new Error("LLM 不支持工具绑定")
  return llm.bindTools(tools as never) as unknown as AgentModel
}

async function runAgenticLoop(
  model: AgentModel,
  toolNode: ToolNode,
  messages: BaseMessage[],
  pageKey: string,
  emitter?: ThemeGraphEmitter
): Promise<BaseMessage[]> {
  const MAX_TOOL_ROUNDS = 3
  let current = messages
  for (let i = 0; i < MAX_TOOL_ROUNDS; i++) {
    const response = await model.invoke(current)
    const toolCalls = response.tool_calls ?? []
    if (toolCalls.length === 0) return [...current, response]
    for (const tc of toolCalls) {
      emitter?.tool(pageKey, tc.name, tc.args)
    }
    const toolResults = await toolNode.invoke([response])
    current = [...current, response, ...toolResults]
  }
  return current
}

function messageText(msg: BaseMessage | undefined): string {
  if (!msg) return ""
  const content = msg.content
  if (typeof content === "string") return content
  return Array.isArray(content)
    ? content
        .map((b) => (typeof b === "string" ? b : "text" in b ? b.text : ""))
        .join("")
    : ""
}

// ---------------------------------------------------------------------------
// 节点
// ---------------------------------------------------------------------------

interface NodeContext {
  llm: BaseChatModel
  emitter?: ThemeGraphEmitter
  judgeEnabled: boolean
  scoreThreshold: number
  maxAttempts: number
  /** 本次运行的起始时间戳。 */
  runStartedAt: number
  /** 各阶段累计耗时（ms）。 */
  stageDurations: Record<string, number>
  /** 在 commit 结束时上报运行指标。 */
  emitMetrics: (metrics: ThemeMetrics) => void
}

/** planner：从用户需求提炼简短设计简报，统一指导骨架与各页，保证视觉一致。 */
function makePlannerNode(ctx: NodeContext) {
  return async function plannerNode(state: GraphState) {
    if (state.iteration) return {}
    ctx.emitter?.stage("planner", "规划设计方向", "start")
    const brief = await generateDesignBrief(ctx.llm, state.userRequest)
    ctx.emitter?.stage("planner", "规划设计方向", "done", brief)
    return { designBrief: brief }
  }
}

async function generateDesignBrief(
  llm: BaseChatModel,
  userRequest: string
): Promise<string> {
  const messages = [
    new SystemMessage(
      `你是一个博客主题设计总监。从用户需求中提炼一份简短的设计简报，用于统一指导后续的主题骨架与三个页面生成，保证风格一致。
只输出一个 JSON 对象，不要其它内容，格式：
{"style":"美学方向（如：极简杂志风/复古未来/日式侘寂/工业实用）","palette":"主色+点缀色（用中文描述，不输出色值）","typography":"标题与正文字体风格","layout":"页面布局倾向（如：左导航右内容/居中单栏）","image":"是否需要图片素材及用途（如：hero背景/文章缩略图，不需要则写 none）","notes":"其它要点（50字内）"}
如果用户已给出明确风格，直接提炼；否则选择你认为合适的方向。`
    ),
    new HumanMessage(`用户需求：${userRequest}`),
  ]
  try {
    const response = await llm.invoke(messages)
    const text = messageText(response).trim()
    const fenced = text.match(/\{[\s\S]*\}/)
    const raw = fenced ? fenced[0] : text
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const brief = [
      parsed.style && `风格：${parsed.style}`,
      parsed.palette && `配色：${parsed.palette}`,
      parsed.typography && `字体：${parsed.typography}`,
      parsed.layout && `布局：${parsed.layout}`,
      parsed.image && parsed.image !== "none" && `配图：${parsed.image}`,
      parsed.notes && `要点：${parsed.notes}`,
    ]
      .filter(Boolean)
      .join("\n")
    return brief || ""
  } catch {
    return ""
  }
}

/** skeleton：产出共享布局（head 样式 + 导航 + 页脚 + data-page-host）。 */
function makeSkeletonNode(ctx: NodeContext) {
  return async function skeletonNode(state: GraphState) {
    ctx.emitter?.stage("skeleton", "生成主题骨架", "start")
    const model = bindTools(ctx.llm, [searchImageTool])
    const toolNode = new ToolNode([searchImageTool])

    let userContent = state.userRequest
    if (state.designBrief) userContent += `\n\n【设计简报】\n${state.designBrief}`
    if (state.prevLayout) {
      userContent += `\n\n【之前的骨架（保持其风格，按新需求调整）】\n\`\`\`html\n${state.prevLayout}\n\`\`\``
    }

    const messages = await runAgenticLoop(
      model,
      toolNode,
      [new SystemMessage(SKELETON_SYSTEM_PROMPT), new HumanMessage(userContent)],
      "skeleton",
      ctx.emitter
    )
    const html = extractHtmlFromContent(messageText(messages[messages.length - 1]))
    if (!html) throw new Error("骨架生成失败：未能提取 HTML")
    const layoutHtml = ensureAvatarOverflow(ensureLayoutContract(html))
    const layoutConfigJson = JSON.stringify(
      extractContentConfig(layoutHtml, state.siteConfig).contentConfig
    )
    ctx.emitter?.stage("skeleton", "生成主题骨架", "done")
    return { layoutHtml, contentConfig: layoutConfigJson }
  }
}

/**
 * Send 的 payload 就是子节点的完整 state 视图（task.input = packet.args）。
 * 因此必须把 page 节点需要的上下文一并下发，否则子节点读不到父状态。
 */
function buildPagePayload(
  state: GraphState,
  feedback?: Record<string, string>
): Record<string, unknown> {
  return {
    userRequest: state.userRequest,
    conversationId: state.conversationId,
    siteConfig: state.siteConfig,
    designBrief: state.designBrief,
    layoutHtml: state.layoutHtml,
    pages: state.pages,
    feedback: feedback ?? state.feedback,
  }
}

/** dispatch：把要生成的页面类型 fan-out 到各 page_* 子节点（LangGraph Send）。 */
function makeDispatchNode(ctx: NodeContext) {
  return async function dispatchPagesNode(state: GraphState) {
    const pageTypes: ThemePageType[] =
      state.iteration && state.targetPage !== "skeleton"
        ? ([state.targetPage] as ThemePageType[])
        : PAGE_TYPES
    ctx.emitter?.stage("pages", "并行生成页面正文", "start")
    for (const pt of pageTypes) {
      ctx.emitter?.stage(`page_${pt}`, `生成${pageTypeLabel(pt)}`, "start")
    }
    return pageTypes.map((pt) =>
      new Command({
        update: { activePages: pageTypes },
        goto: new Send(`page_${pt}`, buildPagePayload(state)),
      })
    )
  }
}

/** 生成单个页面正文（带工具 + 校验回退上下文）。 */
function makePageNode(pageType: ThemePageType, ctx: NodeContext) {
  return async function pageNode(state: GraphState) {
    const context = buildPagePromptContext(
      ensureLayoutContract(state.layoutHtml),
      pageType
    )
    let userContent = state.userRequest
    if (state.designBrief) userContent += `\n\n【设计简报】\n${state.designBrief}`
    const prevHtml = state.pages[pageType]
    if (prevHtml) {
      userContent += `\n\n当前「${pageTypeLabel(pageType)}」正文状态：\n\`\`\`html\n${prevHtml}\n\`\`\``
    }
    const feedback = state.feedback[pageType]
    if (feedback) {
      userContent += `\n\n【上一轮校验反馈，必须修复】\n${feedback}`
    }

    const model = bindTools(ctx.llm, [searchImageTool])
    const toolNode = new ToolNode([searchImageTool])
    const messages = await runAgenticLoop(
      model,
      toolNode,
      [
        new SystemMessage(buildPageSystemPrompt(pageType, context)),
        new HumanMessage(userContent),
      ],
      pageType,
      ctx.emitter
    )

    const rawText = messageText(messages[messages.length - 1])
    let html = extractHtmlFromContent(rawText)
    if (!html) html = rawText
    html = ensureAvatarOverflow(html)
    const result = extractContentConfig(html, state.siteConfig)
    const fragment = sanitizePageFragment(result.htmlTemplate)

    ctx.emitter?.stage(`page_${pageType}`, `生成${pageTypeLabel(pageType)}`, "done")
    return {
      pages: { [pageType]: fragment },
      pageConfigs: { [pageType]: JSON.stringify(result.contentConfig) },
    }
  }
}

/** validator：对本次生成页面做骨架一致性校验，产出 issues 与类名重叠率。 */
function makeValidatorNode(ctx: NodeContext) {
  return async function validatorNode(state: GraphState) {
    ctx.emitter?.stage("validator", "校验页面与骨架一致性", "start")
    const layoutClasses = collectThemeClasses(state.layoutHtml)
    const validation: Record<string, PageValidation> = {}
    for (const pt of state.activePages) {
      const html = state.pages[pt]
      if (!html) continue
      const issue = validatePageFragment(sanitizePageFragment(html), layoutClasses)
      validation[pt] = issue
      if (!issue.ok) {
        ctx.emitter?.warn(
          `「${pageTypeLabel(pt)}」存在样式一致性风险（${issue.issues.join("；")}）`
        )
      }
    }
    const invalidCount = Object.values(validation).filter((v) => !v.ok).length
    ctx.emitter?.stage(
      "validator",
      "校验页面与骨架一致性",
      "done",
      invalidCount > 0 ? `${invalidCount} 处风险` : "全部通过"
    )
    return { validation }
  }
}

/** judge：可选 LLM 质量评估，产出 0-100 分。 */
function makeJudgeNode(ctx: NodeContext) {
  return async function judgeNode(state: GraphState) {
    if (!ctx.judgeEnabled) return {}
    ctx.emitter?.stage("judge", "评估设计质量", "start")
    const { score, reason } = await judgeQuality(
      ctx.llm,
      state.userRequest,
      state.layoutHtml,
      state.pages
    )
    ctx.emitter?.stage("judge", "评估设计质量", "done", `${score} 分`)
    return { qualityScore: score, qualityReason: reason }
  }
}

async function judgeQuality(
  llm: BaseChatModel,
  userRequest: string,
  layoutHtml: string,
  pages: Record<string, string>
): Promise<{ score: number; reason: string }> {
  const pagePreview = PAGE_TYPES.map(
    (pt) => `【${pageTypeLabel(pt)}】\n${(pages[pt] ?? "").slice(0, 1500)}`
  ).join("\n\n")
  const messages = [
    new SystemMessage(
      `你是资深前端设计师与博客产品评审。请基于用户需求评估生成的主题质量，只输出一个 JSON 对象：
{"score":0到100的整数,"reason":"一句话理由"}
评分维度：1) 是否符合用户需求与设计简报；2) 视觉精致度与"AI 感"程度（避免平淡）；3) 排版/配色/层次是否专业；4) 是否满足博客可编辑性（data-content 标记、动态列表模板）。`
    ),
    new HumanMessage(
      `【用户需求】\n${userRequest}\n\n【共享骨架（节选）】\n${layoutHtml.slice(0, 2000)}\n\n【各页面正文】\n${pagePreview}`
    ),
  ]
  try {
    const response = await llm.invoke(messages)
    const text = messageText(response).trim()
    const fenced = text.match(/\{[\s\S]*\}/)
    const raw = fenced ? fenced[0] : text
    const parsed = JSON.parse(raw) as { score?: unknown; reason?: unknown }
    const score = Number(parsed.score)
    if (Number.isFinite(score)) {
      return { score, reason: String(parsed.reason ?? "") }
    }
  } catch {
    // 评估失败时返回中性分数，不阻断流程
  }
  return { score: 100, reason: "" }
}

/** revise：对未通过校验的页面重新生成（把校验反馈写回 prompt）。 */
function makeReviseNode(ctx: NodeContext) {
  return async function reviseNode(state: GraphState) {
    const failing = state.activePages.filter(
      (pt) => state.validation[pt] && !state.validation[pt].ok
    )
    const qualityLow =
      ctx.judgeEnabled &&
      state.qualityScore > 0 &&
      state.qualityScore < ctx.scoreThreshold
    const targets =
      failing.length > 0 ? failing : qualityLow ? PAGE_TYPES : []
    if (targets.length === 0) return {}

    const next = state.reviseCount + 1
    const nextFeedback: Record<string, string> = {}
    for (const pt of targets) {
      nextFeedback[pt] = buildFeedback(state.validation[pt], state.qualityReason)
    }
    ctx.emitter?.stage(
      "revise",
      `修订 ${targets.length} 个页面`,
      "start",
      `${failing.length} 处校验风险${qualityLow ? "，质量分偏低" : ""}`
    )
    for (const pt of targets) {
      ctx.emitter?.stage(`page_${pt}`, `重新生成${pageTypeLabel(pt)}`, "start")
    }
    return targets.map((pt) =>
      new Command({
        update: {
          activePages: targets,
          reviseCount: next,
          feedback: nextFeedback,
        },
        goto: new Send(
          `page_${pt}`,
          buildPagePayload(state, { ...state.feedback, ...nextFeedback })
        ),
      })
    )
  }
}

function buildFeedback(
  validation?: PageValidation,
  qualityReason?: string
): string {
  const parts: string[] = []
  if (validation && validation.issues.length > 0) {
    parts.push("页面与骨架视觉契约不一致：")
    for (const issue of validation.issues) {
      parts.push(`- ${issue}`)
    }
  }
  if (qualityReason) {
    parts.push(`质量评估意见：${qualityReason}`)
  }
  if (parts.length === 0) {
    parts.push("请重新生成，确保与骨架视觉语言完全一致。")
  }
  return parts.join("\n")
}

/** commit：把最终骨架/页面快照持久化到会话。 */
function makeCommitNode(ctx: NodeContext) {
  return async function commitNode(state: GraphState) {
    ctx.emitter?.stage("commit", "保存会话快照", "start")
    const layoutForMerge = ensureAvatarOverflow(
      ensureLayoutContract(state.layoutHtml)
    )
    const layoutConfigJson = JSON.stringify(
      extractContentConfig(layoutForMerge, state.siteConfig).contentConfig
    )
    await addMessage(
      state.conversationId,
      "assistant",
      state.iteration ? state.userRequest : "已生成主题骨架与三个页面",
      layoutForMerge,
      layoutConfigJson,
      JSON.stringify(state.pages),
      JSON.stringify({
        stages: ctx.stageDurations,
        totalMs: Date.now() - ctx.runStartedAt,
        reviseCount: state.reviseCount,
        pageCount: PAGE_TYPES.filter((pt) => state.pages[pt]).length,
        qualityScore: state.qualityScore,
        iteration: state.iteration,
      })
    )
    ctx.emitMetrics({
      stages: ctx.stageDurations,
      totalMs: Date.now() - ctx.runStartedAt,
      reviseCount: state.reviseCount,
      pageCount: PAGE_TYPES.filter((pt) => state.pages[pt]).length,
      qualityScore: state.qualityScore,
      iteration: state.iteration,
    })
    ctx.emitter?.stage("commit", "保存会话快照", "done")
    return { layoutHtml: layoutForMerge, contentConfig: layoutConfigJson }
  }
}

// ---------------------------------------------------------------------------
// 图构建
// ---------------------------------------------------------------------------

/**
 * 主题生成的多节点图：
 * START → (迭代? dispatch : planner→skeleton) → dispatch(Send fan-out) → page_* → validator
 *   → 未通过→revise(Send)→page_* → validator …
 *   → 通过→(可选 judge→低于阈值→revise) → commit → END
 */
export async function createThemeGraph(
  options: ThemeGraphOptions = {}
) {
  const llm = options.llm ?? (await createLLM(true))

  // 阶段耗时采集：包装 emitter，start/done 之间累计各阶段耗时。
  const runStartedAt = Date.now()
  const stageDurations: Record<string, number> = {}
  const stageStartedAt: Record<string, number> = {}
  const emitter: ThemeGraphEmitter | undefined = options.emitter
    ? {
        stage: (stage, label, status, detail) => {
          if (status === "start") {
            stageStartedAt[stage] = Date.now()
          } else if (status === "done" && stageStartedAt[stage] !== undefined) {
            stageDurations[stage] =
              (stageDurations[stage] ?? 0) + (Date.now() - stageStartedAt[stage])
          }
          options.emitter?.stage(stage, label, status, detail)
        },
        tool: (page, name, args) => options.emitter?.tool(page, name, args),
        warn: (message) => options.emitter?.warn(message),
        metrics: (metrics) => options.emitter?.metrics?.(metrics),
      }
    : undefined

  const ctx: NodeContext = {
    llm,
    emitter,
    judgeEnabled: options.judgeEnabled ?? true,
    scoreThreshold: options.scoreThreshold ?? 60,
    maxAttempts: options.maxAttempts ?? 1,
    runStartedAt,
    stageDurations,
    emitMetrics: (metrics) => emitter?.metrics?.(metrics),
  }

  const routeFromStart = (state: GraphState): string => {
    if (state.iteration && state.targetPage !== "skeleton") return "dispatch_pages"
    return "planner"
  }

  const shouldReviseAfterValidation = (state: GraphState): string => {
    const hasInvalid = state.activePages.some(
      (pt) => state.validation[pt] && !state.validation[pt].ok
    )
    if (hasInvalid && state.reviseCount < ctx.maxAttempts) return "revise"
    return ctx.judgeEnabled ? "judge" : "commit"
  }

  const shouldReviseAfterJudge = (state: GraphState): string => {
    const low =
      state.qualityScore > 0 && state.qualityScore < ctx.scoreThreshold
    if (low && state.reviseCount < ctx.maxAttempts) return "revise"
    return "commit"
  }

  const graph = new StateGraph(ThemeStateAnnotation)
    .addNode("planner", makePlannerNode(ctx))
    .addNode("skeleton", makeSkeletonNode(ctx))
    .addNode("dispatch_pages", makeDispatchNode(ctx), {
      ends: ["page_home", "page_list", "page_detail"],
    })
    .addNode("page_home", makePageNode("home", ctx))
    .addNode("page_list", makePageNode("list", ctx))
    .addNode("page_detail", makePageNode("detail", ctx))
    .addNode("validator", makeValidatorNode(ctx))
    .addNode("judge", makeJudgeNode(ctx))
    .addNode("revise", makeReviseNode(ctx), {
      ends: ["page_home", "page_list", "page_detail"],
    })
    .addNode("commit", makeCommitNode(ctx))

  graph
    .addConditionalEdges(START, routeFromStart, {
      planner: "planner",
      dispatch_pages: "dispatch_pages",
    })
    .addEdge("planner", "skeleton")
    .addEdge("skeleton", "dispatch_pages")
    .addEdge("page_home", "validator")
    .addEdge("page_list", "validator")
    .addEdge("page_detail", "validator")
    .addConditionalEdges("validator", shouldReviseAfterValidation, {
      revise: "revise",
      judge: "judge",
      commit: "commit",
    })
    .addConditionalEdges("judge", shouldReviseAfterJudge, {
      revise: "revise",
      commit: "commit",
    })
    .addEdge("commit", END)

  return graph.compile({ checkpointer: new MemorySaver() })
}

export type ThemeGraph = Awaited<ReturnType<typeof createThemeGraph>>