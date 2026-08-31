"use client"

import { useState, useEffect, useMemo } from "react"
import { marked } from "marked"
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Loader2, RefreshCw, Sparkles, Wand2 } from "lucide-react"
import { cn } from "@/lib/utils"

interface ArticleGenerateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  content: string
  onApply: (result: GeneratedArticleResult) => void
}

type Mode = "continue" | "generate"
type InsertMode = "append" | "replace"

export interface GeneratedArticleResult {
  content: string
  title?: string
  excerpt?: string
}

/**
 * 解析 AI 输出：若开头为 frontmatter（--- 包裹的 title/excerpt），
 * 则提取标题/摘要并把剩余部分作为正文；否则整段都是正文。
 */
export function parseGenerated(raw: string): GeneratedArticleResult {
  const trimmed = raw.trimStart()
  if (!trimmed.startsWith("---\n")) {
    return { content: raw }
  }
  const endMatch = trimmed.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)
  if (!endMatch) {
    // frontmatter 尚未输出完毕（流式中），先原样展示
    return { content: raw }
  }
  const metaText = endMatch[1]
  const content = trimmed.slice(endMatch[0].length).trimStart()
  const meta: { title?: string; excerpt?: string } = {}
  for (const line of metaText.split("\n")) {
    const m = line.match(/^\s*(title|excerpt|description)\s*:\s*(.*)$/)
    if (m) {
      const key = m[1] === "description" ? "excerpt" : m[1]
      const value = m[2].trim().replace(/^["']|["']$/g, "").trim()
      if (value) meta[key as "title" | "excerpt"] = value
    }
  }
  return { title: meta.title, excerpt: meta.excerpt, content }
}

const previewStyles = `
.article-preview { line-height: 1.75; color: #1C1C1E; word-break: break-word; }
.article-preview h1, .article-preview h2, .article-preview h3, .article-preview h4 {
  margin: 1.2em 0 0.5em; line-height: 1.4; font-weight: 600; }
.article-preview h1 { font-size: 1.5rem; }
.article-preview h2 { font-size: 1.25rem; }
.article-preview h3 { font-size: 1.1rem; }
.article-preview p { margin: 0.6em 0; }
.article-preview ul, .article-preview ol { margin: 0.6em 0; padding-left: 1.5em; }
.article-preview li { margin: 0.25em 0; }
.article-preview a { color: #E5A83D; text-decoration: underline; }
.article-preview blockquote {
  margin: 0.8em 0; padding: 0.5em 1em; border-left: 3px solid #E5A83D;
  background: #F5F4F1; color: #6B7280; }
.article-preview code { background: #F5F4F1; padding: 0.15em 0.4em; border-radius: 4px; font-size: 0.9em; }
.article-preview pre {
  background: #181A1E; color: #E5E5E5; padding: 1em; border-radius: 8px;
  overflow-x: auto; margin: 0.8em 0; }
.article-preview pre code { background: transparent; padding: 0; color: inherit; }
.article-preview img { max-width: 100%; height: auto; border-radius: 8px; }
.article-preview table { border-collapse: collapse; margin: 0.8em 0; width: 100%; }
.article-preview th, .article-preview td { border: 1px solid rgba(0,0,0,0.1); padding: 0.4em 0.6em; }
.article-preview hr { border: none; border-top: 1px solid rgba(0,0,0,0.1); margin: 1.2em 0; }
`

export function ArticleGenerateDialog({
  open,
  onOpenChange,
  title,
  content,
  onApply,
}: ArticleGenerateDialogProps) {
  const [mode, setMode] = useState<Mode>("continue")
  const [insertMode, setInsertMode] = useState<InsertMode>("append")
  const [instruction, setInstruction] = useState("")
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState("")
  const [error, setError] = useState("")
  const [includeMeta, setIncludeMeta] = useState(false)

  const parsed = useMemo(() => parseGenerated(result), [result])
  const previewHtml = useMemo(
    () =>
      parsed.content
        ? (marked.parse(parsed.content, { async: false }) as string)
        : "",
    [parsed.content]
  )

  // 打开时快照当前标题/正文，并重置表单
  useEffect(() => {
    if (!open) return
    setInstruction("")
    setResult("")
    setError("")
    setLoading(false)
    setMode(content.trim() ? "continue" : "generate")
    setInsertMode(content.trim() ? "append" : "replace")
    setIncludeMeta(!content.trim())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function handleModeChange(next: Mode) {
    setMode(next)
    setInsertMode(next === "generate" ? "replace" : "append")
    setIncludeMeta(next === "generate")
  }

  async function generate() {
    if (loading) return
    setLoading(true)
    setError("")
    setResult("")

    try {
      const res = await fetch("/api/articles/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          content: mode === "continue" ? content : "",
          instruction,
          mode,
          includeMeta,
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

      let streamError = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value)
        const lines = chunk.split("\n")

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue
          const data = line.slice(6)
          if (data === "[DONE]") continue

          try {
            const event = JSON.parse(data)
            if (event.type === "text") {
              setResult((prev) => prev + event.content)
            } else if (event.type === "error") {
              streamError = event.error
              setError(event.error)
            }
          } catch {
            // skip invalid JSON lines
          }
        }
      }

      if (streamError) return
    } catch {
      setError("网络错误，请重试")
    } finally {
      setLoading(false)
    }
  }

  function handleInsert() {
    if (!parsed.content.trim()) return
    const nextContent =
      insertMode === "replace" || !content.trim()
        ? parsed.content.trim()
        : `${content.trimEnd()}\n\n${parsed.content.trim()}`
    onApply({
      content: nextContent,
      title: parsed.title,
      excerpt: parsed.excerpt,
    })
    onOpenChange(false)
  }

  const modeOptions: { value: Mode; label: string; hint: string }[] = [
    { value: "continue", label: "续写补全", hint: "在现有内容基础上补全" },
    { value: "generate", label: "生成全文", hint: "忽略旧正文，按标题+要点生成" },
  ]

  const insertOptions: { value: InsertMode; label: string; hint: string }[] = [
    { value: "append", label: "追加到末尾", hint: "生成结果追加到正文末尾" },
    { value: "replace", label: "替换全部内容", hint: "用生成结果替换整个正文" },
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl" showCloseButton={false}>
        <div className="flex max-h-[80vh] flex-col gap-4">
          <DialogTitle className="flex items-center gap-2 pb-1 text-[#1C1C1E]">
            <Sparkles className="size-4 text-[#E5A83D]" />
            AI 生成正文
          </DialogTitle>

          <div>
            <label className="mb-1 block text-xs font-medium text-[#6B7280]">
              写作要求 / 文章要点
            </label>
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="例如：围绕「远程办公的利与弊」展开，面向职场新人，语气轻松，涵盖效率、沟通、生活平衡三个方面。"
              rows={4}
              className="w-full resize-y rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-[#6B7280]">生成模式</span>
            <div className="flex flex-wrap gap-2">
              {modeOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handleModeChange(opt.value)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs transition-colors",
                    mode === opt.value
                      ? "border-[#E5A83D] bg-[#E5A83D] text-[#181A1E]"
                      : "border-black/[0.08] bg-white text-[#6B7280] hover:border-[#E5A83D]/40"
                  )}
                  title={opt.hint}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-[#6B7280]">插入方式</span>
            <div className="flex flex-wrap gap-2">
              {insertOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setInsertMode(opt.value)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs transition-colors",
                    insertMode === opt.value
                      ? "border-[#E5A83D] bg-[#E5A83D] text-[#181A1E]"
                      : "border-black/[0.08] bg-white text-[#6B7280] hover:border-[#E5A83D]/40"
                  )}
                  title={opt.hint}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <label className="flex w-fit cursor-pointer items-center gap-2 text-xs text-[#6B7280]">
            <input
              type="checkbox"
              checked={includeMeta}
              onChange={(e) => setIncludeMeta(e.target.checked)}
              className="size-4 accent-[#E5A83D]"
            />
            同时生成标题和摘要
          </label>

          {/* Generated metadata */}
          {(parsed.title || parsed.excerpt) && (
            <div className="flex flex-col gap-2">
              {parsed.title && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-[#6B7280]">
                    生成标题
                  </label>
                  <input
                    readOnly
                    value={parsed.title}
                    className="w-full rounded-lg border border-black/[0.08] bg-[#FCFCFA] px-3 py-1.5 text-sm text-[#1C1C1E] outline-none"
                  />
                </div>
              )}
              {parsed.excerpt && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-[#6B7280]">
                    生成摘要
                  </label>
                  <textarea
                    readOnly
                    value={parsed.excerpt}
                    rows={2}
                    className="w-full resize-none rounded-lg border border-black/[0.08] bg-[#FCFCFA] px-3 py-1.5 text-sm text-[#1C1C1E] outline-none"
                  />
                </div>
              )}
              <p className="text-xs text-[#6B7280]/70">
                插入编辑器时，标题与摘要会一并填入文章信息
              </p>
            </div>
          )}

          {/* Result + preview */}
          <div className="flex min-h-[200px] flex-1 gap-3">
            {/* Raw source */}
            <div className="flex w-1/2 min-w-0 flex-col overflow-hidden rounded-lg border border-black/[0.06] bg-[#FCFCFA]">
              <div className="flex items-center justify-between border-b border-black/[0.06] bg-[#F5F4F1] px-3 py-1.5">
                <span className="text-xs text-[#6B7280]">生成结果</span>
                {parsed.content && (
                  <span className="text-xs text-[#6B7280]">
                    {parsed.content.length} 字符
                  </span>
                )}
              </div>
              <textarea
                readOnly
                value={parsed.content}
                placeholder={
                  loading
                    ? "正在生成..."
                    : "点击「开始生成」，AI 生成的正文将实时显示在这里"
                }
                className="min-h-0 flex-1 resize-none bg-transparent p-3 font-mono text-xs leading-relaxed outline-none"
              />
            </div>
            {/* Rendered preview */}
            <div className="flex w-1/2 min-w-0 flex-col overflow-hidden rounded-lg border border-black/[0.06] bg-white">
              <div className="border-b border-black/[0.06] bg-[#F5F4F1] px-3 py-1.5">
                <span className="text-xs text-[#6B7280]">预览</span>
              </div>
              <div className="article-preview min-h-0 flex-1 overflow-auto bg-white p-4">
                {previewHtml ? (
                  <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
                ) : (
                  <p className="text-sm text-[#6B7280]/60">
                    生成后将在这里预览渲染效果
                  </p>
                )}
              </div>
            </div>
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          {/* Footer */}
          <div className="flex justify-end gap-2 border-t border-black/[0.06] pt-4">
            <Button
              variant="outline"
              onClick={() => generate()}
              disabled={loading}
              className="gap-1.5"
            >
              {loading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              {loading ? "生成中..." : result ? "重新生成" : "开始生成"}
            </Button>
            <DialogClose render={<Button variant="outline" />}>取消</DialogClose>
            <Button
              onClick={handleInsert}
              disabled={loading || !parsed.content.trim()}
              className="gap-1.5 bg-[#E5A83D] text-[#181A1E] hover:bg-[#D4A035]"
            >
              <Wand2 className="size-4" />
              插入到编辑器
            </Button>
          </div>

          <style>{previewStyles}</style>
        </div>
      </DialogContent>
    </Dialog>
  )
}
