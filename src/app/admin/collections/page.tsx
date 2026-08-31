"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Library,
  ChevronUp,
  ChevronDown,
  ChevronRight,
  Search,
  ExternalLink,
} from "lucide-react"
import type { ArticleListItem } from "@/lib/articles"

interface CollectionItem {
  id: string
  name: string
  slug: string
  description: string | null
  coverImage: string | null
  articleCount: number
  createdAt: string
}

interface CollectionArticle extends ArticleListItem {
  position: number
}

export default function CollectionsPage() {
  const [collections, setCollections] = useState<CollectionItem[]>([])
  const [allArticles, setAllArticles] = useState<ArticleListItem[]>([])
  const [loading, setLoading] = useState(true)

  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<CollectionItem | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [name, setName] = useState("")
  const [slug, setSlug] = useState("")
  const [description, setDescription] = useState("")
  const [coverImage, setCoverImage] = useState("")

  const [manageId, setManageId] = useState<string | null>(null)
  const [manageArticles, setManageArticles] = useState<CollectionArticle[]>([])
  const [manageLoading, setManageLoading] = useState(false)
  const [addSearch, setAddSearch] = useState("")
  const [reordering, setReordering] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([fetch("/api/collections"), fetch("/api/articles")])
      .then(async (res) => {
        const [collectionsData, articlesData] = await Promise.all(
          res.map((r) => r.json())
        )
        if (cancelled) return
        setCollections(collectionsData)
        setAllArticles(articlesData)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  function openCreate() {
    setEditing(null)
    setName("")
    setSlug("")
    setDescription("")
    setCoverImage("")
    setError("")
    setEditorOpen(true)
  }

  function openEdit(c: CollectionItem) {
    setEditing(c)
    setName(c.name)
    setSlug(c.slug)
    setDescription(c.description ?? "")
    setCoverImage(c.coverImage ?? "")
    setError("")
    setEditorOpen(true)
  }

  async function handleSave() {
    const trimmed = name.trim()
    if (!trimmed) return
    setSaving(true)
    setError("")
    try {
      const body = {
        name: trimmed,
        slug: slug.trim() || undefined,
        description: description.trim() || null,
        coverImage: coverImage.trim() || null,
      }
      const res = await fetch(
        editing ? `/api/collections/${editing.id}` : "/api/collections",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "保存失败")
      setCollections((prev) =>
        editing
          ? prev.map((c) => (c.id === editing.id ? { ...c, ...data } : c))
          : [...prev, { ...data, articleCount: 0 }]
      )
      setEditorOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败")
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(c: CollectionItem) {
    if (!window.confirm(`确定删除合集「${c.name}」？文章不会被删除。`)) return
    const res = await fetch(`/api/collections/${c.id}`, { method: "DELETE" })
    if (res.ok) {
      setCollections((prev) => prev.filter((x) => x.id !== c.id))
      if (manageId === c.id) setManageId(null)
    }
  }

  async function toggleManage(id: string) {
    if (manageId === id) {
      setManageId(null)
      return
    }
    setManageId(id)
    setManageLoading(true)
    setAddSearch("")
    try {
      const res = await fetch(`/api/collections/${id}/articles`)
      const data = await res.json()
      setManageArticles(data.articles ?? [])
    } finally {
      setManageLoading(false)
    }
  }

  const applyOrder = useCallback(
    (ordered: CollectionArticle[]) => {
      setManageArticles(ordered)
      if (!manageId) return
      setReordering(true)
      fetch(`/api/collections/${manageId}/articles`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ articleIds: ordered.map((a) => a.id) }),
      })
        .then(async (res) => {
          if (res.ok) {
            const data = await res.json()
            setCollections((prev) =>
              prev.map((c) =>
                c.id === manageId ? { ...c, articleCount: data.articleCount } : c
              )
            )
          }
        })
        .finally(() => setReordering(false))
    },
    [manageId]
  )

  function handleMove(index: number, dir: -1 | 1) {
    const target = index + dir
    if (target < 0 || target >= manageArticles.length) return
    const next = [...manageArticles]
    ;[next[index], next[target]] = [next[target], next[index]]
    applyOrder(next)
  }

  function handleRemove(index: number) {
    applyOrder(manageArticles.filter((_, i) => i !== index))
  }

  function handleAdd(articleId: string) {
    const article = allArticles.find((a) => a.id === articleId)
    if (!article) return
    applyOrder([...manageArticles, { ...article, position: manageArticles.length }])
    setAddSearch("")
  }

  const candidates = useMemo(() => {
    const inList = new Set(manageArticles.map((a) => a.id))
    const q = addSearch.trim().toLowerCase()
    return allArticles.filter(
      (a) => !inList.has(a.id) && (!q || `${a.title} ${a.slug}`.toLowerCase().includes(q))
    )
  }, [allArticles, manageArticles, addSearch])

  return (
    <>
      <div className="flex flex-col gap-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-[#1C1C1E]">合集管理</h1>
            <p className="mt-1 text-sm text-[#6B7280]">
              将文章组织成有序的系列（类似掘金合集），详情页会展示合集进度
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open("/collections", "_blank")}
              className="gap-1.5"
            >
              <ExternalLink className="size-3.5" />
              查看合集页
            </Button>
            <Button
              onClick={openCreate}
              className="bg-[#E5A83D] text-[#181A1E] hover:bg-[#D4A035]"
            >
              <Plus className="size-4" />
              新建合集
            </Button>
          </div>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="size-5 animate-spin text-[#6B7280]" />
          </div>
        )}

        {/* Empty */}
        {!loading && collections.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-black/[0.08] bg-white/60 py-20">
            <Library className="size-10 text-[#E5A83D]/60" />
            <p className="mt-4 text-sm font-medium text-[#1C1C1E]">
              还没有任何合集
            </p>
            <p className="mt-1 text-sm text-[#6B7280]">
              创建合集后即可把多篇文章组织成有序系列
            </p>
            <Button
              variant="outline"
              onClick={openCreate}
              className="mt-5 gap-1.5"
            >
              <Plus className="size-3.5" />
              创建第一个合集
            </Button>
          </div>
        )}

        {/* Collection list */}
        {collections.length > 0 && (
          <div className="flex flex-col overflow-hidden rounded-xl border border-black/[0.06] bg-white">
            {collections.map((c, index) => (
              <div
                key={c.id}
                className={index > 0 ? "border-t border-black/[0.04]" : ""}
              >
                <div className="group flex items-center gap-4 px-4 py-3 transition-colors hover:bg-[#F5F4F1]">
                  <button
                    type="button"
                    onClick={() => toggleManage(c.id)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <ChevronRight
                      className={`size-4 shrink-0 text-[#6B7280] transition-transform ${
                        manageId === c.id ? "rotate-90" : ""
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[#1C1C1E]">
                        {c.name}
                      </p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-[#6B7280]">
                        <span className="rounded-full bg-[#E5A83D]/10 px-2 py-0.5 text-[#B08900]">
                          {c.articleCount} 篇文章
                        </span>
                        <span>/collections/{c.slug}</span>
                        {c.description && (
                          <span className="truncate text-[#6B7280]/70">
                            {c.description}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>

                  <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => toggleManage(c.id)}
                      title="管理文章"
                    >
                      <Library className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => openEdit(c)}
                      title="编辑"
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => handleDelete(c)}
                      className="text-red-400 hover:text-red-500"
                      title="删除"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>

                {/* Manage articles panel */}
                {manageId === c.id && (
                  <div className="border-t border-black/[0.04] bg-[#FAFAF8] px-4 py-4">
                    {manageLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="size-4 animate-spin text-[#6B7280]" />
                      </div>
                    ) : (
                      <div className="flex flex-col gap-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="relative">
                            <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-[#6B7280]" />
                            <Input
                              value={addSearch}
                              onChange={(e) => setAddSearch(e.target.value)}
                              placeholder="搜索文章添加到合集"
                              className="w-64 pl-8"
                            />
                          </div>
                          {addSearch && (
                            <div className="flex max-h-40 flex-col overflow-y-auto rounded-lg border border-black/[0.06] bg-white shadow-sm">
                              {candidates.length === 0 && (
                                <span className="px-3 py-2 text-xs text-[#6B7280]">
                                  没有可添加的文章
                                </span>
                              )}
                              {candidates.slice(0, 20).map((a) => (
                                <button
                                  key={a.id}
                                  type="button"
                                  onClick={() => handleAdd(a.id)}
                                  className="flex items-center gap-2 px-3 py-2 text-left text-sm text-[#1C1C1E] hover:bg-[#F5F4F1]"
                                >
                                  <Plus className="size-3.5 text-[#E5A83D]" />
                                  <span className="truncate">{a.title}</span>
                                </button>
                              ))}
                            </div>
                          )}
                          {reordering && (
                            <Loader2 className="size-3.5 animate-spin text-[#6B7280]" />
                          )}
                        </div>

                        {manageArticles.length === 0 ? (
                          <p className="py-6 text-center text-sm text-[#6B7280]">
                            该合集还没有文章，搜索上方添加
                          </p>
                        ) : (
                          <div className="flex flex-col overflow-hidden rounded-lg border border-black/[0.06] bg-white">
                            {manageArticles.map((a, i) => (
                              <div
                                key={a.id}
                                className={`flex items-center gap-3 px-3 py-2 ${
                                  i > 0 ? "border-t border-black/[0.04]" : ""
                                }`}
                              >
                                <span className="w-6 shrink-0 text-center text-xs text-[#6B7280]">
                                  {i + 1}
                                </span>
                                <span className="min-w-0 flex-1 truncate text-sm text-[#1C1C1E]">
                                  {a.title}
                                </span>
                                <span className="shrink-0 text-xs text-[#6B7280]">
                                  /{a.slug}
                                </span>
                                <div className="flex shrink-0 gap-0.5">
                                  <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    disabled={i === 0}
                                    onClick={() => handleMove(i, -1)}
                                    title="上移"
                                  >
                                    <ChevronUp className="size-3.5" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    disabled={i === manageArticles.length - 1}
                                    onClick={() => handleMove(i, 1)}
                                    title="下移"
                                  >
                                    <ChevronDown className="size-3.5" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    onClick={() => handleRemove(i)}
                                    className="text-red-400 hover:text-red-500"
                                    title="移除"
                                  >
                                    <Trash2 className="size-3.5" />
                                  </Button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create / edit dialog */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogPortal>
          <DialogOverlay />
          <DialogContent>
            <DialogTitle>
              {editing ? "编辑合集" : "新建合集"}
            </DialogTitle>
            <div className="flex flex-col gap-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-[#6B7280]">
                  名称（必填）
                </label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="如：前端进阶系列"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[#6B7280]">
                  Slug（链接，留空自动生成）
                </label>
                <Input
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder="frontend-advanced"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[#6B7280]">
                  简介
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="简要介绍这个合集的主题"
                  className="h-20 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[#6B7280]">
                  封面图链接（可选）
                </label>
                <Input
                  value={coverImage}
                  onChange={(e) => setCoverImage(e.target.value)}
                  placeholder="https://..."
                />
              </div>
              {error && <p className="text-sm text-red-500">{error}</p>}
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setEditorOpen(false)}
                >
                  取消
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={saving || !name.trim()}
                  className="bg-[#E5A83D] text-[#181A1E] hover:bg-[#D4A035]"
                >
                  {saving && <Loader2 className="size-3.5 animate-spin" />}
                  保存
                </Button>
              </div>
            </div>
          </DialogContent>
        </DialogPortal>
      </Dialog>
    </>
  )
}
