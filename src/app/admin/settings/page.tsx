"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Save, Loader2, Eye, BookOpen, ThumbsUp, Upload, Bookmark, Plus, Trash2, UserRound, Sparkles } from "lucide-react"
import { FIELD_DEFINITIONS, EDITABLE_KEYS } from "@/lib/field-registry"
import type { StatFieldKey } from "@/lib/field-registry"

const AVATAR_FIELD_KEY = "author-avatar"

const READONLY_ICONS: Record<StatFieldKey, React.ReactNode> = {
  "total-views": <Eye className="size-4 text-[#6B7280]" />,
  "total-articles": <BookOpen className="size-4 text-[#6B7280]" />,
  "total-likes": <ThumbsUp className="size-4 text-[#6B7280]" />,
}

export default function SettingsPage() {
  const [config, setConfig] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 可复用文本库（独立于主配置）
  const [texts, setTexts] = useState<Record<string, string>>({})
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [reuseSaving, setReuseSaving] = useState(false)
  const [reuseSuccess, setReuseSuccess] = useState(false)
  const [newKey, setNewKey] = useState("")
  const [newText, setNewText] = useState("")

  // 用户画像（独立区块）
  const [profile, setProfile] = useState("")
  const [profileEnabled, setProfileEnabled] = useState(true)
  const [profileLoading, setProfileLoading] = useState(true)
  const [profileGenerating, setProfileGenerating] = useState(false)
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileSuccess, setProfileSuccess] = useState(false)

  useEffect(() => {
    fetch("/api/site-config")
      .then((res) => res.json())
      .then((data) => {
        setConfig(data)
        setLoading(false)
      })
      .catch(() => setLoading(false))
    fetch("/api/reusable-text")
      .then((res) => res.json())
      .then((data) => {
        const lib =
          data && typeof data === "object" && !Array.isArray(data)
            ? (data as Record<string, string>)
            : {}
        setTexts(lib)
        setDrafts({ ...lib })
      })
      .catch(() => {
        // 可复用文本加载失败不阻塞页面
      })
    fetch("/api/user-profile")
      .then((res) => res.json())
      .then((data) => {
        if (data && typeof data === "object") {
          if (typeof data.profile === "string") setProfile(data.profile)
          if (typeof data.enabled === "boolean") setProfileEnabled(data.enabled)
        }
      })
      .catch(() => {
        // 画像加载失败不阻塞页面
      })
      .finally(() => setProfileLoading(false))
  }, [])

    const persistConfig = useCallback(async (cfg: Record<string, string>) => {
    const editableEntries = Object.entries(cfg).filter(([key]) =>
      EDITABLE_KEYS.has(key)
    )
    const body = Object.fromEntries(editableEntries)
    const res = await fetch("/api/site-config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      throw new Error(data?.error || "保存失败")
    }
    setSuccess(true)
    setTimeout(() => setSuccess(false), 2000)
  }, [])

  const handleSave = useCallback(async () => {
    setSaving(true)
    setSuccess(false)
    try {
      await persistConfig(config)
    } catch (e) {
      alert(e instanceof Error ? e.message : "保存失败")
    } finally {
      setSaving(false)
    }
  }, [config, persistConfig])

  function updateValue(key: string, value: string) {
    setConfig((prev) => ({ ...prev, [key]: value }))
  }

  async function handleAvatarUpload(file: File) {
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append("file", file)
      const res = await fetch("/api/uploads", { method: "POST", body: formData })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "上传失败")
      const next = { ...config, [AVATAR_FIELD_KEY]: data.url }
      updateValue(AVATAR_FIELD_KEY, data.url)
      await persistConfig(next)
    } catch (e) {
      alert(e instanceof Error ? e.message : "上传失败")
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleAvatarUpload(file)
  }

  function updateReuseValue(key: string, value: string) {
    setDrafts((prev) => ({ ...prev, [key]: value }))
  }

  function removeReuseValue(key: string) {
    setDrafts((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  function addReuseValue() {
    const key = newKey.trim()
    if (!key) return
    setDrafts((prev) => ({ ...prev, [key]: newText }))
    setNewKey("")
    setNewText("")
  }

  function reuseLabel(key: string) {
    return FIELD_DEFINITIONS[key]?.label || key
  }

  async function handleReuseSave() {
    setReuseSaving(true)
    setReuseSuccess(false)
    try {
      const jobs: Promise<unknown>[] = []
      for (const [key, value] of Object.entries(drafts)) {
        if (texts[key] !== value) {
          const p = fetch("/api/reusable-text", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key, text: value }),
          }).then((res) => {
            if (!res.ok) throw new Error(`保存可复用文本失败：${key}`)
          })
          jobs.push(p)
        }
      }
      for (const key of Object.keys(texts)) {
        if (!(key in drafts)) {
          const p = fetch("/api/reusable-text", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key, action: "delete" }),
          }).then((res) => {
            if (!res.ok) throw new Error(`删除可复用文本失败：${key}`)
          })
          jobs.push(p)
        }
      }
      if (jobs.length > 0) await Promise.all(jobs)
      setTexts({ ...drafts })
      setReuseSuccess(true)
      setTimeout(() => setReuseSuccess(false), 2000)
    } catch (e) {
      alert(e instanceof Error ? e.message : "保存失败")
    } finally {
      setReuseSaving(false)
    }
  }

  async function handleProfileGenerate() {
    setProfileGenerating(true)
    try {
      const res = await fetch("/api/user-profile", { method: "POST" })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || "生成失败")
      setProfile(data.profile ?? "")
      alert(`已基于 ${data.articleCount ?? 0} 篇文章生成画像，请确认后保存`)
    } catch (e) {
      alert(e instanceof Error ? e.message : "生成失败")
    } finally {
      setProfileGenerating(false)
    }
  }

  async function handleProfileSave() {
    setProfileSaving(true)
    setProfileSuccess(false)
    try {
      const res = await fetch("/api/user-profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile, enabled: profileEnabled }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || "保存失败")
      }
      setProfileSuccess(true)
      setTimeout(() => setProfileSuccess(false), 2000)
    } catch (e) {
      alert(e instanceof Error ? e.message : "保存失败")
    } finally {
      setProfileSaving(false)
    }
  }

  const editableEntries = Object.entries(FIELD_DEFINITIONS)
    .filter(([, def]) => !def.readonly)
    .map(([key]) => [key, config[key] ?? ""] as const)
  const draftEntries = Object.entries(drafts)
  const readonlyEntries = Object.entries(FIELD_DEFINITIONS)
    .filter(([, def]) => def.readonly)
    .map(([key]) => [key as StatFieldKey, config[key] ?? "0"] as const)

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-[#1C1C1E]">博客设置</h1>
        <p className="mt-1 text-sm text-[#6B7280]">
          配置博客的全局信息，生成主题时将自动使用这些值
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="size-5 animate-spin text-[#6B7280]" />
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {editableEntries.map(([key, value]) => (
            <div key={key}>
              <label className="mb-1 block text-sm font-medium text-[#1C1C1E]">
                {FIELD_DEFINITIONS[key]?.label || key}
              </label>
              {FIELD_DEFINITIONS[key]?.description && (
                <p className="mb-1.5 text-xs text-[#6B7280]">
                  {FIELD_DEFINITIONS[key].description}
                </p>
              )}
              {key === AVATAR_FIELD_KEY ? (
                <div className="flex items-start gap-3">
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border border-black/[0.06] bg-[#F9F9F8]">
                    {value ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={value}
                        alt="作者头像"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="text-xs text-[#9CA3AF]">暂无</span>
                    )}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <Input
                      value={value}
                      onChange={(e) => updateValue(key, e.target.value)}
                      className="w-full"
                      placeholder="输入头像图片链接或点击上传"
                    />
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploading}
                      >
                        {uploading ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Upload className="size-3.5" />
                        )}
                        上传图片
                      </Button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleFileChange}
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <Input
                  value={value}
                  onChange={(e) => updateValue(key, e.target.value)}
                  className="w-full"
                  placeholder={`输入${FIELD_DEFINITIONS[key]?.label || key}`}
                />
              )}
            </div>
          ))}

          {/* 用户画像（独立区块，单独保存） */}
          <hr className="my-2 border-black/[0.06]" />
          <div>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="flex items-center gap-1.5 text-sm font-medium text-[#1C1C1E]">
                  <UserRound className="size-3.5 text-[#E5A83D]" />
                  用户画像（User Profile）
                </h2>
                <p className="mt-0.5 text-xs text-[#6B7280]">
                  描述博客内容方向与写作风格，生成主题/文章时自动注入 prompt
                </p>
              </div>
            </div>

            <div className="mt-3 flex flex-col gap-3">
              <Textarea
                value={profile}
                onChange={(e) => setProfile(e.target.value)}
                className="w-full"
                rows={6}
                disabled={profileLoading}
                placeholder="例如：主要写前端工程与技术成长方向的内容，风格口语化、有观点、重实践…… 可点击下方按钮基于已发布文章自动生成"
              />

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  role="switch"
                  aria-checked={profileEnabled}
                  onClick={() => setProfileEnabled((v) => !v)}
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                    profileEnabled ? "bg-[#E5A83D]" : "bg-black/[0.12]"
                  }`}
                >
                  <span
                    className={`inline-block size-4 transform rounded-full bg-white shadow transition-transform ${
                      profileEnabled ? "translate-x-[18px]" : "translate-x-0.5"
                    }`}
                  />
                </button>
                <span className="text-xs text-[#6B7280]">
                  生成主题/文章时注入画像
                </span>
              </div>

              <div className="flex items-center gap-3">
                <Button
                  onClick={handleProfileGenerate}
                  disabled={profileGenerating}
                  variant="outline"
                  size="sm"
                  className="gap-1"
                >
                  {profileGenerating ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="size-3.5" />
                  )}
                  从文章列表生成画像
                </Button>
                <Button
                  onClick={handleProfileSave}
                  disabled={profileSaving}
                  variant="outline"
                  size="sm"
                  className="gap-1"
                >
                  {profileSaving ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Save className="size-3.5" />
                  )}
                  保存画像
                </Button>
                {profileSuccess && (
                  <span className="text-sm text-green-600 animate-in fade-in">
                    已保存
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* 可复用文本（共享配置）：独立区块，单独保存 */}
          <hr className="my-2 border-black/[0.06]" />
          <div>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="flex items-center gap-1.5 text-sm font-medium text-[#1C1C1E]">
                  <Bookmark className="size-3.5 text-[#E5A83D]" />
                  可复用文本（共享配置）
                </h2>
                <p className="mt-0.5 text-xs text-[#6B7280]">
                  在主题配置中被保存为可复用的文本，统一在这里编辑后同步应用到所有绑定主题
                </p>
              </div>
            </div>

            <div className="mt-3 flex flex-col gap-3">
              {draftEntries.length === 0 ? (
                <div className="rounded-lg border border-dashed border-black/[0.08] px-3 py-6 text-center text-xs text-[#9CA3AF]">
                  暂无可复用文本，可在主题配置中"保存为可复用"后到这里统一编辑
                </div>
              ) : (
                draftEntries.map(([key, value]) => (
                  <div
                    key={key}
                    className="rounded-lg border border-black/[0.08] bg-[#F9F9F8] px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <label className="text-xs text-[#6B7280]">
                        {reuseLabel(key)}
                        {reuseLabel(key) !== key && (
                          <span className="ml-1.5 font-mono text-[10px] text-[#9CA3AF]">
                            {key}
                          </span>
                        )}
                      </label>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeReuseValue(key)}
                        className="h-6 gap-1 text-xs text-[#6B7280] hover:text-red-500"
                      >
                        <Trash2 className="size-3" />
                        删除
                      </Button>
                    </div>
                    <Input
                      value={value}
                      onChange={(e) => updateReuseValue(key, e.target.value)}
                      className="mt-1.5 w-full"
                      placeholder={`输入${reuseLabel(key)}`}
                    />
                  </div>
                ))
              )}

              {/* 新增可复用文本 */}
              <div className="rounded-lg border border-black/[0.08] bg-white px-3 py-2">
                <p className="text-xs font-medium text-[#1C1C1E]">新增可复用文本</p>
                <div className="mt-2 flex items-center gap-2">
                  <Input
                    value={newKey}
                    onChange={(e) => setNewKey(e.target.value)}
                    className="w-40"
                    placeholder="名称（key）"
                  />
                  <Input
                    value={newText}
                    onChange={(e) => setNewText(e.target.value)}
                    className="flex-1"
                    placeholder="文本内容"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={addReuseValue}
                    className="h-9 gap-1"
                  >
                    <Plus className="size-3.5" />
                    添加
                  </Button>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Button
                  onClick={handleReuseSave}
                  disabled={reuseSaving || draftEntries.length === 0}
                  variant="outline"
                  size="sm"
                  className="gap-1"
                >
                  {reuseSaving ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Save className="size-3.5" />
                  )}
                  保存可复用文本
                </Button>
                {reuseSuccess && (
                  <span className="text-sm text-green-600 animate-in fade-in">
                    已保存
                  </span>
                )}
              </div>
            </div>
          </div>

          {readonlyEntries.length > 0 && (
            <>
              <hr className="my-2 border-black/[0.06]" />
              <div>
                <h2 className="text-sm font-medium text-[#1C1C1E]">站点统计（只读）</h2>
                <p className="mt-0.5 text-xs text-[#6B7280]">
                  以下数据由系统自动更新，不可手动修改
                </p>
              </div>
              <div className="grid grid-cols-3 gap-4">
                {readonlyEntries.map(([key, value]) => (
                  <div
                    key={key}
                    className="flex flex-col items-center gap-1.5 rounded-lg border border-black/[0.06] bg-white p-4"
                  >
                    {READONLY_ICONS[key]}
                    <span className="text-2xl font-semibold text-[#1C1C1E]">
                      {value || "0"}
                    </span>
                    <span className="text-xs text-[#6B7280]">
                      {FIELD_DEFINITIONS[key]?.label || key}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="flex items-center gap-3 pt-2">
            <Button
              onClick={handleSave}
              disabled={saving}
              className="bg-[#E5A83D] text-[#181A1E] hover:bg-[#D4A035]"
            >
              {saving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              保存设置
            </Button>
            {success && (
              <span className="text-sm text-green-600 animate-in fade-in">
                已保存
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
