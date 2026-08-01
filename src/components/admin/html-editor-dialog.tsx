"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import Editor from "react-simple-code-editor"
import Prism from "prismjs"
import "prismjs/components/prism-markup"
import {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { ImagePlus, Loader2, Info } from "lucide-react"
import type { ContentConfig } from "@/lib/types/content-config"

interface HtmlEditorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  html: string
  contentConfig?: ContentConfig | null
  onSave: (html: string) => void
}

function highlightHtml(code: string) {
  return Prism.highlight(code, Prism.languages.html, "html")
}

const prismStyles = `
.html-editor .token.comment,
.html-editor .token.prolog,
.html-editor .token.doctype,
.html-editor .token.cdata { color: #708090; }
.html-editor .token.punctuation { color: #999; }
.html-editor .token.property,
.html-editor .token.tag,
.html-editor .token.constant,
.html-editor .token.symbol,
.html-editor .token.deleted { color: #905; }
.html-editor .token.boolean,
.html-editor .token.number { color: #905; }
.html-editor .token.selector,
.html-editor .token.attr-name,
.html-editor .token.string,
.html-editor .token.char,
.html-editor .token.builtin,
.html-editor .token.inserted { color: #690; }
.html-editor .token.operator,
.html-editor .token.entity,
.html-editor .token.url,
.html-editor .language-css .token.string,
.html-editor .style .token.string { color: #a67f59; }
.html-editor .token.atrule,
.html-editor .token.attr-value,
.html-editor .token.keyword { color: #07a; }
.html-editor .token.function,
.html-editor .token.class-name { color: #dd4a68; }
.html-editor .token.regex,
.html-editor .token.important,
.html-editor .token.variable { color: #e90; }
.html-editor .token.important,
.html-editor .token.bold { font-weight: bold; }
.html-editor .token.italic { font-style: italic; }
`

export function HtmlEditorDialog({
  open,
  onOpenChange,
  html,
  contentConfig,
  onSave,
}: HtmlEditorDialogProps) {
  const [code, setCode] = useState(html)
  const [previewHtml, setPreviewHtml] = useState("")
  const [previewLoading, setPreviewLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState("")
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const editorTouchedRef = useRef(false)

  const updatePreview = useCallback(
    async (value: string) => {
      setPreviewLoading(true)
      try {
        const res = await fetch("/api/themes/render", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            htmlTemplate: value,
            contentConfig: contentConfig ?? {},
          }),
        })
        const data = await res.json()
        if (data.html) {
          setPreviewHtml(data.html)
        }
      } catch {
        // preview failed silently
      } finally {
        setPreviewLoading(false)
      }
    },
    [contentConfig]
  )

  useEffect(() => {
    const t = setTimeout(() => updatePreview(html), 0)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      clearTimeout(t)
    }
  }, [html, updatePreview])

  function handleCodeChange(value: string) {
    setCode(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => updatePreview(value), 300)
  }

  function trackSelection() {
    editorTouchedRef.current = true
  }

  async function handleUpload(file: File) {
    setUploading(true)
    setError("")

    const ta = containerRef.current?.querySelector("textarea")
    const start = editorTouchedRef.current && ta ? ta.selectionStart : code.length
    const end = editorTouchedRef.current && ta ? ta.selectionEnd : code.length

    try {
      const formData = new FormData()
      formData.append("file", file)
      const res = await fetch("/api/uploads", { method: "POST", body: formData })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "上传失败")

      const imgTag = `<img src="${data.url}" alt="${file.name.replace(/"/g, "")}" style="max-width:100%;height:auto" />`
      const next = code.slice(0, start) + imgTag + code.slice(end)
      setCode(next)

      requestAnimationFrame(() => {
        const ta = containerRef.current?.querySelector("textarea")
        if (ta) {
          const pos = start + imgTag.length
          ta.selectionStart = pos
          ta.selectionEnd = pos
          ta.focus()
        }
      })

      updatePreview(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : "上传失败")
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleUpload(file)
  }

  function handleSave() {
    onSave(code)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogContent
          className="sm:max-w-6xl lg:max-w-7xl"
          showCloseButton={false}
        >
          <DialogTitle className="pb-3 text-[#1C1C1E]">
            编辑 HTML 源码
          </DialogTitle>

          <div className="flex max-h-[75vh] gap-4 overflow-hidden">
            {/* Left: code editor */}
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-black/[0.06] bg-white">
              <div className="flex items-center justify-between border-b border-black/[0.06] bg-[#F5F4F1] px-3 py-1.5">
                <span className="text-xs text-[#6B7280]">源码</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="h-6 gap-1 text-xs text-[#E5A83D] hover:text-[#D4A035]"
                >
                  {uploading ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <ImagePlus className="size-3" />
                  )}
                  上传图片
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </div>
              <div
                ref={containerRef}
                className="min-h-0 flex-1 overflow-auto bg-[#FCFCFA]"
              >
                <Editor
                  className="html-editor"
                  value={code}
                  onValueChange={handleCodeChange}
                  highlight={highlightHtml}
                  onFocus={trackSelection}
                  padding={16}
                  style={{
                    fontFamily:
                      '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
                    fontSize: 13,
                    lineHeight: 1.6,
                    minHeight: "100%",
                  }}
                />
              </div>
            </div>

            {/* Right: preview */}
            <div className="flex w-1/2 min-w-0 flex-col overflow-hidden rounded-lg border border-black/[0.06] bg-white">
              <div className="flex items-center justify-between border-b border-black/[0.06] bg-[#F5F4F1] px-3 py-1.5">
                <span className="flex items-center gap-1.5 text-xs text-[#6B7280]">
                  {previewLoading && <Loader2 className="size-3 animate-spin" />}
                  实时预览
                </span>
              </div>
              <iframe
                srcDoc={previewHtml || html}
                sandbox="allow-scripts"
                className="flex-1"
                title="源码预览"
              />
            </div>
          </div>

          <p className="mt-3 flex items-start gap-1.5 text-xs text-[#6B7280]">
            <Info className="mt-0.5 size-3 shrink-0" />
            带 data-content 标记的元素文字由「内容配置」控制；上传的图片会插入光标处（编辑器未聚焦时追加到末尾）
          </p>

          {error && <p className="mt-2 text-sm text-red-500">{error}</p>}

          {/* Footer */}
          <div className="mt-4 flex justify-end gap-2 border-t border-black/[0.06] pt-4">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button
              onClick={handleSave}
              className="bg-[#E5A83D] text-[#181A1E] hover:bg-[#D4A035]"
            >
              保存
            </Button>
          </div>

          <style>{prismStyles}</style>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  )
}
