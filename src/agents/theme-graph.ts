import {
  StateGraph,
  Annotation,
  START,
  END,
  Send,
  Command,
  MemorySaver,
} from "@langchain/langgraph"
import { SystemMessage, HumanMessage } from "@langchain/core/messages"
import type { BaseMessage } from "@langchain/core/messages"
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
import {
  analyzeSkeletonStyles,
  extractCssFromLayout,
  stripStyleTags,
  collectElementClasses,
  type StyleAuditReport,
} from "@/lib/theme/style-analyzer"
import { addMessage } from "@/lib/theme/theme-session"
import {
  PAGE_TYPES,
  SKELETON_SYSTEM_PROMPT,
  buildPageSystemPrompt,
  buildPagePromptContext,
  extractHtmlFromContent,
  pageTypeLabel,
  rollDesignSeeds,
  RHYTHM_LABELS,
  type DesignSeeds,
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
  | "audit"
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

/** 单个评分维度的结论。 */
export interface DimensionVerdict {
  /** 0-100 */
  score: number
  /** 具体可执行的修改建议（直接用于指导修订） */
  issues: string[]
}

/** judge 六维评分权重（权重合计为 1）。 */
const JUDGE_DIMENSIONS: { key: string; label: string; weight: number }[] = [
  { key: "briefMatch", label: "需求契合", weight: 0.2 },
  { key: "visualPolish", label: "视觉精致度", weight: 0.25 },
  { key: "typography", label: "排版字体", weight: 0.15 },
  { key: "color", label: "配色体系", weight: 0.15 },
  { key: "layout", label: "布局层次", weight: 0.1 },
  { key: "editability", label: "可编辑性", weight: 0.15 },
]

/** 归属骨架设计系统（而非单个页面）的维度：低分触发骨架级修订。 */
const SKELETON_DIMENSION_KEYS = ["visualPolish", "typography", "color"]

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
  /** 静态样式审计结果（audit 节点产出）。 */
  styleAudit: last<StyleAuditReport>(() => ({
    skeletonIssues: [],
    warnings: [],
    pageIssues: {},
  })),
  /** judge 的分维度评分。 */
  qualityDimensions: last<Record<string, DimensionVerdict>>(() => ({})),
  /** 骨架级修订反馈（样式体系不达标时下发给 skeleton 节点）。 */
  skeletonFeedback: last<string>(() => ""),
})

type GraphState = typeof ThemeStateAnnotation.State

// ---------------------------------------------------------------------------
// 工具 loop：模型调用 + 工具回流，token 经 callbacks 进入 graph 的 messages 流
// ---------------------------------------------------------------------------

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
    const seeds = rollDesignSeeds()
    const brief = await generateDesignBrief(ctx.llm, state.userRequest, seeds)
    ctx.emitter?.stage("planner", "规划设计方向", "done", brief)
    return { designBrief: brief }
  }
}

async function generateDesignBrief(
  llm: BaseChatModel,
  userRequest: string,
  seeds: DesignSeeds
): Promise<string> {
  const messages = [
    new SystemMessage(
      `你是一个博客主题设计总监。从用户需求中提炼一份简短的设计简报，用于统一指导后续的主题骨架与三个页面生成，保证风格一致。
只输出一个 JSON 对象，不要其它内容，格式：
{"style":"美学方向（如：极简杂志风/复古未来/日式侘寂/工业实用）","palette":"主色+点缀色（用中文描述，不输出色值）","typography":"标题与正文字体风格","layout":"页面布局倾向（如：左导航右内容/居中单栏）","image":"是否需要图片素材及用途（如：hero背景/文章缩略图，不需要则写 none）","notes":"其它要点（50字内）"}
如果用户已给出明确风格，直接提炼；否则以【随机设计方向种子】为基准展开细化。`
    ),
    new HumanMessage(
      `用户需求：${userRequest}

【随机设计方向种子】
本次必须以此组合为基础展开细化（仅当用户需求中已明确指定某维度的方向时，才用用户的覆盖对应维度，其余维度必须遵循种子）：
美学方向：${seeds.aesthetic}
布局原型：${seeds.layout}
配色策略：${seeds.palette}
标题排版：${seeds.typography}
节奏档位：${RHYTHM_LABELS[seeds.rhythm]}`
    ),
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
      `节奏：${RHYTHM_LABELS[seeds.rhythm]}`,
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

    let userContent = state.userRequest
    if (state.designBrief) userContent += `\n\n【设计简报】\n${state.designBrief}`
    if (state.prevLayout) {
      userContent += `\n\n【之前的骨架（保持其风格，按新需求调整）】\n\`\`\`html\n${state.prevLayout}\n\`\`\``
    }
    if (state.skeletonFeedback) {
      userContent += `\n\n【上一轮样式审计/评审反馈，必须修复】\n${state.skeletonFeedback}`
    }

    const response = await ctx.llm.invoke([
      new SystemMessage(SKELETON_SYSTEM_PROMPT),
      new HumanMessage(userContent),
    ])
    const html = extractHtmlFromContent(messageText(response))
    if (!html) throw new Error("骨架生成失败：未能提取 HTML")
    const layoutHtml = ensureAvatarOverflow(ensureLayoutContract(html))
    const layoutConfigJson = JSON.stringify(
      extractContentConfig(layoutHtml, state.siteConfig).contentConfig
    )
    ctx.emitter?.stage("skeleton", "生成主题骨架", "done")
    return { layoutHtml, contentConfig: layoutConfigJson }
  }
}

