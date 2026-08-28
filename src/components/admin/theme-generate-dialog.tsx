"use client"

import { useState, useRef, useEffect } from "react"
import {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Loader2, Sparkles, Send, Trash2, ImagePlus, X } from "lucide-react"
import { injectPageIntoLayout } from "@/lib/theme/layout-inject"
import { useAppStore } from "@/lib/store/app-store"

interface GeneratedPage {
  type: string
  html: string
  contentConfig?: string
}

interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  layoutHtml?: string
  pages?: GeneratedPage[]
  contentConfig?: string
  pageContents?: Record<string, string>
  pagesDone?: string[]
  thinking?: string[]
  thinkingVisible?: boolean
  imageId?: string
  imageUrl?: string
  metrics?: ThemeMetrics
}

interface ThemeGenerateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved?: (payload: {
    layoutHtml: string
    pages: GeneratedPage[]
    contentConfig?: string
  }) => void
}

const PAGE_TABS = [
  { type: "home", label: "首页" },
  { type: "list", label: "文章列表页" },
  { type: "detail", label: "文章详情页" },
]

interface ThemeMetrics {
  stages: Record<string, number>
  totalMs: number
  reviseCount: number
  pageCount: number
  qualityScore: number
  iteration: boolean
}

/** Agent 各阶段的中文名与展示顺序。 */
const STAGE_META: Record<string, { label: string; order: number }> = {
  planner: { label: "规划设计方向", order: 1 },
  skeleton: { label: "生成主题骨架", order: 2 },
  page_home: { label: "首页", order: 3 },
  page_list: { label: "文章列表页", order: 4 },
  page_detail: { label: "文章详情页", order: 5 },
  validator: { label: "校验骨架一致性", order: 6 },
  audit: { label: "静态样式审计", order: 7 },
  judge: { label: "评估设计质量", order: 8 },
  revise: { label: "修订页面", order: 9 },
  commit: { label: "保存会话快照", order: 10 },
}
const STAGE_LIST = Object.entries(STAGE_META)
  .sort((a, b) => a[1].order - b[1].order)
  .map(([key]) => key)

const PRESETS = [
  {
    label: "极简杂志风",
    prompt:
      "我想要一个极简杂志风格的博客：米白底色、黑色衬线标题、居中单栏布局，留白充足。",
  },
  {
    label: "复古未来",
    prompt:
      "复古未来风格：深蓝紫渐变背景、霓虹点缀色、圆角卡片，带一点 80 年代科幻感。",
  },
  {
    label: "日式侘寂",
    prompt:
      "日式侘寂风格：亚麻灰与陶土色、粗粝质感、手写感标题、极简不对称布局。",
  },
  {
    label: "工业实用",
    prompt:
      "工业实用风格：深色金属质感、荧光黄强调色、粗黑标题、信息密集的两栏布局。",
  },
]

