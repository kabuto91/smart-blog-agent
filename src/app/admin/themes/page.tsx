"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { ThemeGenerateDialog } from "@/components/admin/theme-generate-dialog"
import { Plus, Palette, Trash2, Eye } from "lucide-react"

interface Theme {
  id: string
  name: string
  html: string
  createdAt: string
}

export default function ThemesPage() {
  const [themes, setThemes] = useState<Theme[]>([])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)

  function handleSaved(html: string) {
    const name = `主题 ${themes.length + 1}`
    const newTheme: Theme = {
      id: crypto.randomUUID(),
      name,
      html,
      createdAt: new Date().toLocaleDateString("zh-CN"),
    }
    setThemes((prev) => [newTheme, ...prev])
  }

  function handleDelete(id: string) {
    setThemes((prev) => prev.filter((t) => t.id !== id))
  }

  return (
    <>
      <div className="flex flex-col gap-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-[#1C1C1E]">主题管理</h1>
            <p className="mt-1 text-sm text-[#6B7280]">
              通过自然语言描述生成博客主题并预览
            </p>
          </div>
          <Button
            onClick={() => setDialogOpen(true)}
            className="bg-[#E5A83D] text-[#181A1E] hover:bg-[#D4A035]"
          >
            <Plus className="size-4" />
            新建主题
          </Button>
        </div>

        {/* Empty state */}
        {themes.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-black/[0.08] bg-white/60 py-20">
            <Palette className="size-10 text-[#E5A83D]/60" />
            <p className="mt-4 text-sm font-medium text-[#1C1C1E]">
              还没有创建任何主题
            </p>
            <p className="mt-1 text-sm text-[#6B7280]">
              点击「新建主题」，用一段话描述你想要的博客风格
            </p>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(true)}
              className="mt-5 gap-1.5"
            >
              <Plus className="size-3.5" />
              创建第一个主题
            </Button>
          </div>
        )}

        {/* Theme cards */}
        {themes.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {themes.map((theme) => (
              <div
                key={theme.id}
                className="group relative overflow-hidden rounded-xl border border-black/[0.06] bg-white shadow-sm transition-shadow hover:shadow-md"
              >
                {/* Thumbnail */}
                <div className="h-40 overflow-hidden border-b border-black/[0.06] bg-[#F5F4F1]">
                  <iframe
                    srcDoc={theme.html}
                    sandbox="allow-scripts"
                    className="pointer-events-none h-[600px] w-full origin-top scale-[0.42] transform"
                    title={theme.name}
                  />
                </div>

                {/* Info */}
                <div className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-[#1C1C1E]">
                      {theme.name}
                    </p>
                    <p className="text-xs text-[#6B7280]">{theme.createdAt}</p>
                  </div>
                  <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setPreviewHtml(theme.html)}
                    >
                      <Eye className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => handleDelete(theme.id)}
                      className="text-red-400 hover:text-red-500"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Generate dialog */}
      <ThemeGenerateDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSaved={handleSaved}
      />

      {/* Full preview modal */}
      {previewHtml && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setPreviewHtml(null)}
        >
          <div
            className="mx-4 flex h-[85vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-black/[0.06] px-4 py-3">
              <span className="text-sm font-medium text-[#1C1C1E]">主题预览</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPreviewHtml(null)}
              >
                关闭
              </Button>
            </div>
            <iframe
              srcDoc={previewHtml}
              sandbox="allow-scripts"
              className="flex-1"
              title="主题预览"
            />
          </div>
        </div>
      )}
    </>
  )
}