/** 骨架级修订时下发给 skeleton 节点的完整上下文（Send 的 args 即节点输入）。 */
function buildSkeletonPayload(
  state: GraphState,
  overrides?: { prevLayout?: string; skeletonFeedback?: string }
): Record<string, unknown> {
  return {
    userRequest: state.userRequest,
    conversationId: state.conversationId,
    siteConfig: state.siteConfig,
    designBrief: state.designBrief,
    prevLayout: overrides?.prevLayout ?? state.prevLayout,
    skeletonFeedback: overrides?.skeletonFeedback ?? state.skeletonFeedback,
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

    const response = await ctx.llm.invoke([
      new SystemMessage(buildPageSystemPrompt(pageType, context)),
      new HumanMessage(userContent),
    ])

    const rawText = messageText(response)
    let html = extractHtmlFromContent(rawText)
    if (!html) html = rawText
    html = ensureAvatarOverflow(html)
    const result = extractContentConfig(html, state.siteConfig)
    const fragment = sanitizePageFragment(
      result.htmlTemplate,
      collectThemeClasses(state.layoutHtml)
    )

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
      const issue = validatePageFragment(
        sanitizePageFragment(html, layoutClasses),
        layoutClasses
      )
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

/** audit：静态样式审计（纯代码规则检查），error 级问题将驱动修订。 */
function makeAuditNode(ctx: NodeContext) {
  return async function auditNode(state: GraphState) {
    ctx.emitter?.stage("audit", "静态样式审计", "start")
    const auditedPages: Record<string, string> = {}
    for (const pt of state.activePages) {
      if (state.pages[pt]) auditedPages[pt] = state.pages[pt]
    }
    const report = analyzeSkeletonStyles(state.layoutHtml, auditedPages)
    for (const w of report.warnings) {
      ctx.emitter?.warn(w)
    }
    const errorCount =
      report.skeletonIssues.length +
      Object.values(report.pageIssues).reduce((n, list) => n + list.length, 0)
    ctx.emitter?.stage(
      "audit",
      "静态样式审计",
      "done",
      errorCount > 0 ? `${errorCount} 处问题` : "全部通过"
    )
    return { styleAudit: report }
  }
}

/** 共享修订计划计算：validate/audit/judge 三个阶段复用同一套判定逻辑。 */
function computeRevisePlan(
  state: GraphState,
  scoreThreshold: number
): { skeletonFix: boolean; pageTargets: ThemePageType[] } {
  const failing = state.activePages.filter(
    (pt) => state.validation[pt] && !state.validation[pt].ok
  )
  const auditPages = state.activePages.filter(
    (pt) => (state.styleAudit.pageIssues[pt]?.length ?? 0) > 0
  )
  const lowKeys = Object.entries(state.qualityDimensions)
    .filter(([, dim]) => dim.score > 0 && dim.score < scoreThreshold)
    .map(([k]) => k)
  const skeletonDimLow = lowKeys.some((k) => SKELETON_DIMENSION_KEYS.includes(k))
  const pageDimLow = lowKeys.some((k) => !SKELETON_DIMENSION_KEYS.includes(k))
  const totalLow =
    state.qualityScore > 0 && state.qualityScore < scoreThreshold

  // 骨架级修订：设计系统本身不合格时整树重建（迭代模式下禁止）
  const skeletonFix =
    !state.iteration &&
    (state.styleAudit.skeletonIssues.length > 0 || skeletonDimLow)

  const pageTargets = skeletonFix
    ? []  // 骨架重做会连带所有页面重建，无需单独发 page Sends
    : Array.from(
        new Set([
          ...failing,
          ...auditPages,
          ...(pageDimLow || totalLow ? state.activePages : []),
        ])
      )

  return { skeletonFix, pageTargets }
}

/** judge：多维度质量评估，产出结构化评分（替代原单一总分）。 */
function makeJudgeNode(ctx: NodeContext) {
  return async function judgeNode(state: GraphState) {
    if (!ctx.judgeEnabled) return {}
    ctx.emitter?.stage("judge", "评估设计质量", "start")
    const result = await judgeQuality(ctx.llm, state)
    if (!result) {
      ctx.emitter?.warn("质量评估未能解析结果，本轮跳过评分")
      ctx.emitter?.stage("judge", "评估设计质量", "done", "未评分")
      return {}
    }
    ctx.emitter?.stage("judge", "评估设计质量", "done", `${result.totalScore} 分`)
    return {
      qualityScore: result.totalScore,
      qualityReason: result.reason,
      qualityDimensions: result.dimensions,
    }
  }
}

interface JudgeResult {
  totalScore: number
  reason: string
  dimensions: Record<string, DimensionVerdict>
}

const JUDGE_SYSTEM_PROMPT = `你是资深前端设计师与博客产品评审。请基于用户需求、设计简报与完整样式代码评估主题质量，只输出一个 JSON 对象，格式：
{"dimensions":{"briefMatch":{"score":0到100整数,"issues":["具体问题"]},"visualPolish":{"score":0,"issues":[]},"typography":{"score":0,"issues":[]},"color":{"score":0,"issues":[]},"layout":{"score":0,"issues":[]},"editability":{"score":0,"issues":[]}},"reason":"一句话总评"}
维度说明：briefMatch 是否符合用户需求与设计简报；visualPolish 视觉精致度与"AI 感"程度（背景层次、动效、细节打磨，避免平淡）；typography 排版与字体系统；color 配色体系（主色+点缀色、对比与层次）；layout 布局层次与信息密度；editability 可编辑性（data-content 标记、动态列表模板）。
重点排查（常见低分点，命中请在对应维度 issues 给出可执行的修改建议）：
- 同一页面重复展示同一视觉元素，尤其是作者头像（author-avatar）在导航、hero、作者介绍、文章标题区、页脚等多处出现。作者头像全站只允许 1 个，应集中在作者/简介区块；重复出现直接拉低 visualPolish 与 layout 评分。
- 其它无意义重复的 UI 模块（如两个相同的作者卡、重复的统计区）。
每个维度的 issues 用具体可执行的修改建议填充（没有问题则为空数组），它们会被直接用于指导修订。`

function buildJudgeInput(state: GraphState): string {
  const css = extractCssFromLayout(state.layoutHtml).slice(0, 12000)
  const structure = stripStyleTags(state.layoutHtml).slice(0, 1500)
  const auditLines: string[] = []
  for (const s of state.styleAudit.skeletonIssues)
    auditLines.push(`- [骨架][必须修复] ${s}`)
  for (const w of state.styleAudit.warnings)
    auditLines.push(`- [骨架][提示] ${w}`)
  for (const [pt, list] of Object.entries(state.styleAudit.pageIssues)) {
    for (const s of list)
      auditLines.push(`- [${pageTypeLabel(pt as ThemePageType)}][必须修复] ${s}`)
  }

  const pagePreview = PAGE_TYPES.filter((pt) => state.pages[pt])
    .map((pt) => {
      const html = state.pages[pt]
      const classes = Array.from(collectElementClasses(html))
      return `【${pageTypeLabel(pt)}】类名: ${classes.join(", ") || "（无）"}\n正文节选：\n${html.slice(0, 2500)}`
    })
    .join("\n\n")

  const designBriefLine = state.designBrief
    ? `\n【设计简报】\n${state.designBrief}\n`
    : ""

  return [
    `【用户需求】\n${state.userRequest}`,
    designBriefLine,
    auditLines.length > 0
      ? `【静态样式审计结果】\n${auditLines.join("\n")}`
      : "",
    `【骨架样式代码（完整 CSS）】\n\`\`\`css\n${css || "（无 CSS）"}\n\`\`\``,
    `【骨架结构节选（去样式，仅看 HTML 结构）】\n${structure}`,
    `【各页面正文】\n${pagePreview}`,
  ]
    .filter(Boolean)
    .join("\n\n")
}

function clampScore(n: number): number {
  return Math.min(100, Math.max(0, Math.round(n)))
}

async function judgeQuality(
  llm: BaseChatModel,
  state: GraphState
): Promise<JudgeResult | null> {
  const messages = [
    new SystemMessage(JUDGE_SYSTEM_PROMPT),
    new HumanMessage(buildJudgeInput(state)),
  ]
  try {
    const response = await llm.invoke(messages)
    const text = messageText(response).trim()
    const fenced = text.match(/\{[\s\S]*\}/)
    const raw = fenced ? fenced[0] : text
    const parsed = JSON.parse(raw) as {
      dimensions?: Record<string, { score?: unknown; issues?: unknown }>
      totalScore?: unknown
      score?: unknown
      reason?: unknown
    }

    // 解析六维评分
    const dimensions: Record<string, DimensionVerdict> = {}
    let total = 0
    let weightSum = 0
    for (const { key, weight } of JUDGE_DIMENSIONS) {
      const rawDim = parsed.dimensions?.[key]
      const score = Number(rawDim?.score)
      if (!Number.isFinite(score)) continue
      dimensions[key] = {
        score: clampScore(score),
        issues: Array.isArray(rawDim?.issues)
          ? (rawDim.issues as unknown[])
              .map(String)
              .filter(Boolean)
              .slice(0, 5)
          : [],
      }
      total += dimensions[key].score * weight
      weightSum += weight
    }

    if (weightSum > 0) {
      const totalScore = Math.round((total / weightSum) * (weightSum < 1 ? 1 : 1))
      return {
        totalScore,
        reason: String(parsed.reason ?? ""),
        dimensions,
      }
    }

    // 兼容旧格式 {score, reason}
    const fallbackScore = Number(parsed.totalScore ?? parsed.score)
    if (Number.isFinite(fallbackScore)) {
      return {
        totalScore: clampScore(fallbackScore),
        reason: String(parsed.reason ?? ""),
        dimensions: {},
      }
    }
  } catch {
    // 评估失败返回 null（fail-safe：不阻断流程，也不给满分）
  }
  return null
}

/** revise：对未通过校验/审计/评审的页面或骨架进行修订。 */
function makeReviseNode(ctx: NodeContext) {
  return async function reviseNode(state: GraphState) {
    const plan = computeRevisePlan(state, ctx.scoreThreshold)
    if (!plan.skeletonFix && plan.pageTargets.length === 0) return {}

    const next = state.reviseCount + 1
    const audit = state.styleAudit

    // 骨架级修订：设计系统本身不合格时整树重建
    if (plan.skeletonFix) {
      const dimIssues = SKELETON_DIMENSION_KEYS.flatMap((k) =>
        state.qualityDimensions[k]
          ? state.qualityDimensions[k].issues.map((i) => `[${k}] ${i}`)
          : []
      )
      const skeletonFeedback = [
        ...audit.skeletonIssues.map((s) => `- ${s}`),
        ...dimIssues.map((s) => `- ${s}`),
        state.qualityReason ? `总评意见：${state.qualityReason}` : "",
      ]
        .filter(Boolean)
        .join("\n") || "请增强骨架的视觉设计系统（配色层次、动效、字体个性）。"

      ctx.emitter?.stage("revise", "修订主题骨架", "start", "样式体系不达标，整树重建")
      return new Command({
        update: {
          activePages: [...PAGE_TYPES],
          reviseCount: next,
          skeletonFeedback,
          prevLayout: state.layoutHtml,
        },
        goto: new Send(
          "skeleton",
          buildSkeletonPayload(state, {
            prevLayout: state.layoutHtml,
            skeletonFeedback,
          })
        ),
      })
    }

    // 页面级修订
    const nextFeedback: Record<string, string> = {}
    for (const pt of plan.pageTargets) {
      nextFeedback[pt] = buildFeedback({
        validation: state.validation[pt],
        auditPageIssues: audit.pageIssues[pt],
        dimensions: state.qualityDimensions,
        qualityReason: state.qualityReason,
      })
    }
    ctx.emitter?.stage(
      "revise",
      `修订 ${plan.pageTargets.length} 个页面`,
      "start",
      `${plan.pageTargets.map((pt) => pageTypeLabel(pt)).join("、")} 未达标`
    )
    for (const pt of plan.pageTargets) {
      ctx.emitter?.stage(`page_${pt}`, `重新生成${pageTypeLabel(pt)}`, "start")
    }
    return plan.pageTargets.map((pt) =>
      new Command({
        update: {
          activePages: plan.pageTargets,
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

function buildFeedback(opts: {
  validation?: PageValidation
  auditPageIssues?: string[]
  dimensions?: Record<string, DimensionVerdict>
  qualityReason?: string
}): string {
  const { validation, auditPageIssues, dimensions, qualityReason } = opts
  const parts: string[] = []

  if (validation && validation.issues.length > 0) {
    parts.push("页面与骨架视觉契约不一致：")
    for (const issue of validation.issues) {
      parts.push(`- ${issue}`)
    }
  }
  if (auditPageIssues && auditPageIssues.length > 0) {
    parts.push("静态样式审计问题：")
    for (const issue of auditPageIssues) {
      parts.push(`- ${issue}`)
    }
  }
  // 注入低分维度的具体 issues（每维度最多 3 条）
  if (dimensions) {
    for (const { key, label } of JUDGE_DIMENSIONS) {
      const dim = dimensions[key]
      if (dim && dim.issues.length > 0) {
        parts.push(`${label}维度建议：`)
        for (const issue of dim.issues.slice(0, 3)) {
          parts.push(`- ${issue}`)
        }
      }
    }
  }
  if (qualityReason) {
    parts.push(`总评意见：${qualityReason}`)
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
    scoreThreshold: options.scoreThreshold ?? 70,
    maxAttempts: options.maxAttempts ?? 2,
    runStartedAt,
    stageDurations,
    emitMetrics: (metrics) => emitter?.metrics?.(metrics),
  }

  const routeFromStart = (state: GraphState): string => {
    if (state.iteration && state.targetPage !== "skeleton") return "dispatch_pages"
    return "planner"
  }

  const routeAfterAudit = (state: GraphState): string => {
    const plan = computeRevisePlan(state, ctx.scoreThreshold)
    if ((plan.skeletonFix || plan.pageTargets.length > 0) && state.reviseCount < ctx.maxAttempts) return "revise"
    return ctx.judgeEnabled ? "judge" : "commit"
  }

  const routeAfterJudge = (state: GraphState): string => {
    const plan = computeRevisePlan(state, ctx.scoreThreshold)
    if ((plan.skeletonFix || plan.pageTargets.length > 0) && state.reviseCount < ctx.maxAttempts) return "revise"
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
    .addNode("audit", makeAuditNode(ctx))
    .addNode("judge", makeJudgeNode(ctx))
    .addNode("revise", makeReviseNode(ctx), {
      ends: ["skeleton", "page_home", "page_list", "page_detail"],
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
    .addEdge("validator", "audit")
    .addConditionalEdges("audit", routeAfterAudit, {
      revise: "revise",
      judge: "judge",
      commit: "commit",
    })
    .addConditionalEdges("judge", routeAfterJudge, {
      revise: "revise",
      commit: "commit",
    })
    .addEdge("commit", END)

  return graph.compile({ checkpointer: new MemorySaver() })
}

export type ThemeGraph = Awaited<ReturnType<typeof createThemeGraph>>