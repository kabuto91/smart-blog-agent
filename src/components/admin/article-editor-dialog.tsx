"use client"

import { useState, useMemo, useRef } from "react"
import Editor from "react-simple-code-editor"
import Prism from "prismjs"
import "prismjs/components/prism-markdown"
import { marked } from "marked"
import {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Loader2, ImagePlus, Info, Plus, X } from "lucide-react"
import type { ArticleListItem, CategoryListItem, TagListItem } from "@/lib/articles"

interface ArticleEditorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  article: ArticleListItem | null
  categories: CategoryListItem[]
  tags: TagListItem[]
  onSaved: (article: ArticleListItem) => void
  onTagCreated?: (tag: TagListItem) => void
}

function highlightMarkdown(code: string) {
  return Prism.highlight(code, Prism.languages.markdown, "markdown")
}

function localSlugify(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fa5-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "") || ""
  )
}

const prismStyles = `
.md-editor .token.title.important,
.md-editor .token.heading { color: #dd4a68; font-weight: 600; }
.md-editor .token.code { color: #e90; }
.md-editor .token.list,
.md-editor .token.bullet { color: #905; }
.md-editor .token.url { color: #07a; }
.md-editor .token.string { color: #690; }
.md-editor .token.emphasis,
.md-editor .token.italic { font-style: italic; }
.md-editor .token.strong { font-weight: bold; }
`

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

