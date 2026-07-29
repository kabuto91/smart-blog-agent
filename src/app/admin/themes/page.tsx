"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { ThemeGenerateDialog } from "@/components/admin/theme-generate-dialog"
import { ContentEditorDialog } from "@/components/admin/content-editor-dialog"
import { Plus, Palette, Trash2, Eye, Settings, CheckCircle2, ExternalLink, Loader2 } from "lucide-react"
import type { ContentConfig } from "@/lib/types/content-config"

interface Theme {
  id: string
  name: string
  html: string
  contentConfig: ContentConfig | null
  isActive: boolean
  createdAt: string
}

export default function ThemesPage() {
  const [themes, setThemes] = useState<Theme[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)
  const [configEditThemeId, setConfigEditThemeId] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/themes")
      .then((res) => res.json())
      .then((data) => {
        setThemes(data)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const configEditTheme = themes.find((t) => t.id === configEditThemeId)

  async function handleSaved(html: string, contentConfig?: string) {
    const name = `主题 ${themes.length + 1}`
    const res = await fetch("/api/themes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, html, contentConfig }),
    })
    if (!res.ok) return
    const saved = await res.json()
    setThemes((prev) => [saved, ...prev])
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/themes/${id}`, { method: "DELETE" })
    if (!res.ok) return
    setThemes((prev) => prev.filter((t) => t.id !== id))
  }

  async function handleActivate(id: string) {
    const res = await fetch(`/api/themes/${id}/activate`, { method: "PUT" })
    if (!res.ok) return
    setThemes((prev) =>
      prev.map((t) => ({ ...t, isActive: t.id === id }))
    )
  }

  async function handleConfigSaved(config: ContentConfig) {
    if (!configEditThemeId) return
    const res = await fetch(`/api/themes/${configEditThemeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contentConfig: JSON.stringify(config) }),
    })
    if (!res.ok) return
    setThemes((prev) =>
      prev.map((t) =>
        t.id === configEditThemeId ? { ...t, contentConfig: config } : t
      )
    )
    setConfigEditThemeId(null)
  }

  const activeTheme = themes.find((t) => t.isActive)

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
          <div className="flex items-center gap-3">
            {activeTheme && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open("/blog", "_blank")}
                className="gap-1.5"
              >
                <ExternalLink className="size-3.5" />
                查看博客
              </Button>
            )}
            <Button
              onClick={() => setDialogOpen(true)}
              className="bg-[#E5A83D] text-[#181A1E] hover:bg-[#D4A035]"
            >
              <Plus className="size-4" />
              新建主题
            </Button>
          </div>
        </div>

        {/* Loading state */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="size-5 animate-spin text-[#6B7280]" />
          </div>
        )}

        {/* Empty state */}
        {!loading && themes.length === 0 && (
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

        {/* Active theme banner */}
        {activeTheme && !loading && (
          <div className="flex items-center gap-3 rounded-xl border border-[#E5A83D]/30 bg-[#E5A83D]/5 px-4 py-3">
            <CheckCircle2 className="size-5 text-[#E5A83D]" />
            <div className="flex-1">
              <p className="text-sm font-medium text-[#1C1C1E]">
                当前主题：{activeTheme.name}
              </p>
              <p className="text-xs text-[#6B7280]">
                博客将使用该主题进行展示
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open("/blog", "_blank")}
              className="gap-1.5"
            >
              <ExternalLink className="size-3.5" />
              预览博客
            </Button>
          </div>
        )}

        {/* Theme cards */}
        {themes.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {themes.map((theme) => (
              <div
                key={theme.id}
                className={`group relative overflow-hidden rounded-xl border bg-white shadow-sm transition-shadow hover:shadow-md ${
                  theme.isActive
                    ? "border-[#E5A83D] ring-1 ring-[#E5A83D]/30"
                    : "border-black/[0.06]"
                }`}
              >
                {/* Active badge */}
                {theme.isActive && (
                  <div className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-full bg-[#E5A83D] px-2.5 py-0.5 text-xs font-medium text-[#181A1E]">
                    <CheckCircle2 className="size-3" />
                    当前主题
                  </div>
                )}

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
                    <p className="text-xs text-[#6B7280]">
                      {theme.createdAt
                        ? new Date(theme.createdAt).toLocaleDateString("zh-CN")
                        : ""}
                    </p>
                  </div>
                  <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    {!theme.isActive && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => handleActivate(theme.id)}
                        title="设为主题"
                      >
                        <CheckCircle2 className="size-3.5" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setPreviewHtml(theme.html)}
                    >
                      <Eye className="size-3.5" />
                    </Button>
                    {theme.contentConfig && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setConfigEditThemeId(theme.id)}
                      >
                        <Settings className="size-3.5" />
                      </Button>
                    )}
                    {!theme.isActive && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => handleDelete(theme.id)}
                        className="text-red-400 hover:text-red-500"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    )}
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

      {/* Content config editor */}
      {configEditTheme && (
        <ContentEditorDialog
          open={true}
          onOpenChange={() => setConfigEditThemeId(null)}
          htmlTemplate={configEditTheme.html}
          initialConfig={configEditTheme.contentConfig ?? {}}
          onSave={handleConfigSaved}
        />
      )}

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
