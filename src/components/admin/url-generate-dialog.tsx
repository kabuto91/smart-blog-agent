"use client"

import { useState, useEffect, useRef } from "react"
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Loader2, Sparkles, RefreshCw, Save } from "lucide-react"

interface UrlGenerateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  url: string
  onSaved?: (url: string) => void
}

export function UrlGenerateDialog({
  open,
  onOpenChange,
  url,
  onSaved,
}: UrlGenerateDialogProps) {
  const [loading, setLoading] = useState(false)
  const [html, setHtml] = useState("")
  const [previewHtml, setPreviewHtml] = useState("")
  const [contentConfig, setContentConfig] = useState("")
  const [reasoning, setReasoning] = useState("")
  const [error, setError] = useState("")
  const startedRef = useRef(false)

  async function generate() {
    if (loading || !url.trim()) return
    setLoading(true)
    setError("")
    setHtml("")
    setPreviewHtml("")
    setContentConfig("")
    setReasoning("")

    try {
      const res = await fetch("/api/pages/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
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

      let gotHtml = false
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
              setReasoning((prev) => prev + event.content)
            } else if (event.type === "done") {
              gotHtml = !!event.html
              setHtml(event.html)
              setPreviewHtml(event.previewHtml || "")
              setContentConfig(event.contentConfig || "")
            } else if (event.type === "error") {
              streamError = event.error
              setError(event.error)
            }
          } catch {
            // skip invalid JSON lines
          }
        }
      }

      if (!gotHtml && !streamError) {
        setError("未能从生成内容中提取 HTML，请重试")
      }
    } catch {
      setError("网络错误，请重试")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!open) {
      startedRef.current = false
      return
    }
    if (startedRef.current) return
    if (!url.trim()) return
    startedRef.current = true
    const t = window.setTimeout(() => {
      generate()
    }, 0)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, url])

  async function handleSave() {
    if (!html) return
    try {
      const res = await fetch("/api/pages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), html, contentConfig }),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error || "保存失败")
        return
      }
      if (onSaved) onSaved(url.trim())
      onOpenChange(false)
    } catch {
      setError("保存失败，请重试")
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-3xl lg:max-w-4xl"
        showCloseButton={false}
      >
        <div className="flex max-h-[80vh] flex-col">
          <DialogTitle className="flex items-center gap-2 pb-3 text-[#1C1C1E]">
            <Sparkles className="size-4 text-[#E5A83D]" />
            生成页面
            <span className="truncate rounded-md bg-[#F5F4F1] px-2 py-0.5 text-xs font-normal text-[#6B7280]">
              {url || "/new-page"}
            </span>
          </DialogTitle>

          <div className="min-h-[200px] flex-1 overflow-y-auto pr-1">
            {loading && (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Loader2 className="size-8 animate-spin text-[#E5A83D]/40" />
                <p className="mt-3 text-sm text-[#6B7280]">
                  正在根据主题生成 {url} 页面...
                </p>
                {reasoning && (
                  <div className="mt-3 w-full max-w-lg whitespace-pre-wrap rounded-lg bg-[#F5F4F1] p-3 text-left text-xs text-[#6B7280]">
                    {reasoning}
                  </div>
                )}
              </div>
            )}

            {!loading && html && (
              <div className="overflow-hidden rounded-lg border border-black/[0.06] bg-white">
                <div className="flex items-center justify-between border-b border-black/[0.06] bg-[#F5F4F1] px-3 py-1.5">
                  <span className="text-xs text-[#6B7280]">预览</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleSave}
                    className="h-6 gap-1 text-xs text-[#E5A83D] hover:text-[#D4A035]"
                  >
                    <Save className="size-3" />
                    保存到主题
                  </Button>
                </div>
                <iframe
                  srcDoc={previewHtml || html}
                  sandbox="allow-scripts"
                  className="h-[400px] w-full"
                  title="页面预览"
                />
              </div>
            )}

            {!loading && !html && !error && (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Sparkles className="size-8 text-[#E5A83D]/40" />
                <p className="mt-3 text-sm text-[#6B7280]">
                  点击「生成」根据当前主题为 {url || "该链接"} 生成页面
                </p>
              </div>
            )}

            {error && <p className="py-6 text-sm text-red-500">{error}</p>}
          </div>

          <div className="mt-4 flex justify-end gap-2 border-t border-black/[0.06] pt-4">
            <Button
              variant="outline"
              onClick={() => generate()}
              disabled={loading || !url.trim()}
              className="gap-1.5"
            >
              {loading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              {html ? "重新生成" : "生成"}
            </Button>
            <DialogClose render={<Button variant="outline" />}>取消</DialogClose>
            {html && (
              <Button
                onClick={handleSave}
                className="gap-1.5 bg-[#E5A83D] text-[#181A1E] hover:bg-[#D4A035]"
              >
                <Save className="size-4" />
                保存到主题
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}