export function ArticleEditorDialog({
  open,
  onOpenChange,
  article,
  categories,
  tags,
  onSaved,
  onTagCreated,
}: ArticleEditorDialogProps) {
  const [title, setTitle] = useState(article?.title ?? "")
  const [slug, setSlug] = useState(article?.slug ?? "")
  const [excerpt, setExcerpt] = useState(article?.excerpt ?? "")
  const [content, setContent] = useState(article?.content ?? "")
  const [published, setPublished] = useState(article?.published ?? false)
  const [categoryId, setCategoryId] = useState<string>(article?.category?.id ?? "")
  const [tagIds, setTagIds] = useState<string[]>(article?.tags.map((t) => t.id) ?? [])
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [newTagName, setNewTagName] = useState("")
  const [addingTag, setAddingTag] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const editorTouchedRef = useRef(false)

  const previewHtml = useMemo(
    () => (open ? (marked.parse(content, { async: false }) as string) : ""),
    [content, open]
  )

  function handleTitleChange(value: string) {
    setTitle(value)
    if (!slug) setSlug(localSlugify(value))
  }

  function toggleTag(id: string) {
    setTagIds((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    )
  }

  async function handleAddTag() {
    const name = newTagName.trim()
    if (!name) return
    setAddingTag(true)
    setError("")
    try {
      const res = await fetch("/api/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "创建标签失败")
      setNewTagName("")
      setTagIds((prev) => [...prev, data.id])
      onTagCreated?.(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : "创建标签失败")
    } finally {
      setAddingTag(false)
    }
  }

  function handleCodeChange(value: string) {
    setContent(value)
  }

  function trackSelection() {
    editorTouchedRef.current = true
  }

  async function handleUpload(file: File) {
    setUploading(true)
    setError("")

    const ta = containerRef.current?.querySelector("textarea")
    const start = editorTouchedRef.current && ta ? ta.selectionStart : content.length
    const end = editorTouchedRef.current && ta ? ta.selectionEnd : content.length

    try {
      const formData = new FormData()
      formData.append("file", file)
      const res = await fetch("/api/uploads", { method: "POST", body: formData })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "上传失败")

      const imgMarkdown = `![${file.name.replace(/["\[\]]/g, "")}](${data.url})`
      const next = content.slice(0, start) + imgMarkdown + content.slice(end)
      setContent(next)

      requestAnimationFrame(() => {
        const ta = containerRef.current?.querySelector("textarea")
        if (ta) {
          const pos = start + imgMarkdown.length
          ta.selectionStart = pos
          ta.selectionEnd = pos
          ta.focus()
        }
      })
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

  async function handleSave() {
    if (!title.trim()) {
      setError("请填写文章标题")
      return
    }
    if (!slug.trim()) {
      setError("请填写 slug（用于博客链接）")
      return
    }
    setSaving(true)
    setError("")
    try {
      const body = {
        title: title.trim(),
        slug: slug.trim(),
        content,
        excerpt: excerpt.trim() || undefined,
        published,
        categoryId: categoryId || null,
        tagIds,
      }
      const url = article ? `/api/articles/${article.id}` : "/api/articles"
      const res = await fetch(url, {
        method: article ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "保存失败")
      onSaved(data)
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败")
    } finally {
      setSaving(false)
    }
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
            {article ? "编辑文章" : "新建文章"}
          </DialogTitle>

          <div className="flex max-h-[78vh] flex-col gap-4">
            {/* Metadata */}
            <div className="grid grid-cols-1 gap-3 rounded-lg border border-black/[0.06] bg-white p-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium text-[#6B7280]">
                  标题
                </label>
                <Input
                  value={title}
                  onChange={(e) => handleTitleChange(e.target.value)}
                  placeholder="文章标题"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[#6B7280]">
                  Slug（博客链接，需唯一）
                </label>
                <Input
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder="my-article"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[#6B7280]">
                  分类
                </label>
                <select
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <option value="">未分类</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium text-[#6B7280]">
                  摘要（留空时自动从正文生成）
                </label>
                <Input
                  value={excerpt}
                  onChange={(e) => setExcerpt(e.target.value)}
                  placeholder="文章摘要"
                />
              </div>
              <div className="sm:col-span-2">
                <div className="mb-1 flex items-center justify-between">
                  <label className="text-xs font-medium text-[#6B7280]">
                    标签（点击切换）
                  </label>
                  {!addingTag ? (
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => setAddingTag(true)}
                      className="gap-0.5 text-[#E5A83D] hover:text-[#D4A035]"
                    >
                      <Plus className="size-3" />
                      新建标签
                    </Button>
                  ) : (
                    <div className="flex items-center gap-1">
                      <Input
                        value={newTagName}
                        onChange={(e) => setNewTagName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault()
                            handleAddTag()
                          }
                        }}
                        placeholder="标签名称"
                        className="h-6 w-32 px-2 text-xs"
                        autoFocus
                      />
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={handleAddTag}
                        disabled={addingTag}
                        className="text-[#E5A83D] hover:text-[#D4A035]"
                      >
                        {addingTag ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <Plus className="size-3" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => {
                          setAddingTag(false)
                          setNewTagName("")
                        }}
                      >
                        <X className="size-3" />
                      </Button>
                    </div>
                  )}
                </div>
                {tags.length > 0 || tagIds.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {tags.map((t) => {
                      const selected = tagIds.includes(t.id)
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => toggleTag(t.id)}
                          className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
                            selected
                              ? "border-[#E5A83D] bg-[#E5A83D] text-[#181A1E]"
                              : "border-black/[0.08] bg-white text-[#6B7280] hover:border-[#E5A83D]/40"
                          }`}
                        >
                          {t.name}
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-[#6B7280]/60">暂无标签，可点击右上角新建</p>
                )}
              </div>
            </div>

            {/* Editor split */}
            <div className="flex min-h-0 flex-1 gap-4">
              {/* Left: code editor */}
              <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-black/[0.06] bg-white">
                <div className="flex items-center justify-between border-b border-black/[0.06] bg-[#F5F4F1] px-3 py-1.5">
                  <span className="text-xs text-[#6B7280]">Markdown 源码</span>
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
                    className="md-editor"
                    value={content}
                    onValueChange={handleCodeChange}
                    highlight={highlightMarkdown}
                    onFocus={trackSelection}
                    padding={16}
                    textareaClassName="focus:outline-none"
                    style={{
                      fontFamily:
                        '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
                      fontSize: 13,
                      lineHeight: 1.7,
                      minHeight: "100%",
                    }}
                  />
                </div>
              </div>

              {/* Right: preview */}
              <div className="flex w-1/2 min-w-0 flex-col overflow-hidden rounded-lg border border-black/[0.06] bg-white">
                <div className="border-b border-black/[0.06] bg-[#F5F4F1] px-3 py-1.5">
                  <span className="text-xs text-[#6B7280]">实时预览</span>
                </div>
                <div className="article-preview min-h-0 flex-1 overflow-auto bg-white p-6">
                  {previewHtml ? (
                    <div
                      dangerouslySetInnerHTML={{ __html: previewHtml }}
                    />
                  ) : (
                    <p className="text-sm text-[#6B7280]/60">
                      在左侧输入 markdown，右侧实时预览渲染效果
                    </p>
                  )}
                </div>
              </div>
            </div>

            <p className="flex items-start gap-1.5 text-xs text-[#6B7280]">
              <Info className="mt-0.5 size-3 shrink-0" />
              支持 GitHub 风格 markdown；上传的图片会以 markdown 语法插入光标处（编辑器未聚焦时追加到末尾）
            </p>

            {error && <p className="text-sm text-red-500">{error}</p>}

            {/* Footer */}
            <div className="flex justify-end gap-2 border-t border-black/[0.06] pt-4">
              <label className="mr-auto flex cursor-pointer items-center gap-2 text-sm text-[#6B7280]">
                <input
                  type="checkbox"
                  checked={published}
                  onChange={(e) => setPublished(e.target.checked)}
                  className="size-4 accent-[#E5A83D]"
                />
                发布（勾选后博客前台可见）
              </label>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                取消
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving}
                className="bg-[#E5A83D] text-[#181A1E] hover:bg-[#D4A035]"
              >
                {saving ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  "保存"
                )}
              </Button>
            </div>
          </div>

          <style>{prismStyles}</style>
          <style>{previewStyles}</style>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  )
}
