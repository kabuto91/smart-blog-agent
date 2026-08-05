"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Save, Loader2, Eye, EyeOff, Bot } from "lucide-react"

interface LLMConfig {
  baseUrl: string
  model: string
  apiKey: string
}

export default function PersonalPage() {
  const [config, setConfig] = useState<LLMConfig>({
    baseUrl: "",
    model: "",
    apiKey: "",
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{success: boolean; message: string} | null>(null)

  useEffect(() => {
    fetch("/api/llm-config")
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
      const res = await fetch("/api/llm-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      })
      if (res.ok) {
        setSuccess(true)
        setTimeout(() => setSuccess(false), 2000)
      }
    } finally {
      setSaving(false)
    }
  }, [config])

  const handleTest = useCallback(async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch("/api/llm-config/test", {
        method: "POST",
      })
      const data = await res.json()
      setTestResult(data)
      setTimeout(() => setTestResult(null), 2000)
    } catch {
      setTestResult({ success: false, message: "网络请求失败" })
      setTimeout(() => setTestResult(null), 2000)
    } finally {
      setTesting(false)
    }
  }, [])

  function updateValue(key: keyof LLMConfig, value: string) {
    setConfig((prev) => ({ ...prev, [key]: value }))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-5 animate-spin text-[#6B7280]" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-[#1C1C1E]">个人管理</h1>
        <p className="mt-1 text-sm text-[#6B7280]">
          配置您的大模型设置，用于博客内容生成
        </p>
      </div>

      <div className="rounded-lg border border-black/[0.06] bg-white p-6">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-full bg-[#E5A83D]/10">
            <Bot className="size-5 text-[#E5A83D]" />
          </div>
          <div>
            <h2 className="font-medium text-[#1C1C1E]">大模型配置</h2>
            <p className="text-xs text-[#6B7280]">
              设置 AI 模型的连接参数
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-5">
          <div>
            <label className="mb-1 block text-sm font-medium text-[#1C1C1E]">
              Base URL
            </label>
            <p className="mb-1.5 text-xs text-[#6B7280]">
              大模型 API 的基础地址
            </p>
            <Input
              value={config.baseUrl}
              onChange={(e) => updateValue("baseUrl", e.target.value)}
              className="w-full"
              placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-[#1C1C1E]">
              Model
            </label>
            <p className="mb-1.5 text-xs text-[#6B7280]">
              使用的模型名称
            </p>
            <Input
              value={config.model}
              onChange={(e) => updateValue("model", e.target.value)}
              className="w-full"
              placeholder="qwen-plus"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-[#1C1C1E]">
              API Key
            </label>
            <p className="mb-1.5 text-xs text-[#6B7280]">
              大模型 API 的访问密钥
            </p>
            <div className="relative">
              <Input
                type={showApiKey ? "text" : "password"}
                value={config.apiKey}
                onChange={(e) => updateValue("apiKey", e.target.value)}
                className="w-full pr-10"
                placeholder="sk-xxxxxxxxxxxxxxxxxxxxxxxx"
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6B7280] hover:text-[#1C1C1E]"
              >
                {showApiKey ? (
                  <EyeOff className="size-4" />
                ) : (
                  <Eye className="size-4" />
                )}
              </button>
            </div>
          </div>
        </div>

        <div className="mt-6 flex items-center gap-3">
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
            保存配置
          </Button>
          <Button
            onClick={handleTest}
            disabled={testing}
            variant="outline"
          >
            {testing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Bot className="size-4" />
            )}
            测试连接
          </Button>
          {testResult && (
            <span className={`text-sm ${testResult.success ? 'text-green-600' : 'text-red-600'} animate-in fade-in`}>
              {testResult.message}
            </span>
          )}
          {success && (
            <span className="text-sm text-green-600 animate-in fade-in">
              已保存
            </span>
          )}
        </div>

        <div className="mt-6 rounded-lg bg-[#F5F4F1] p-4">
          <p className="text-xs text-[#6B7280]">
            <strong>提示：</strong>如果您没有配置大模型参数，系统将使用默认的环境变量配置。
            配置保存后将立即生效。
          </p>
        </div>
      </div>
    </div>
  )
}