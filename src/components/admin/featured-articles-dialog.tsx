"use client"

import { useEffect, useState } from "react"
import {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import {
  Star,
  ChevronUp,
  ChevronDown,
  Loader2,
  Save,
  X,
} from "lucide-react"
import type { ArticleListItem } from "@/lib/articles"

interface FeaturedArticlesDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  articles: ArticleListItem[]
}

interface BlockDef {
  key: string
  label: string
  description: string
}

/** 左侧区块列表。当前内置「精选文章」区块，后续可按需扩展自定义区块。 */
const BLOCKS: BlockDef[] = [
  {
    key: "featured-articles",
    label: "精选文章",
    description: "填充主题中「精选文章（featured-articles）」区块；最新文章自动取最新发布，无需配置",
  },
]

/**
 * 精选文章内置区块弹窗：左侧为竖向区块列表，右侧为「可选文章」与「已选文章」。
 */
export function FeaturedArticlesDialog({
  open,
  onOpenChange,
  articles,
}: FeaturedArticlesDialogProps) {
  const published = articles.filter((a) => a.published)
  const [activeKey, setActiveKey] = useState(BLOCKS[0].key)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [message, setMessage] = useState("")

  const load = () => {
    setLoading(true)
    setMessage("")
    fetch("/api/articles/featured")
      .then((res) => res.json())
      .then((data) => {
        setSelectedIds(
          (data.ids ?? []).filter((id: string) =>
            articles.some((a) => a.id === id)
          )
        )
        setDirty(false)
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (open) {
      setActiveKey(BLOCKS[0].key)
      load()
    }
    // 依赖稳定的 props.articles，避免每帧重建导致无限重载/抖动
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, articles])

  const selected = selectedIds
    .map((id) => published.find((a) => a.id === id))
    .filter((a): a is ArticleListItem => Boolean(a))
  const unselected = published.filter((a) => !selectedIds.includes(a.id))
  const selectedSet = new Set(selectedIds)
  const activeBlock = BLOCKS.find((b) => b.key === activeKey) ?? BLOCKS[0]

  function toggle(id: string) {
    setMessage("")
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
    setDirty(true)
  }

  function move(id: string, dir: -1 | 1) {
    setMessage("")
    setSelectedIds((prev) => {
      const idx = prev.indexOf(id)
      if (idx < 0) return prev
      const target = idx + dir
      if (target < 0 || target >= prev.length) return prev
      const next = prev.slice()
      ;[next[idx], next[target]] = [next[target], next[idx]]
      return next
    })
    setDirty(true)
  }

  async function handleSave() {
    setSaving(true)
    setMessage("")
    try {
      const res = await fetch("/api/articles/featured", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedIds }),
      })
      if (!res.ok) throw new Error("保存失败")
      setDirty(false)
      setMessage("已保存")
    } catch {
      setMessage("保存失败，请重试")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogContent className="w-[min(72rem,95vw)] max-w-none sm:max-w-none">
          <DialogTitle>区块：文章内容</DialogTitle>

          {/* 顶部操作栏 */}
          <div className="flex items-center justify-between gap-3 border-b border-black/[0.04] px-5 pb-3 pt-1">
            <p className="text-xs text-[#6B7280]">
              配置各内置区块展示哪些文章，渲染时主题对应区块会自动替换
            </p>
            <div className="flex items-center gap-2">
              {message && <span className="text-xs text-[#6B7280]">{message}</span>}
              <Button
                variant="outline"
                size="sm"
                disabled={!dirty || saving || loading}
                onClick={handleSave}
                className="gap-1.5"
              >
                {saving ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Save className="size-3.5" />
                )}
                保存
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-[220px_1fr] gap-4 p-5">
            {/* 左侧：区块列表 */}
            <div className="flex flex-col gap-1.5 border-r border-black/[0.06] pr-4">
              {BLOCKS.map((block) => (
                <button
                  key={block.key}
                  type="button"
                  onClick={() => setActiveKey(block.key)}
                  className={`flex flex-col gap-0.5 rounded-lg px-3 py-2.5 text-left transition-colors ${
                    block.key === activeKey
                      ? "bg-[#E5A83D]/10 text-[#1C1C1E]"
                      : "hover:bg-[#F5F4F1]"
                  }`}
                >
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    <Star
                      className={`size-3.5 ${block.key === activeKey ? "text-[#E5A83D] fill-[#E5A83D]/30" : "text-[#9CA3AF]"}`}
                    />
                    {block.label}
                  </span>
                  {block.key === activeKey && (
                    <span className="text-xs text-[#6B7280]">
                      已选 {selected.length}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* 右侧：可选 / 已选文章 */}
            <div className="min-w-0">
              <p className="mb-3 text-xs leading-relaxed text-[#6B7280]">
                {activeBlock.description}
              </p>
              <div className="grid gap-4 lg:grid-cols-2">
                {/* 已选 */}
                <div className="min-w-0">
                  <p className="mb-2 text-xs font-medium text-[#1C1C1E]">
                    已选文章（{selected.length}）· 顺序即展示顺序
                  </p>
                  <div className="flex max-h-72 flex-col gap-1.5 overflow-y-auto pr-1">
                    {loading && (
                      <div className="flex items-center justify-center py-6 text-[#6B7280]">
                        <Loader2 className="size-4 animate-spin" />
                      </div>
                    )}
                    {!loading && selected.length === 0 && (
                      <div className="rounded-lg border border-dashed border-black/[0.08] px-3 py-4 text-center text-xs text-[#9CA3AF]">
                        尚未选择文章
                      </div>
                    )}
                    {selected.map((a, i) => (
                      <div
                        key={a.id}
                        className="flex items-center gap-2 rounded-lg border border-black/[0.06] bg-[#F5F4F1] px-3 py-2"
                      >
                        <span className="min-w-0 flex-1 truncate text-sm text-[#1C1C1E]">
                          {i + 1}. {a.title}
                        </span>
                        <button
                          type="button"
                          onClick={() => move(a.id, -1)}
                          disabled={i === 0}
                          className="text-[#6B7280] disabled:opacity-30"
                          title="上移"
                        >
                          <ChevronUp className="size-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => move(a.id, 1)}
                          disabled={i === selected.length - 1}
                          className="text-[#6B7280] disabled:opacity-30"
                          title="下移"
                        >
                          <ChevronDown className="size-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => toggle(a.id)}
                          className="text-[#9CA3AF] hover:text-red-500"
                          title="移除"
                        >
                          <X className="size-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 可选 */}
                <div className="min-w-0">
                  <p className="mb-2 text-xs font-medium text-[#1C1C1E]">
                    可选文章
                  </p>
                  <div className="flex max-h-72 flex-col gap-1.5 overflow-y-auto pr-1">
                    {!loading && unselected.length === 0 && (
                      <div className="rounded-lg border border-dashed border-black/[0.08] px-3 py-4 text-center text-xs text-[#9CA3AF]">
                        没有可加入的文章
                      </div>
                    )}
                    {unselected.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => toggle(a.id)}
                        className="flex items-center gap-2 rounded-lg border border-black/[0.06] bg-white px-3 py-2 text-left transition-colors hover:bg-[#F5F4F1]"
                      >
                        <Star
                          className={`size-3.5 shrink-0 ${selectedSet.has(a.id) ? "text-[#E5A83D]" : "text-[#9CA3AF]"}`}
                        />
                        <span className="min-w-0 flex-1 truncate text-sm text-[#1C1C1E]">
                          {a.title}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  )
}