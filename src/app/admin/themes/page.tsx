"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { ThemeGenerateDialog } from "@/components/admin/theme-generate-dialog"
import { ContentEditorDialog } from "@/components/admin/content-editor-dialog"
import { HtmlEditorDialog } from "@/components/admin/html-editor-dialog"
import { Plus, Palette, Trash2, Eye, Settings, CheckCircle2, ExternalLink, Loader2, Code, LayoutTemplate } from "lucide-react"
import type { ContentConfig } from "@/lib/types/content-config"
import { injectPageIntoLayout } from "@/lib/theme/layout-inject"

interface ThemePage {
  id: string
  type: string
  route: string | null
  name: string
  html: string
  contentConfig: ContentConfig | null
}

interface Theme {
  id: string
  name: string
  layoutHtml: string
  contentConfig: ContentConfig | null
  isActive: boolean
  createdAt: string
  pages: ThemePage[]
}

interface GeneratedPage {
  type: string
  html: string
  contentConfig?: string
}

export default function ThemesPage() {
  const [themes, setThemes] = useState<Theme[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [preview, setPreview] = useState<{ theme: Theme; page: ThemePage } | null>(null)
  const [configEdit, setConfigEdit] = useState<{ theme: Theme; page: ThemePage | null } | null>(null)
  const [htmlEdit, setHtmlEdit] = useState<{ theme: Theme; page: ThemePage | null } | null>(null)

  useEffect(() => {
    fetch("/api/themes")
      .then((res) => res.json())
      .then((data) => {
        setThemes(data)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  async function handleSaved(payload: {
    layoutHtml: string
    pages: GeneratedPage[]
    contentConfig?: string
  }) {
    const name = `主题 ${themes.length + 1}`
    const res = await fetch("/api/themes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        layoutHtml: payload.layoutHtml,
        pages: payload.pages.map((p, i) => ({
          type: p.type,
          name: p.type === "home" ? "首页" : p.type === "list" ? "文章列表页" : "文章详情页",
          html: p.html,
          contentConfig: p.contentConfig,
          sortOrder: i,
        })),
        contentConfig: payload.contentConfig,
      }),
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

  async function handlePageSaved(themeId: string, page: ThemePage | null, html: string) {
    if (!page) {
      // 编辑共享布局
      const res = await fetch(`/api/themes/${themeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layoutHtml: html }),
      })
      if (!res.ok) return
      const saved = await res.json()
      setThemes((prev) => prev.map((t) => (t.id === themeId ? saved : t)))
      setHtmlEdit(null)
      return
    }
    const res = await fetch(`/api/themes/${themeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pages: [
          {
            type: page.type,
            route: page.route,
            name: page.name,
            html,
          },
        ],
      }),
    })
    if (!res.ok) return
    const saved = await res.json()
    setThemes((prev) => prev.map((t) => (t.id === themeId ? saved : t)))
    setHtmlEdit(null)
  }

  async function handleConfigSaved(theme: Theme, page: ThemePage | null, config: ContentConfig) {
    // 页面级配置写入对应页面行，避免整体覆盖主题级（布局/导航）配置
    const body: Record<string, unknown> = page
      ? {
          pages: [
            {
              type: page.type,
              route: page.route,
              name: page.name,
              contentConfig: JSON.stringify(config),
            },
          ],
        }
      : { contentConfig: JSON.stringify(config) }
    const res = await fetch(`/api/themes/${theme.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    if (!res.ok) return
    const saved = await res.json()
    setThemes((prev) => prev.map((t) => (t.id === theme.id ? saved : t)))
    setConfigEdit(null)
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
              通过自然语言描述生成博客主题并预览（每个页面一行管理）
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

                {/* Info */}
                <div className="px-4 pt-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-[#1C1C1E]">
                        {theme.name}
                      </p>
                      <p className="mt-0.5 text-xs text-[#6B7280]">
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

                {/* Page rows */}
                <div className="mt-3 flex flex-col border-t border-black/[0.06]">
                  {theme.pages.map((page) => (
                    <div
                      key={page.id}
                      className="flex items-center justify-between border-b border-black/[0.04] px-4 py-2 last:border-b-0"
                    >
                      <span className="text-xs font-medium text-[#1C1C1E]">
                        {page.name}
                      </span>
                      <div className="flex gap-0.5">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => setPreview({ theme, page })}
                          title="预览页面"
                        >
                          <Eye className="size-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => setHtmlEdit({ theme, page })}
                          title="编辑HTML"
                        >
                          <Code className="size-3" />
                        </Button>
                        {page.contentConfig && (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setConfigEdit({ theme, page })}
                            title="内容配置"
                          >
                            <Settings className="size-3" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}

                  {/* Layout / styles row */}
                  <div className="flex items-center justify-between bg-[#F5F4F1] px-4 py-2">
<span className="text-xs font-medium text-[#6B7280]">
  共享布局 / 导航 / 样式
</span>
                    <div className="flex gap-0.5">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setHtmlEdit({ theme, page: null })}
                        title="编辑共享布局与样式"
                      >
                        <LayoutTemplate className="size-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setConfigEdit({ theme, page: null })}
                        title="导航链接 / 布局内容配置"
                      >
                        <Settings className="size-3" />
                      </Button>
                    </div>
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
      {configEdit && (
        <ContentEditorDialog
          open={true}
          onOpenChange={() => setConfigEdit(null)}
          htmlTemplate={
            configEdit.page
              ? injectPageIntoLayout(
                  configEdit.theme.layoutHtml,
                  configEdit.page.html,
                  { navClearance: configEdit.page.type !== "home" }
                )
              : configEdit.theme.layoutHtml
          }
          initialConfig={
            configEdit.page?.contentConfig ??
            configEdit.theme.contentConfig ??
            {}
          }
          onSave={(config) =>
            handleConfigSaved(configEdit.theme, configEdit.page, config)
          }
        />
      )}

      {/* HTML source editor */}
      {htmlEdit && (
        <HtmlEditorDialog
          open={true}
          onOpenChange={() => setHtmlEdit(null)}
          html={
            htmlEdit.page
              ? htmlEdit.page.html
              : htmlEdit.theme.layoutHtml
          }
          layoutHtml={htmlEdit.theme.layoutHtml}
          isLayout={htmlEdit.page === null}
          contentConfig={
            htmlEdit.page?.contentConfig ??
            htmlEdit.theme.contentConfig
          }
          onSave={(html) =>
            handlePageSaved(htmlEdit.theme.id, htmlEdit.page, html)
          }
        />
      )}

      {/* Full preview modal */}
      {preview && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setPreview(null)}
        >
          <div
            className="mx-4 flex h-[85vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-black/[0.06] px-4 py-3">
              <span className="text-sm font-medium text-[#1C1C1E]">
                {preview.theme.name} · {preview.page.name}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPreview(null)}
              >
                关闭
              </Button>
            </div>
            <iframe
              srcDoc={injectPageIntoLayout(
                preview.theme.layoutHtml,
                preview.page.html,
                { navClearance: preview.page.type !== "home" }
              )}
              sandbox="allow-scripts"
              className="flex-1"
              title="页面预览"
            />
          </div>
        </div>
      )}
    </>
  )
}