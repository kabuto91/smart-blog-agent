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
import { Plus, Trash2, GripVertical, Loader2, Globe, ExternalLink, Bookmark, Unlink } from "lucide-react"
import Link from "next/link"
import type { ContentConfig, ContentField, NavItem, TextField, NavField, DynamicField, CustomListItem } from "@/lib/types/content-config"
import { FIELD_DEFINITIONS } from "@/lib/field-registry"
import type { ReusableTextLibrary } from "@/lib/reusable-text"
import { UrlCombobox, type UrlComboboxOption } from "@/components/admin/url-combobox"

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
  const normalizeConfig = useCallback((cfg: ContentConfig): ContentConfig => {
    const normalized = { ...cfg }
    for (const [key, field] of Object.entries(normalized)) {
      if (isTextConfig(field)) {
        const tf = field as TextField
        if (FIELD_DEFINITIONS[key]?.readonly && tf.source !== "readonly") {
          normalized[key] = { ...tf, source: "readonly" }
        }
      }
    }
    return normalized
  }, [])

  const [config, setConfig] = useState<ContentConfig>(() => normalizeConfig(initialConfig))
  const [previewHtml, setPreviewHtml] = useState("")
  const [previewLoading, setPreviewLoading] = useState(false)
  const [urlOptions, setUrlOptions] = useState<UrlComboboxOption[]>([])
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadUrlOptions = useCallback(async () => {
    try {
      const res = await fetch("/api/urls/options")
      const data = await res.json()
      if (Array.isArray(data)) setUrlOptions(data)
    } catch {
      // options load failed silently
    }
  }, [])

  const [texts, setTexts] = useState<ReusableTextLibrary>({})
  const [textFormOpen, setTextFormOpen] = useState(false)

  const loadTexts = useCallback(async () => {
    try {
      const res = await fetch("/api/reusable-text")
      const data = await res.json()
      if (data && typeof data === "object" && !Array.isArray(data)) {
        setTexts(data)
        // 补齐：已绑定可复用文本但对应 textKey 缺失于库中时（历史写库失败或跨环境），
        // 用当前值写回，保证博客设置里统一可见。
        const missing = Object.entries(config).filter(
          ([, f]) =>
            isTextConfig(f) &&
            f.source === "reusable-text" &&
            !!f.textKey &&
            !Object.prototype.hasOwnProperty.call(data, f.textKey)
        )
        if (missing.length > 0) {
          for (const [, f] of missing) {
            const tf = f as TextField
            try {
              await fetch("/api/reusable-text", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ key: tf.textKey, text: tf.value }),
              })
            } catch {
              // backfill failed silently; 下次打开仍会尝试
            }
          }
          const freshRes = await fetch("/api/reusable-text")
          const fresh = await freshRes.json()
          if (fresh && typeof fresh === "object" && !Array.isArray(fresh)) {
            setTexts(fresh)
          }
        }
      }
    } catch {
      // text library load failed silently
    }
  }, [config])

  const upsertText = useCallback(async (key: string, text: string) => {
    try {
      const res = await fetch("/api/reusable-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, text }),
      })
      const data = await res.json()
      if (data && typeof data === "object" && !Array.isArray(data)) {
        setTexts(data)
      }
    } catch {
      // text library write failed silently
    }
  }, [])

  const deleteText = useCallback(async (key: string) => {
    try {
      const res = await fetch("/api/reusable-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, action: "delete" }),
      })
      const data = await res.json()
      if (data && typeof data === "object" && !Array.isArray(data)) {
        setTexts(data)
      }
    } catch {
      // text library delete failed silently
    }
  }, [])

  /** 绑定文本字段到可复用文本库某项。 */
  function bindTextField(key: string, textKey: string) {
    const field = config[key] as TextField | undefined
    if (!field) return
    handleConfigChange({
      ...config,
      [key]: { ...field, source: "reusable-text", textKey },
    })
  }

  /** 解除绑定，回退到主题本地值。 */
  function unbindTextField(key: string) {
    const field = config[key] as TextField | undefined
    if (!field) return
    handleConfigChange({
      ...config,
      [key]: { ...field, source: "theme", textKey: undefined },
    })
  }

  /** 把主题文本字段的当前值存入可复用文本库并立即绑定。 */
  function saveTextFieldAsReuse(key: string) {
    const field = config[key] as TextField | undefined
    if (!field) return
    upsertText(key, field.value)
    bindTextField(key, key)
  }

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
    if (!open) return
    const t = window.setTimeout(() => {
      updatePreview(config)
      loadUrlOptions()
      loadTexts()
    }, 0)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, updatePreview])

  function handleConfigChange(newConfig: ContentConfig) {
    setConfig(newConfig)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => updatePreview(newConfig), 300)
  }

  function updateTextField(key: string, value: string) {
    const field = config[key] as TextField | undefined
    // global 与可复用文本均不在主题侧编辑（可复用文本统一在博客设置中配置）
    if (!field || field.source === "global" || field.source === "reusable-text")
      return
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

  function isCustomListConfig(field: ContentField): field is DynamicField {
    return field.type === "dynamic-list"
  }

  function updateCustomListItem(key: string, index: number, fieldKey: string, value: string) {
    const field = config[key] as DynamicField | undefined
    if (!field || !isCustomListConfig(field)) return
    const items = (field.items ?? []).map((item, i) =>
      i === index ? { ...item, [fieldKey]: value } : item
    )
    handleConfigChange({ ...config, [key]: { ...field, items } })
  }

  function addCustomListItem(key: string) {
    const field = config[key] as DynamicField | undefined
    if (!field || !isCustomListConfig(field)) return
    const fields = Object.keys(field.fieldMapping)
    const newItem: CustomListItem = {}
    for (const f of fields) newItem[f] = ""
    handleConfigChange({
      ...config,
      [key]: { ...field, items: [...(field.items ?? []), newItem] },
    })
  }

  function removeCustomListItem(key: string, index: number) {
    const field = config[key] as DynamicField | undefined
    if (!field || !isCustomListConfig(field)) return
    handleConfigChange({
      ...config,
      [key]: { ...field, items: (field.items ?? []).filter((_, i) => i !== index) },
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
  const systemDynamicFields = dynamicFields.filter(([, v]) => !isCustomListConfig(v))
  const customListFields = dynamicFields.filter(([, v]) => isCustomListConfig(v))

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
                          <Link
                            href="/admin/settings"
                            className="mt-1 inline-flex items-center gap-0.5 text-[11px] text-[#6B7280] hover:text-[#E5A83D] transition-colors"
                          >
                            前往修改
                            <ExternalLink className="size-2.5" />
                          </Link>
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
                  <h3 className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-[#6B7280]">
                    <span>文本内容</span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setTextFormOpen(true)}
                      className="h-6 gap-1 normal-case"
                    >
                      <Bookmark className="size-3" />
                      新增可复用文本
                    </Button>
                  </h3>
                  <div className="flex flex-col gap-3">
                    {themeTextFields.map(([key, field]) => {
                      const tf = field as TextField
                      const bound = tf.source === "reusable-text" && !!tf.textKey
                      const effValue =
                        bound && texts[tf.textKey ?? key] !== undefined
                          ? texts[tf.textKey ?? key]
                          : tf.value
                      const hasMatching = !bound && texts[key] !== undefined
                      return (
                        <div key={key} className="rounded-lg border border-black/[0.08] bg-[#F9F9F8] px-3 py-2">
                          <div className="flex items-center justify-between gap-2">
                            <label className="text-xs text-[#6B7280]">{tf.label}</label>
                            <div className="flex items-center gap-1">
                              {bound ? (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => unbindTextField(key)}
                                  className="h-6 gap-1 text-xs text-[#6B7280] hover:text-red-500"
                                >
                                  <Unlink className="size-3" />
                                  解除
                                </Button>
                              ) : hasMatching ? (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => bindTextField(key, key)}
                                  className="h-6 gap-1 text-xs text-[#8a6d1f] hover:text-[#E5A83D]"
                                >
                                  <Bookmark className="size-3" />
                                  绑定可复用文本
                                </Button>
                              ) : (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => saveTextFieldAsReuse(key)}
                                  className="h-6 gap-1 text-xs text-[#6B7280] hover:text-[#E5A83D]"
                                >
                                  <Bookmark className="size-3" />
                                  保存为可复用
                                </Button>
                              )}
                            </div>
                          </div>
                          {bound ? (
                            <>
                              <p className="mt-0.5 text-[11px] text-[#E5A83D]">
                                复用于可复用文本库 · 在博客设置中统一编辑
                              </p>
                              <p className="mt-1.5 break-words text-sm text-[#1C1C1E]">
                                {effValue}
                              </p>
                              <Link
                                href="/admin/settings"
                                className="mt-1 inline-flex items-center gap-0.5 text-[11px] text-[#6B7280] hover:text-[#E5A83D] transition-colors"
                              >
                                前往修改
                                <ExternalLink className="size-2.5" />
                              </Link>
                            </>
                          ) : (
                            <Input
                              value={effValue}
                              onChange={(e) => updateTextField(key, e.target.value)}
                              className="mt-1.5 w-full"
                            />
                          )}
                          {!bound && Object.keys(texts).length > 0 && (
                            <div className="mt-1.5">
                              <select
                                value=""
                                onChange={(e) => {
                                  const v = e.target.value
                                  if (v) bindTextField(key, v)
                                  e.target.value = ""
                                }}
                                className="w-full rounded-md border border-black/[0.06] bg-white px-3 py-1.5 text-xs text-[#1C1C1E] outline-none focus:border-[#E5A83D]/40"
                              >
                                <option value="">引用可复用文本…</option>
                                {Object.entries(texts).map(([k, v]) => (
                                  <option key={k} value={k}>
                                    {k}
                                    {v ? `：${v.length > 8 ? `${v.slice(0, 8)}…` : v}` : ""}
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}
                        </div>
                      )
                    })}
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
                        <div key={idx} className="flex flex-col gap-1.5">
                          <div className="flex items-center gap-2">
                            <GripVertical className="size-3.5 shrink-0 text-[#6B7280]" />
                            <Input
                              placeholder="名称"
                              value={item.label}
                              onChange={(e) => updateNavItem(key, idx, "label", e.target.value)}
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
                          <div className="pl-6">
                            <UrlCombobox
                              value={item.href}
                              onChange={(v) => updateNavItem(key, idx, "href", v)}
                              options={urlOptions}
                              onPageGenerated={loadUrlOptions}
                            />
                          </div>
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
              {systemDynamicFields.length > 0 && (
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">
                    动态数据
                  </h3>
                  <div className="flex flex-col gap-2">
                    {systemDynamicFields.map(([key, field]) => (
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

              {/* Custom list fields */}
              {customListFields.length > 0 && (
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">
                    自定义列表
                  </h3>
                  <div className="flex flex-col gap-3">
                    {customListFields.map(([key, field]) => {
                      const df = field as DynamicField
                      const items = df.items ?? []
                      const fieldKeys = Object.keys(df.fieldMapping)
                      return (
                        <div key={key} className="rounded-lg border border-black/[0.08] bg-[#F9F9F8] px-3 py-2">
                          <p className="text-sm font-medium text-[#1C1C1E]">{df.label}</p>
                          <p className="mt-0.5 text-xs text-[#6B7280]">
                            字段：{fieldKeys.join("、")}
                          </p>
                          <div className="mt-2 flex flex-col gap-2">
                            {items.map((item, idx) => (
                              <div key={idx} className="flex flex-col gap-1">
                                <div className="flex items-center gap-1.5">
                                  <span className="shrink-0 text-[10px] text-[#9CA3AF] w-4 text-right">{idx + 1}</span>
                                  <div className="flex flex-1 flex-wrap gap-1">
                                    {fieldKeys.map((fk) => (
                                      <Input
                                        key={fk}
                                        placeholder={fk}
                                        value={item[fk] ?? ""}
                                        onChange={(e) => updateCustomListItem(key, idx, fk, e.target.value)}
                                        className="h-7 min-w-0 flex-1 text-xs"
                                      />
                                    ))}
                                  </div>
                                  <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    onClick={() => removeCustomListItem(key, idx)}
                                    className="shrink-0 text-red-400 hover:text-red-500"
                                  >
                                    <Trash2 className="size-3" />
                                  </Button>
                                </div>
                              </div>
                            ))}
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => addCustomListItem(key)}
                              className="mt-1 gap-1"
                            >
                              <Plus className="size-3" />
                              添加项目
                            </Button>
                          </div>
                        </div>
                      )
                    })}
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
      <TextReuseFormDialog
        open={textFormOpen}
        onOpenChange={setTextFormOpen}
        onSaved={() => loadTexts()}
      />
    </Dialog>
  )
}

/** 新建可复用文本的小表单。 */
function TextReuseFormDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const [name, setName] = useState("")
  const [content, setContent] = useState("")
  const [saving, setSaving] = useState(false)

  async function submit() {
    const key = name.trim()
    if (!key) return
    setSaving(true)
    const res = await fetch("/api/reusable-text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, text: content }),
    })
    if (res.ok) onSaved()
    setSaving(false)
    setName("")
    setContent("")
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogContent className="sm:max-w-md">
          <DialogTitle className="pb-3 text-[#1C1C1E]">新增可复用文本</DialogTitle>
          <div className="flex flex-col gap-3">
            <div>
              <label className="mb-1 block text-xs text-[#6B7280]">名称 *</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：站点标语"
                className="w-full"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-[#6B7280]">内容</label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={4}
                placeholder="可复用的文本内容"
                className="w-full resize-none rounded-md border border-black/[0.06] bg-white px-3 py-1.5 text-sm text-[#1C1C1E] outline-none focus:border-[#E5A83D]/40"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t border-black/[0.06] pt-4">
            <Button variant="outline" onClick={() => { onOpenChange(false); setName(""); setContent("") }}>
              取消
            </Button>
            <Button
              onClick={submit}
              disabled={!name.trim() || saving}
              className="bg-[#E5A83D] text-[#181A1E] hover:bg-[#D4A035]"
            >
              {saving ? <Loader2 className="size-3 animate-spin" /> : null}
              保存到库
            </Button>
          </div>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  )
}
