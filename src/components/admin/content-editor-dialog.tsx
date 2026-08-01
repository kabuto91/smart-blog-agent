"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Plus, Trash2, GripVertical, Loader2, Globe, ExternalLink } from "lucide-react"
import type { ContentConfig, ContentField, NavItem, TextField, NavField } from "@/lib/types/content-config"
import { FIELD_DEFINITIONS } from "@/lib/field-config"

interface ContentEditorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  htmlTemplate: string
  initialConfig: ContentConfig
  onSave: (config: ContentConfig) => void
}

export function ContentEditorDialog({
  open,
  onOpenChange,
  htmlTemplate,
  initialConfig,
  onSave,
}: ContentEditorDialogProps) {
  const [config, setConfig] = useState<ContentConfig>(initialConfig)
  const [previewHtml, setPreviewHtml] = useState("")
  const [previewLoading, setPreviewLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const updatePreview = useCallback(async (cfg: ContentConfig) => {
    setPreviewLoading(true)
    try {
      const res = await fetch("/api/themes/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ htmlTemplate, contentConfig: cfg }),
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
  }, [htmlTemplate])

  useEffect(() => {
    const normalized = { ...initialConfig }
    for (const [key, field] of Object.entries(normalized)) {
      if (isTextConfig(field)) {
        const tf = field as TextField
        if (FIELD_DEFINITIONS[key]?.readonly && tf.source !== "readonly") {
          normalized[key] = { ...tf, source: "readonly" }
        }
      }
    }
    setConfig(normalized)
    if (open) {
      updatePreview(normalized)
    }
  }, [open, initialConfig, updatePreview]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleConfigChange(newConfig: ContentConfig) {
    setConfig(newConfig)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => updatePreview(newConfig), 300)
  }

  function updateTextField(key: string, value: string) {
    const field = config[key] as TextField | undefined
    if (!field || field.source === "global") return
    handleConfigChange({ ...config, [key]: { ...field, value } })
  }

  function updateNavItem(key: string, index: number, field: keyof NavItem, value: string) {
    const navField = config[key] as NavField | undefined
    if (!navField) return
    const items = navField.items.map((item, i) =>
      i === index ? { ...item, [field]: value } : item
    )
    handleConfigChange({ ...config, [key]: { ...navField, items } })
  }

  function addNavItem(key: string) {
    const navField = config[key] as NavField | undefined
    if (!navField) return
    handleConfigChange({
      ...config,
      [key]: { ...navField, items: [...navField.items, { label: "", href: "/" }] },
    })
  }

  function removeNavItem(key: string, index: number) {
    const navField = config[key] as NavField | undefined
    if (!navField) return
    handleConfigChange({
      ...config,
      [key]: { ...navField, items: navField.items.filter((_, i) => i !== index) },
    })
  }

  function isTextConfig(field: ContentField): field is TextField {
    return field.type === "text"
  }

  function isNavConfig(field: ContentField): field is NavField {
    return field.type === "nav-list"
  }

  function isDynamicConfig(field: ContentField): boolean {
    return field.type.startsWith("dynamic-")
  }

  const globalTextFields = Object.entries(config).filter(
    ([, v]) => isTextConfig(v) && (v as TextField).source === "global"
  )
  const readonlyTextFields = Object.entries(config).filter(
    ([, v]) => isTextConfig(v) && (v as TextField).source === "readonly"
  )
  const themeTextFields = Object.entries(config).filter(
    ([, v]) => isTextConfig(v) && (v as TextField).source !== "global" && (v as TextField).source !== "readonly"
  )
  const navFields = Object.entries(config).filter(([, v]) => isNavConfig(v))
  const dynamicFields = Object.entries(config).filter(([, v]) => isDynamicConfig(v))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogContent className="sm:max-w-5xl lg:max-w-6xl" showCloseButton={false}>
          <DialogTitle className="pb-3 text-[#1C1C1E]">
            内容配置
          </DialogTitle>

          <div className="flex max-h-[75vh] gap-4 overflow-hidden">
            {/* Left: Config editor */}
            <div className="flex w-[400px] min-w-0 flex-col gap-4 overflow-y-auto pr-2">
              {/* Global fields (read-only, editable in blog settings) */}
              {globalTextFields.length > 0 && (
                <div>
                  <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">
                    <Globe className="size-3" />
                    全局配置（自动同步）
                  </h3>
                  <div className="flex flex-col gap-2">
                    {globalTextFields.map(([key, field]) => {
                      const tf = field as TextField
                      return (
                        <div
                          key={key}
                          className="rounded-lg border border-black/[0.06] bg-[#F9F9F8] px-3 py-2"
                        >
                          <div className="flex items-center justify-between">
                            <label className="text-xs text-[#6B7280]">
                              {tf.label}
                            </label>
                            <span className="rounded bg-[#E5A83D]/10 px-1.5 py-0.5 text-[10px] text-[#E5A83D]">
                              来自博客设置
                            </span>
                          </div>
                          <p className="mt-0.5 text-sm text-[#1C1C1E]">
                            {tf.value}
                          </p>
                          <a
                            href="/admin/settings"
                            className="mt-1 inline-flex items-center gap-0.5 text-[11px] text-[#6B7280] hover:text-[#E5A83D] transition-colors"
                          >
                            前往修改
                            <ExternalLink className="size-2.5" />
                          </a>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Readonly stats fields (cannot be modified anywhere) */}
              {readonlyTextFields.length > 0 && (
                <div>
                  <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">
                    <Globe className="size-3" />
                    站点统计
                  </h3>
                  <div className="flex flex-col gap-2">
                    {readonlyTextFields.map(([key, field]) => {
                      const tf = field as TextField
                      return (
                        <div
                          key={key}
                          className="rounded-lg border border-black/[0.06] bg-[#F9F9F8] px-3 py-2"
                        >
                          <div className="flex items-center justify-between">
                            <label className="text-xs text-[#6B7280]">
                              {tf.label}
                            </label>
                            <span className="rounded bg-[#E5A83D]/10 px-1.5 py-0.5 text-[10px] text-[#E5A83D]">
                              来自博客设置
                            </span>
                          </div>
                          <p className="mt-0.5 text-sm text-[#1C1C1E]">
                            {tf.value}
                          </p>
                          <p className="mt-1 text-[11px] text-[#9CA3AF]">
                            由系统自动更新
                          </p>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Theme-level text fields (editable) */}
              {themeTextFields.length > 0 && (
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">
                    文本内容
                  </h3>
                  <div className="flex flex-col gap-3">
                    {themeTextFields.map(([key, field]) => (
                      <div key={key}>
                        <label className="mb-1 block text-xs text-[#6B7280]">
                          {field.label}
                        </label>
                        <Input
                          value={(field as TextField).value}
                          onChange={(e) => updateTextField(key, e.target.value)}
                          className="w-full"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Nav links */}
              {navFields.length > 0 && (
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">
                    导航链接
                  </h3>
                  {navFields.map(([key, field]) => (
                    <div key={key} className="flex flex-col gap-2">
                      <p className="text-xs text-[#6B7280]">{field.label}</p>
                      {(field as NavField).items.map((item, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <GripVertical className="size-3.5 shrink-0 text-[#6B7280]" />
                          <Input
                            placeholder="名称"
                            value={item.label}
                            onChange={(e) => updateNavItem(key, idx, "label", e.target.value)}
                            className="flex-1"
                          />
                          <Input
                            placeholder="/link"
                            value={item.href}
                            onChange={(e) => updateNavItem(key, idx, "href", e.target.value)}
                            className="flex-1"
                          />
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => removeNavItem(key, idx)}
                            className="text-red-400 hover:text-red-500"
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      ))}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => addNavItem(key)}
                        className="mt-1 gap-1"
                      >
                        <Plus className="size-3" />
                        添加链接
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              {/* Dynamic data sections */}
              {dynamicFields.length > 0 && (
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">
                    动态数据
                  </h3>
                  <div className="flex flex-col gap-2">
                    {dynamicFields.map(([key, field]) => (
                      <div
                        key={key}
                        className="rounded-lg border border-black/[0.08] bg-[#F9F9F8] px-3 py-2"
                      >
                        <p className="text-sm font-medium text-[#1C1C1E]">{field.label}</p>
                        <p className="mt-0.5 text-xs text-[#6B7280]">
                          从文章管理自动获取
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {globalTextFields.length === 0 && themeTextFields.length === 0 && navFields.length === 0 && dynamicFields.length === 0 && (
                <div className="py-8 text-center text-sm text-[#6B7280]">
                  该主题未包含可配置内容
                </div>
              )}
            </div>

            {/* Right: Preview */}
            <div className="flex flex-1 flex-col overflow-hidden rounded-lg border border-black/[0.06] bg-white">
              <div className="flex items-center justify-between border-b border-black/[0.06] bg-[#F5F4F1] px-3 py-1.5">
                <span className="flex items-center gap-1.5 text-xs text-[#6B7280]">
                  {previewLoading && <Loader2 className="size-3 animate-spin" />}
                  实时预览
                </span>
              </div>
              <iframe
                srcDoc={previewHtml || htmlTemplate}
                sandbox="allow-scripts"
                className="flex-1"
                title="内容预览"
              />
            </div>
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-2 border-t border-black/[0.06] pt-4">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button
              onClick={() => onSave(config)}
              className="bg-[#E5A83D] text-[#181A1E] hover:bg-[#D4A035]"
            >
              保存配置
            </Button>
          </div>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  )
}