export function ThemeGenerateDialog({
  open,
  onOpenChange,
  onSaved,
}: ThemeGenerateDialogProps) {
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [inputValue, setInputValue] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [currentThinking, setCurrentThinking] = useState<string[]>([])
  const [toolStatus, setToolStatus] = useState("")
  const [warnings, setWarnings] = useState<string[]>([])
  const [stageState, setStageState] = useState<
    Record<string, "running" | "done">
  >({})
  const [stageDetail, setStageDetail] = useState<Record<string, string>>({})
  const [activePageType, setActivePageType] = useState("home")
  const [targetPage, setTargetPage] = useState<"skeleton" | "home" | "list" | "detail">("skeleton")
  const [fastMode, setFastMode] = useState(false)
  const [selectedImage, setSelectedImage] = useState<{ id: string; url: string } | null>(null)
  const [uploadingImage, setUploadingImage] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const visionConfigured = useAppStore((s) => s.visionConfigured)
  const loadCapabilities = useAppStore((s) => s.loadCapabilities)

  useEffect(() => {
    loadCapabilities()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, currentThinking])

  useEffect(() => {
    if (open && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [open])

  async function handleSend() {
    const message = inputValue.trim()
    if (!message || loading) return

    setLoading(true)
    setError("")
    setInputValue("")
    setCurrentThinking([])
    setToolStatus("")
    setWarnings([])
    setStageState({})
    setStageDetail({})
    setSelectedImage(null)

    const userMsgId = crypto.randomUUID()
    setMessages((prev) => [...prev, { id: userMsgId, role: "user", content: message, imageId: selectedImage?.id, imageUrl: selectedImage?.url }])

    try {
      const res = await fetch("/api/themes/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          message,
          targetPage,
          imageId: selectedImage?.id,
          fastMode,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error || "生成失败")
        return
      }

      const reader = res.body?.getReader()
      const decoder = new TextDecoder()

      if (!reader) {
        setError("无法读取响应流")
        return
      }

      let pageContents: Record<string, string> = {}
      const pendingPages: Record<string, GeneratedPage> = {}
      const assistantMsgId = crypto.randomUUID()

      // Create an empty assistant message to be updated during streaming
      setMessages((prev) => [
        ...prev,
        {
          id: assistantMsgId,
          role: "assistant",
          content: "",
          thinkingVisible: false,
          pageContents: {},
          pagesDone: [],
        },
      ])

      const updateMsg = (patch: Partial<Message>) =>
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantMsgId ? { ...m, ...patch } : m))
        )

      const handleEvent = (data: string) => {
        if (data === "[DONE]") return

        try {
          const event = JSON.parse(data)

          if (event.type === "text") {
            const page = (event.page as string) ?? "skeleton"
            pageContents = {
              ...pageContents,
              [page]: (pageContents[page] ?? "") + event.content,
            }
            updateMsg({ pageContents: { ...pageContents } })
          } else if (event.type === "page") {
            const p = event.page as GeneratedPage
            if (p?.type && typeof p.html === "string") {
              pendingPages[p.type] = p
            }
          } else if (event.type === "done") {
            setConversationId(event.conversationId)
            const pages: GeneratedPage[] = PAGE_TABS.map((t) => {
              const pending = pendingPages[t.type]
              if (pending) return pending
              const html = pageContents[t.type] ?? ""
              return { type: t.type, html, contentConfig: "{}" }
            })
            updateMsg({
              layoutHtml: event.layoutHtml,
              pages,
              contentConfig: event.contentConfig,
              pageContents: pages.reduce(
                (acc: Record<string, string>, p: GeneratedPage) => {
                  acc[p.type] = p.html
                  return acc
                },
                {}
              ),
              pagesDone: PAGE_TABS.map((t) => t.type),
            })
          } else if (event.type === "tool_call") {
            const query = (event.args && typeof event.args === "object" && "query" in event.args
              ? (event.args as { query?: string }).query
              : undefined)
            setToolStatus(query ? `正在搜索图片：${query}` : "正在搜索图片...")
          } else if (event.type === "stage") {
            const stage = event.stage as string
            if (event.status === "done") {
              setStageState((prev) => ({ ...prev, [stage]: "done" }))
              if (typeof event.detail === "string" && event.detail) {
                setStageDetail((prev) => ({ ...prev, [stage]: event.detail }))
              }
            } else {
              setStageState((prev) => ({ ...prev, [stage]: "running" }))
            }
          } else if (event.type === "metrics") {
            updateMsg({ metrics: event.metrics as ThemeMetrics })
          } else if (event.type === "error") {
            setError(event.error)
          } else if (event.type === "warn") {
            if (event.message) {
              setWarnings((prev) =>
                prev.includes(event.message) ? prev : [...prev, event.message]
              )
            }
          }
        } catch {
          // Skip invalid JSON lines
        }
      }

      let buffer = ""
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        let eventEnd: number
        while ((eventEnd = buffer.indexOf("\n\n")) !== -1) {
          const block = buffer.slice(0, eventEnd).trim()
          buffer = buffer.slice(eventEnd + 2)
          const data = block.startsWith("data: ") ? block.slice(6) : block
          handleEvent(data)
        }
      }

      buffer += decoder.decode()
      buffer = buffer.trim()
      if (buffer) {
        const data = buffer.startsWith("data: ") ? buffer.slice(6) : buffer
        handleEvent(data)
      }
    } catch {
      setError("网络错误，请重试")
    } finally {
      setLoading(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setUploadingImage(true)
    try {
      const formData = new FormData()
      formData.append("file", file)
      const res = await fetch("/api/uploads", {
        method: "POST",
        body: formData,
      })
      if (res.ok) {
        const data = await res.json()
        setSelectedImage({ id: data.id, url: data.url })
      }
    } catch {
      // ignore upload error
    } finally {
      setUploadingImage(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ""
      }
    }
  }

  function removeSelectedImage() {
    setSelectedImage(null)
  }

  function toggleThinking(msgId: string) {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === msgId ? { ...m, thinkingVisible: !m.thinkingVisible } : m
      )
    )
  }

  function mergedPreviewHtml(msg: Message): string {
    const layout = msg.layoutHtml ?? ""
    const page =
      msg.pages?.find((p) => p.type === activePageType) ?? msg.pages?.[0]
    if (!page) return layout
    return injectPageIntoLayout(layout, page.html, {
      navClearance: page.type !== "home",
    })
  }

  function handleSave(payload: {
    layoutHtml: string
    pages: GeneratedPage[]
    contentConfig?: string
  }) {
    if (onSaved) {
      onSaved(payload)
      onOpenChange(false)
      reset()
    }
  }

  function handleNewSession() {
    reset()
  }

  function reset() {
    const id = conversationId
    setConversationId(null)
    setMessages([])
    setInputValue("")
    setError("")
    setCurrentThinking([])
    setWarnings([])
    setTargetPage("skeleton")
    if (id) {
      fetch(`/api/themes/sessions/${id}`, { method: "DELETE" }).catch(() => {})
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    onOpenChange(nextOpen)
    if (!nextOpen) reset()
  }

  const latestMsg = [...messages].reverse().find((m) => m.layoutHtml)
  const latestLayoutHtml = latestMsg?.layoutHtml
  const latestPages = latestMsg?.pages ?? []
  const latestConfig = latestMsg?.contentConfig

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogContent
          className="overflow-hidden sm:max-w-3xl lg:max-w-4xl"
          showCloseButton={false}
        >
          <div className="flex max-h-[80vh] min-w-0 flex-col">
            <DialogTitle className="flex items-center gap-2 pb-3 text-[#1C1C1E]">
              <Sparkles className="size-4 text-[#E5A83D]" />
              生成新主题
            </DialogTitle>

            {/* Messages area */}
            <div className="min-h-[200px] flex-1 overflow-y-auto overflow-x-hidden pr-1">
              {messages.length === 0 && !loading && (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Sparkles className="size-8 text-[#E5A83D]/40" />
                  <p className="mt-3 text-sm text-[#6B7280]">
                    描述你想要的博客风格，AI 将为你生成主题
                  </p>
                  <p className="mt-1 text-xs text-[#6B7280]/60">
                    生成后可以继续对话，迭代修改直到满意
                  </p>
                </div>
              )}

              <div className="flex flex-col gap-4">
                {messages.map((msg) => (
                  <div key={msg.id} className="flex flex-col gap-2">
                    {msg.role === "user" ? (
                      <div className="flex justify-end">
                        <div className="max-w-[85%] break-words rounded-2xl rounded-br-md bg-[#E5A83D] px-4 py-2.5 text-sm text-[#181A1E]">
                          {msg.imageUrl && (
                            <div className="mb-2">
                              <img
                                src={msg.imageUrl}
                                alt="上传的图片"
                                className="max-h-[120px] rounded-md object-cover"
                              />
                            </div>
                          )}
                          {msg.content}
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {/* Streaming content */}
                        {loading && !msg.layoutHtml && (
                          <div className="ml-1">
                            <div className="flex items-center gap-1.5 text-xs text-[#6B7280]">
                              <span className="i-lucide-brain size-3" />
                              <span>正在生成...</span>
                            </div>
                            {toolStatus && (
                              <div className="mt-2 flex items-center gap-1.5 text-xs text-[#6B7280]">
                                <Loader2 className="size-3 animate-spin" />
                                <span>{toolStatus}</span>
                              </div>
                            )}
                            <div className="mt-2 rounded-lg bg-[#F5F4F1] p-3 text-xs text-[#6B7280]">
                              <div className="flex flex-col">
                                {(() => {
                                  const started = Object.keys(stageState)
                                  const maxOrder =
                                    started.length > 0
                                      ? Math.max(
                                          ...started.map(
                                            (s) => STAGE_META[s]?.order ?? 0
                                          )
                                        )
                                      : 0
                                  return STAGE_LIST.filter(
                                    (stage) =>
                                      stage !== "pages" &&
                                      (stageState[stage] ||
                                        (STAGE_META[stage]?.order ?? 0) <=
                                          maxOrder)
                                  ).map((stage) => {
                                    const meta = STAGE_META[stage]
                                    const status = stageState[stage]
                                    const done = status === "done"
                                    const running = status === "running"
                                    const detail = stageDetail[stage]
                                    const pageKey =
                                      stage === "skeleton"
                                        ? "skeleton"
                                        : stage.replace("page_", "")
                                    const preview = msg.pageContents?.[pageKey] ?? ""
                                    return (
                                      <div
                                        key={stage}
                                        className="flex flex-col gap-0.5 py-0.5"
                                      >
                                        <div className="flex items-center gap-2">
                                          {done ? (
                                            <span className="text-[#16A34A]">✓</span>
                                          ) : running ? (
                                            <Loader2 className="size-3 animate-spin" />
                                          ) : (
                                            <span className="text-[#E5A83D]">●</span>
                                          )}
                                          <span className="font-medium">
                                            {meta?.label ?? stage}
                                          </span>
                                          {done && (
                                            <span className="text-[#16A34A]">
                                              已生成
                                            </span>
                                          )}
                                          {done && detail && (
                                            <span className="max-w-[40%] truncate text-[#6B7280]/70">
                                              {detail}
                                            </span>
                                          )}
                                        </div>
                                        {preview && (
                                          <div className="mt-1 break-words whitespace-pre-wrap rounded bg-white/70 p-2 text-[11px] leading-relaxed text-[#6B7280]">
                                            {preview.slice(-300)}
                                          </div>
                                        )}
                                      </div>
                                    )
                                  })
                                })()}
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Completed message with thinking steps */}
                        {!loading && msg.thinking && msg.thinking.length > 0 && (
                          <div className="ml-1">
                            <button
                              onClick={() => toggleThinking(msg.id)}
                              className="flex items-center gap-1.5 text-xs text-[#6B7280] hover:text-[#1C1C1E] transition-colors"
                            >
                              <span className="i-lucide-brain size-3" />
                              {msg.thinkingVisible ? "收起思考过程" : "查看思考过程"}
                            </button>
                            {msg.thinkingVisible && (
                              <div className="mt-2 break-words rounded-lg bg-[#F5F4F1] p-3 text-xs text-[#6B7280]">
                                {msg.thinking.map((step, i) => (
                                  <div key={i} className="flex items-start gap-2">
                                    <span className="mt-0.5 text-[#E5A83D]">•</span>
                                    <span className="min-w-0 break-words">{step}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Theme preview: layout + tabbed pages */}
                        {msg.layoutHtml && (
                          <div className="overflow-hidden rounded-lg border border-black/[0.06] bg-white">
                            <div className="flex items-center justify-between border-b border-black/[0.06] bg-[#F5F4F1] px-3 py-1.5">
                              <div className="flex items-center gap-1">
                                {PAGE_TABS.map((tab) => (
                                  <button
                                    key={tab.type}
                                    onClick={() => setActivePageType(tab.type)}
                                    className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                                      activePageType === tab.type
                                        ? "bg-[#E5A83D] text-[#181A1E]"
                                        : "text-[#6B7280] hover:bg-black/[0.04]"
                                    }`}
                                  >
                                    {tab.label}
                                  </button>
                                ))}
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  handleSave({
                                    layoutHtml: msg.layoutHtml!,
                                    pages: msg.pages ?? [],
                                    contentConfig: msg.contentConfig,
                                  })
                                }
                                className="h-6 gap-1 text-xs text-[#E5A83D] hover:text-[#D4A035]"
                              >
                                使用此主题
                              </Button>
                            </div>
                            <iframe
                              srcDoc={mergedPreviewHtml(msg)}
                              sandbox="allow-scripts"
                              className="h-[320px] w-full"
                              title="主题预览"
                            />
                          </div>
                        )}

                        {/* Run metrics */}
                        {msg.metrics && (
                          <div className="ml-1 rounded-lg border border-black/[0.06] bg-[#FAF9F6] px-3 py-2 text-[11px] text-[#6B7280]">
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                              <span>
                                总耗时{" "}
                                {(msg.metrics.totalMs / 1000).toFixed(1)}s
                              </span>
                              {msg.metrics.qualityScore > 0 && (
                                <span>质量分 {msg.metrics.qualityScore}</span>
                              )}
                              {msg.metrics.reviseCount > 0 && (
                                <span>修订 {msg.metrics.reviseCount} 轮</span>
                              )}
                              <span>
                                页面 {msg.metrics.pageCount}/3
                              </span>
                            </div>
                            {Object.keys(msg.metrics.stages).length > 0 && (
                              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                                {Object.entries(msg.metrics.stages).map(
                                  ([key, ms]) => (
                                    <span key={key}>
                                      {STAGE_META[key]?.label ?? key}{" "}
                                      {(ms / 1000).toFixed(1)}s
                                    </span>
                                  )
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}

                {/* Current streaming content */}
                {loading && toolStatus && (
                  <div className="flex items-center gap-1.5 break-words rounded-lg bg-[#F5F4F1] p-3 text-xs text-[#6B7280]">
                    <Loader2 className="size-3 animate-spin" />
                    <span className="min-w-0 break-words">{toolStatus}</span>
                  </div>
                )}
                {loading && currentThinking.length > 0 && (
                  <div className="flex flex-col gap-1.5 break-words rounded-lg bg-[#F5F4F1] p-3 text-xs text-[#6B7280]">
                    {currentThinking.map((step, i) => (
                      <div key={i} className="flex items-start gap-2 animate-in fade-in">
                        <span className="mt-0.5 text-[#E5A83D]">•</span>
                        <span className="min-w-0 break-words">{step}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
            </div>

            {/* Input area */}
            <div className="mt-4 border-t border-black/[0.06] pt-4">
              {error && <p className="mb-2 break-words text-sm text-red-500">{error}</p>}

              {warnings.map((w) => (
                <p
                  key={w}
                  className="mb-2 break-words text-sm text-amber-600"
                >
                  {w}
                </p>
              ))}

              {messages.length === 0 && !loading && (
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-[#6B7280]">快速开始：</span>
                  {PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      onClick={() => {
                        setInputValue(preset.prompt)
                        textareaRef.current?.focus()
                      }}
                      className="rounded-md border border-[#E5A83D]/30 bg-[#E5A83D]/5 px-2 py-0.5 text-xs text-[#8a6d1f] transition-colors hover:bg-[#E5A83D]/15"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              )}

              {messages.length > 0 && (
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-[#6B7280]">修改范围：</span>
                  {[
                    { value: "skeleton", label: "整体" },
                    ...PAGE_TABS.map((t) => ({ value: t.type, label: t.label })),
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setTargetPage(opt.value as typeof targetPage)}
                      disabled={loading}
                      className={`rounded-md px-2 py-0.5 text-xs transition-colors ${
                        targetPage === opt.value
                          ? "bg-[#E5A83D] text-[#181A1E]"
                          : "text-[#6B7280] hover:bg-black/[0.04]"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}

              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-xs text-[#6B7280]">生成模式：</span>
                <button
                  onClick={() => setFastMode(false)}
                  disabled={loading}
                  className={`rounded-md px-2 py-0.5 text-xs transition-colors ${
                    !fastMode
                      ? "bg-[#E5A83D] text-[#181A1E]"
                      : "text-[#6B7280] hover:bg-black/[0.04]"
                  }`}
                  title="运行 AI 质量评审、可修订最多 2 轮，质量更高"
                >
                  质量优先
                </button>
                <button
                  onClick={() => setFastMode(true)}
                  disabled={loading}
                  className={`rounded-md px-2 py-0.5 text-xs transition-colors ${
                    fastMode
                      ? "bg-[#E5A83D] text-[#181A1E]"
                      : "text-[#6B7280] hover:bg-black/[0.04]"
                  }`}
                  title="跳过 AI 质量评审、修订最多 1 轮，节省约 40% token，适合快速探索"
                >
                  快速生成
                </button>
              </div>

              <div className="flex gap-2">
                <div className="flex-1">
                  {selectedImage && (
                    <div className="mb-2 flex items-center gap-2">
                      <div className="relative">
                        <img
                          src={selectedImage.url}
                          alt="待上传图片"
                          className="h-16 rounded-md object-cover"
                        />
                        <button
                          onClick={removeSelectedImage}
                          className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600"
                        >
                          <X className="size-3" />
                        </button>
                      </div>
                      <span className="text-xs text-[#6B7280]">
                        {visionConfigured === false
                          ? "图片已选择，但未配置视觉模型，将不进行视觉分析"
                          : "图片已选择，发送时将分析"}
                      </span>
                    </div>
                  )}
                  {visionConfigured === false && !selectedImage && (
                    <p className="mb-2 text-xs text-[#6B7280]">
                      未配置视觉模型，上传的参考图片将被忽略
                    </p>
                  )}
                  <Textarea
                    ref={textareaRef}
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={
                      messages.length === 0
                        ? "描述你想要的博客风格，例如：我想要一个极简风格的博客页面..."
                        : "输入修改意见，例如：把背景改成深色、字体再大一点..."
                    }
                    rows={2}
                    className="min-h-[60px] resize-none border-black/[0.08] bg-white placeholder:text-[#6B7280]/60 focus-visible:border-[#E5A83D]/40 focus-visible:ring-[#E5A83D]/20"
                    disabled={loading}
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    className="hidden"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={loading || uploadingImage}
                    className="text-[#6B7280] hover:text-[#E5A83D]"
                    title="上传参考图片"
                  >
                    {uploadingImage ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <ImagePlus className="size-4" />
                    )}
                  </Button>

                  <Button
                    onClick={handleSend}
                    disabled={!inputValue.trim() || loading}
                    className="bg-[#E5A83D] text-[#181A1E] hover:bg-[#D4A035] disabled:opacity-40"
                  >
                    {loading ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Send className="size-4" />
                    )}
                  </Button>

                  {messages.length > 0 && (
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={handleNewSession}
                      className="text-[#6B7280] hover:text-red-500"
                      title="清空对话"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="mt-4 flex justify-end gap-2">
              <DialogClose render={<Button variant="outline" onClick={reset} />}>
                取消
              </DialogClose>
              {latestLayoutHtml && (
                <Button
                  onClick={() =>
                    handleSave({
                      layoutHtml: latestLayoutHtml,
                      pages: latestPages,
                      contentConfig: latestConfig,
                    })
                  }
                  className="bg-[#E5A83D] text-[#181A1E] hover:bg-[#D4A035]"
                >
                  保存主题
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  )
}
