"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Save, Loader2, Eye, BookOpen, ThumbsUp } from "lucide-react"
import { FIELD_DEFINITIONS, EDITABLE_KEYS } from "@/lib/field-registry"
import type { StatFieldKey } from "@/lib/field-registry"

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

  useEffect(() => {
    fetch("/api/site-config")
      .then((res) => res.json())
      .then((data) => {
        setConfig(data)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const handleSave = useCallback(async () => {
    setSaving(true)
    setSuccess(false)
    try {
      const editableEntries = Object.entries(config).filter(([key]) => EDITABLE_KEYS.has(key))
      const body = Object.fromEntries(editableEntries)
      const res = await fetch("/api/site-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        setSuccess(true)
        setTimeout(() => setSuccess(false), 2000)
      }
    } finally {
      setSaving(false)
    }
  }, [config])

  function updateValue(key: string, value: string) {
    setConfig((prev) => ({ ...prev, [key]: value }))
  }

  const editableEntries = Object.entries(FIELD_DEFINITIONS)
    .filter(([, def]) => !def.readonly)
    .map(([key]) => [key, config[key] ?? ""] as const)
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
              <Input
                value={value}
                onChange={(e) => updateValue(key, e.target.value)}
                className="w-full"
                placeholder={`输入${FIELD_DEFINITIONS[key]?.label || key}`}
              />
            </div>
          ))}

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
