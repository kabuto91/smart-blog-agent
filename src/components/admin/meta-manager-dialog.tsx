"use client"

import { useState } from "react"
import {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Loader2, Pencil, Trash2, Plus, X, Check, Download } from "lucide-react"
import type { CategoryListItem, TagListItem } from "@/lib/articles"

interface MetaManagerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  categories: CategoryListItem[]
  tags: TagListItem[]
  onCategoriesChanged: (categories: CategoryListItem[]) => void
  onTagsChanged: (tags: TagListItem[]) => void
}

type TabKey = "categories" | "tags"

export function MetaManagerDialog({
  open,
  onOpenChange,
  categories,
  tags,
  onCategoriesChanged,
  onTagsChanged,
}: MetaManagerDialogProps) {
  const [tab, setTab] = useState<TabKey>("categories")
  const [name, setName] = useState("")
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState("")
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState("")
  const [importing, setImporting] = useState(false)

  function handleTabChange(next: TabKey) {
    setTab(next)
    setName("")
    setAdding(false)
    setError("")
    setEditingId(null)
  }

  const items = tab === "categories" ? categories : tags
  const apiBase = tab === "categories" ? "/api/categories" : "/api/tags"

  async function handleAdd() {
    const trimmed = name.trim()
    if (!trimmed) return
    setAdding(true)
    setError("")
    try {
      const res = await fetch(apiBase, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "创建失败")
      if (tab === "categories") {
        onCategoriesChanged([
          ...categories,
          { ...data, articleCount: 0 },
        ])
      } else {
        onTagsChanged([...tags, { ...data, articleCount: 0 }])
      }
      setName("")
    } catch (e) {
      setError(e instanceof Error ? e.message : "创建失败")
    } finally {
      setAdding(false)
    }
  }

  async function handleRename(id: string) {
    const trimmed = editName.trim()
    if (!trimmed) return
    setError("")
    try {
      const res = await fetch(`${apiBase}/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "重命名失败")
      const list = tab === "categories" ? categories : tags
      const changed = list.map((item) =>
        item.id === id
          ? { ...item, name: data.name, slug: data.slug }
          : item
      )
      if (tab === "categories") {
        onCategoriesChanged(changed as CategoryListItem[])
      } else {
        onTagsChanged(changed as TagListItem[])
      }
      setEditingId(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : "重命名失败")
    }
  }

  async function handleImportFromJuejin() {
    if (
      !window.confirm(
        "将从掘金导入其全部官方标签，并删除当前所有标签及文章与标签的关联（不可恢复）。确定继续？"
      )
    ) {
      return
    }
    setImporting(true)
    setError("")
    try {
      const res = await fetch("/api/tags/import-from-juejin", { method: "POST" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "导入失败")
      const reload = await fetch("/api/tags")
      if (reload.ok) {
        onTagsChanged(await reload.json())
      }
      setError(`导入完成：${data.message}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : "导入失败")
    } finally {
      setImporting(false)
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("删除后不可恢复，确定删除？")) return
    setError("")
    try {
      const res = await fetch(`${apiBase}/${id}`, { method: "DELETE" })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "删除失败")
      }
      if (tab === "categories") {
        onCategoriesChanged(categories.filter((c) => c.id !== id))
      } else {
        onTagsChanged(tags.filter((t) => t.id !== id))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败")
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogContent
          className="sm:max-w-xl"
          showCloseButton={false}
        >
          <DialogTitle className="pb-3 text-[#1C1C1E]">分类与标签管理</DialogTitle>

          {/* Tabs */}
          <div className="flex gap-1 rounded-lg bg-[#F5F4F1] p-1">
            {(
              [
                { key: "categories", label: `分类 (${categories.length})` },
                { key: "tags", label: `标签 (${tags.length})` },
              ] as { key: TabKey; label: string }[]
            ).map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => handleTabChange(key)}
                className={`flex-1 rounded-md py-1.5 text-sm transition-colors ${
                  tab === key
                    ? "bg-white font-medium text-[#1C1C1E] shadow-sm"
                    : "text-[#6B7280] hover:text-[#1C1C1E]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Add form */}
          <div className="flex gap-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  handleAdd()
                }
              }}
              placeholder={tab === "categories" ? "新分类名称" : "新标签名称"}
              className="flex-1"
            />
            <Button
              onClick={handleAdd}
              disabled={!name.trim() || adding}
              className="gap-1 bg-[#E5A83D] text-[#181A1E] hover:bg-[#D4A035]"
            >
              {adding ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              添加
            </Button>
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          {tab === "tags" && (
            <Button
              variant="outline"
              onClick={handleImportFromJuejin}
              disabled={importing}
              className="w-full gap-1.5 text-sm"
            >
              {importing ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Download className="size-4" />
              )}
              {importing ? "正在从掘金导入…" : "从掘金导入全部官方标签"}
            </Button>
          )}

          {/* List */}
          <div className="max-h-80 overflow-y-auto rounded-lg border border-black/[0.06]">
            {items.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10">
                <p className="text-sm text-[#6B7280]">
                  {tab === "categories" ? "还没有分类" : "还没有标签"}
                </p>
                <p className="mt-1 text-xs text-[#6B7280]/60">
                  在上方输入名称创建一个
                </p>
              </div>
            ) : (
              <div className="flex flex-col">
                {items.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 border-b border-black/[0.04] px-4 py-2.5 last:border-b-0"
                  >
                    {editingId === item.id ? (
                      <>
                        <Input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault()
                              handleRename(item.id)
                            }
                            if (e.key === "Escape") setEditingId(null)
                          }}
                          autoFocus
                          className="h-7 flex-1 px-2 text-sm"
                        />
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => handleRename(item.id)}
                          className="text-green-600"
                        >
                          <Check className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => setEditingId(null)}
                        >
                          <X className="size-3.5" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-[#1C1C1E]">
                            {item.name}
                          </p>
                          <p className="truncate text-xs text-[#6B7280]">
                            /{item.slug} · {item.articleCount} 篇
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => {
                            setEditingId(item.id)
                            setEditName(item.name)
                          }}
                          title="重命名"
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => handleDelete(item.id)}
                          className="text-red-400 hover:text-red-500"
                          title="删除"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-2 border-t border-black/[0.06] pt-4">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              关闭
            </Button>
          </div>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  )
}
