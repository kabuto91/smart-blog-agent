"use client"

import { useState, useEffect, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ArticleEditorDialog } from "@/components/admin/article-editor-dialog"
import { MetaManagerDialog } from "@/components/admin/meta-manager-dialog"
import {
  FileText,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Tags,
  Search,
  ExternalLink,
} from "lucide-react"
import type {
  ArticleListItem,
  CategoryListItem,
  TagListItem,
} from "@/lib/articles"

export default function ArticlesPage() {
  const [articles, setArticles] = useState<ArticleListItem[]>([])
  const [categories, setCategories] = useState<CategoryListItem[]>([])
  const [tags, setTags] = useState<TagListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingArticle, setEditingArticle] = useState<ArticleListItem | null>(null)
  const [editorKey, setEditorKey] = useState(0)
  const [metaOpen, setMetaOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [categoryFilter, setCategoryFilter] = useState("")
  const [tagFilter, setTagFilter] = useState("")
  const [publishedFilter, setPublishedFilter] = useState("")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch("/api/articles"),
      fetch("/api/categories"),
      fetch("/api/tags"),
    ])
      .then(async (res) => {
        const [articlesData, categoriesData, tagsData] = await Promise.all(
          res.map((r) => r.json())
        )
        if (cancelled) return
        setArticles(articlesData)
        setCategories(categoriesData)
        setTags(tagsData)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(() => {
    return articles.filter((a) => {
      if (publishedFilter === "published" && !a.published) return false
      if (publishedFilter === "draft" && a.published) return false
      if (categoryFilter && a.category?.id !== categoryFilter) return false
      if (tagFilter && !a.tags.some((t) => t.id === tagFilter)) return false
      if (search) {
        const q = search.toLowerCase()
        const haystack = `${a.title} ${a.excerpt ?? ""}`.toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
  }, [articles, search, categoryFilter, tagFilter, publishedFilter])

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const paged = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  function openCreate() {
    setEditingArticle(null)
    setEditorKey((k) => k + 1)
    setEditorOpen(true)
  }

  function openEdit(article: ArticleListItem) {
    setEditingArticle(article)
    setEditorKey((k) => k + 1)
    setEditorOpen(true)
  }

  async function handleSaved(article: ArticleListItem) {
    setArticles((prev) => {
      const exists = prev.some((a) => a.id === article.id)
      return exists
        ? prev.map((a) => (a.id === article.id ? article : a))
        : [article, ...prev]
    })
  }

  async function handleTogglePublished(article: ArticleListItem) {
    const res = await fetch(`/api/articles/${article.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ published: !article.published }),
    })
    if (!res.ok) return
    const updated = await res.json()
    setArticles((prev) => prev.map((a) => (a.id === updated.id ? updated : a)))
  }

  async function handleDelete(article: ArticleListItem) {
    if (!window.confirm(`确定删除文章「${article.title}」？此操作不可恢复。`)) {
      return
    }
    const res = await fetch(`/api/articles/${article.id}`, { method: "DELETE" })
    if (res.ok) {
      setArticles((prev) => prev.filter((a) => a.id !== article.id))
    }
  }

  return (
    <>
      <div className="flex flex-col gap-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-[#1C1C1E]">文章管理</h1>
            <p className="mt-1 text-sm text-[#6B7280]">
              撰写、编辑 markdown 文章，并为文章设置分类和标签
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open("/blog", "_blank")}
              className="gap-1.5"
            >
              <ExternalLink className="size-3.5" />
              查看博客
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setMetaOpen(true)}
              className="gap-1.5"
            >
              <Tags className="size-3.5" />
              分类/标签管理
            </Button>
            <Button
              onClick={openCreate}
              className="bg-[#E5A83D] text-[#181A1E] hover:bg-[#D4A035]"
            >
              <Plus className="size-4" />
              新建文章
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-[#6B7280]" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
              placeholder="搜索标题或摘要"
              className="w-56 pl-8"
            />
          </div>
          <select
            value={categoryFilter}
            onChange={(e) => {
              setCategoryFilter(e.target.value)
              setPage(1)
            }}
            className="h-8 rounded-lg border border-input bg-white px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <option value="">全部分类</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            value={tagFilter}
            onChange={(e) => {
              setTagFilter(e.target.value)
              setPage(1)
            }}
            className="h-8 rounded-lg border border-input bg-white px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <option value="">全部标签</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <select
            value={publishedFilter}
            onChange={(e) => {
              setPublishedFilter(e.target.value)
              setPage(1)
            }}
            className="h-8 rounded-lg border border-input bg-white px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <option value="">全部状态</option>
            <option value="published">已发布</option>
            <option value="draft">草稿</option>
          </select>
          <span className="ml-auto text-xs text-[#6B7280]">
            共 {filtered.length} 篇
          </span>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="size-5 animate-spin text-[#6B7280]" />
          </div>
        )}

        {/* Empty state */}
        {!loading && articles.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-black/[0.08] bg-white/60 py-20">
            <FileText className="size-10 text-[#E5A83D]/60" />
            <p className="mt-4 text-sm font-medium text-[#1C1C1E]">
              还没有任何文章
            </p>
            <p className="mt-1 text-sm text-[#6B7280]">
              点击「新建文章」开始撰写你的第一篇文章
            </p>
            <Button
              variant="outline"
              onClick={openCreate}
              className="mt-5 gap-1.5"
            >
              <Plus className="size-3.5" />
              创建第一篇文章
            </Button>
          </div>
        )}

        {/* Empty filtered */}
        {!loading && articles.length > 0 && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-black/[0.08] bg-white/60 py-16">
            <Search className="size-8 text-[#6B7280]/50" />
            <p className="mt-3 text-sm text-[#6B7280]">没有符合筛选条件的文章</p>
          </div>
        )}

        {/* Article list */}
        {paged.length > 0 && (
          <div className="flex flex-col overflow-hidden rounded-xl border border-black/[0.06] bg-white">
            {paged.map((article, index) => (
              <div
                key={article.id}
                className={`group flex items-center gap-4 px-4 py-3 transition-colors hover:bg-[#F5F4F1] ${
                  index > 0 ? "border-t border-black/[0.04]" : ""
                }`}
              >
                {/* Cover thumbnail */}
                <div className="h-10 w-16 shrink-0 overflow-hidden rounded-md border border-black/[0.06] bg-[#F5F4F1]">
                  {article.coverImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={article.coverImage}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-[10px] text-[#9CA3AF]">
                      无封面
                    </span>
                  )}
                </div>
                {/* Title + meta */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {!article.published && (
                      <span className="rounded-full bg-[#F5F4F1] px-2 py-0.5 text-xs text-[#6B7280]">
                        草稿
                      </span>
                    )}
                    <p className="truncate text-sm font-medium text-[#1C1C1E]">
                      {article.title}
                    </p>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-[#6B7280]">
                    {article.category && (
                      <span className="rounded-full bg-[#E5A83D]/10 px-2 py-0.5 text-[#B08900]">
                        {article.category.name}
                      </span>
                    )}
                    {article.tags.map((t) => (
                      <span
                        key={t.id}
                        className="rounded-full bg-black/[0.04] px-2 py-0.5"
                      >
                        #{t.name}
                      </span>
                    ))}
                    <span className="text-[#6B7280]/70">
                      /{article.slug}
                    </span>
                    <span className="text-[#6B7280]/70">
                      {new Date(article.updatedAt).toLocaleDateString("zh-CN")}
                    </span>
                  </div>
                </div>

                {/* Publish toggle */}
                <button
                  type="button"
                  onClick={() => handleTogglePublished(article)}
                  className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                    article.published ? "bg-[#E5A83D]" : "bg-black/[0.12]"
                  }`}
                  title={article.published ? "取消发布" : "发布"}
                >
                  <span
                    className={`absolute top-0.5 size-4 rounded-full bg-white shadow transition-all ${
                      article.published ? "left-4.5" : "left-0.5"
                    }`}
                  />
                </button>

                {/* Actions */}
                <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => openEdit(article)}
                    title="编辑"
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => handleDelete(article)}
                    className="text-red-400 hover:text-red-500"
                    title="删除"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-black/[0.06] bg-white px-4 py-3">
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                disabled={safePage <= 1}
                onClick={() => setPage(safePage - 1)}
              >
                上一页
              </Button>
              <span className="px-2 text-sm text-[#6B7280]">
                第 {safePage} / {totalPages} 页
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={safePage >= totalPages}
                onClick={() => setPage(safePage + 1)}
              >
                下一页
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-[#6B7280]">每页</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value))
                  setPage(1)
                }}
                className="h-8 rounded-lg border border-input bg-white px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {[10, 20, 50, 100].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Editor dialog */}
      <ArticleEditorDialog
        key={editorKey}
        open={editorOpen}
        onOpenChange={setEditorOpen}
        article={editingArticle}
        categories={categories}
        tags={tags}
        onSaved={handleSaved}
        onTagCreated={(tag) => setTags((prev) => [...prev, tag])}
      />

      {/* Meta manager */}
      <MetaManagerDialog
        key={metaOpen ? "open" : "closed"}
        open={metaOpen}
        onOpenChange={setMetaOpen}
        categories={categories}
        tags={tags}
        onCategoriesChanged={setCategories}
        onTagsChanged={setTags}
      />
    </>
  )
}
