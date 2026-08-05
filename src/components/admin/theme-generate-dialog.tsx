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
import { Loader2, Sparkles, Send, Trash2 } from "lucide-react"

interface GeneratedPage {
  type: string
  html: string
}

interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  layoutHtml?: string
  pages?: GeneratedPage[]
  contentConfig?: string
  thinking?: string[]
  thinkingVisible?: boolean
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
  const [activePageType, setActivePageType] = useState("home")
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

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

    const userMsgId = crypto.randomUUID()
    setMessages((prev) => [...prev, { id: userMsgId, role: "user", content: message }])

    try {
      const res = await fetch("/api/themes/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, message }),
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

      let fullContent = ""
      const assistantMsgId = crypto.randomUUID()

      // Create an empty assistant message to be updated during streaming
      setMessages((prev) => [
        ...prev,
        {
          id: assistantMsgId,
          role: "assistant",
          content: "",
          thinkingVisible: false,
        },
      ])

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value)
        const lines = chunk.split("\n")

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6)
            if (data === "[DONE]") {
              break
            }

            try {
              const event = JSON.parse(data)

              if (event.type === "text") {
                fullContent += event.content
                // Update the assistant message with the streamed content
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsgId ? { ...m, content: fullContent } : m
                  )
                )
              } else if (event.type === "done") {
                setConversationId(event.conversationId)
                // Update the assistant message with layout and page bodies
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsgId
                      ? { ...m, layoutHtml: event.layoutHtml, pages: event.pages, contentConfig: event.contentConfig }
                      : m
                  )
                )
              } else if (event.type === "tool_call") {
                const query = (event.args && typeof event.args === "object" && "query" in event.args
                  ? (event.args as { query?: string }).query
                  : undefined)
                setToolStatus(query ? `正在搜索图片：${query}` : "正在搜索图片...")
              } else if (event.type === "error") {
                setError(event.error)
              }
            } catch {
              // Skip invalid JSON lines
            }
          }
        }
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
    // 把页正文插入布局中的占位节点
    const placeholder = `<div data-page-host=""></div>`
    if (layout.includes(placeholder)) {
      return layout.replace(placeholder, `<div data-page-host="">${page.html}</div>`)
    }
    // 兜底：直接拼接在 </body> 前
    return layout.replace("</body>", `<div data-page-host="">${page.html}</div></body>`)
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
    setConversationId(null)
    setMessages([])
    setInputValue("")
    setError("")
    setCurrentThinking([])
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
          className="sm:max-w-3xl lg:max-w-4xl"
          showCloseButton={false}
        >
          <div className="flex max-h-[80vh] flex-col">
            <DialogTitle className="flex items-center gap-2 pb-3 text-[#1C1C1E]">
              <Sparkles className="size-4 text-[#E5A83D]" />
              生成新主题
            </DialogTitle>

            {/* Messages area */}
            <div className="min-h-[200px] flex-1 overflow-y-auto pr-1">
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
                        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-[#E5A83D] px-4 py-2.5 text-sm text-[#181A1E]">
                          {msg.content}
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {/* Streaming content */}
                        {loading && !msg.layoutHtml && msg.content && (
                          <div className="ml-1">
                            <div className="flex items-center gap-1.5 text-xs text-[#6B7280]">
                              <span className="i-lucide-brain size-3" />
                              <span>正在生成...</span>
                            </div>
                            <div className="mt-2 rounded-lg bg-[#F5F4F1] p-3 text-xs text-[#6B7280] whitespace-pre-wrap">
                              {msg.content}
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
                              <div className="mt-2 rounded-lg bg-[#F5F4F1] p-3 text-xs text-[#6B7280]">
                                {msg.thinking.map((step, i) => (
                                  <div key={i} className="flex items-start gap-2">
                                    <span className="mt-0.5 text-[#E5A83D]">•</span>
                                    <span>{step}</span>
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
                      </div>
                    )}
                  </div>
                ))}

                {/* Current streaming content */}
                {loading && toolStatus && (
                  <div className="flex items-center gap-1.5 rounded-lg bg-[#F5F4F1] p-3 text-xs text-[#6B7280]">
                    <Loader2 className="size-3 animate-spin" />
                    <span>{toolStatus}</span>
                  </div>
                )}
                {loading && currentThinking.length > 0 && (
                  <div className="flex flex-col gap-1.5 rounded-lg bg-[#F5F4F1] p-3 text-xs text-[#6B7280]">
                    {currentThinking.map((step, i) => (
                      <div key={i} className="flex items-start gap-2 animate-in fade-in">
                        <span className="mt-0.5 text-[#E5A83D]">•</span>
                        <span>{step}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
            </div>

            {/* Input area */}
            <div className="mt-4 border-t border-black/[0.06] pt-4">
              {error && <p className="mb-2 text-sm text-red-500">{error}</p>}

              <div className="flex gap-2">
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

                <div className="flex flex-col gap-2">
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
