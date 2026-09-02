"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Save, Loader2, Eye, EyeOff, Bot, Eye as EyeIcon, BookMarked } from "lucide-react"

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
  const [visionConfig, setVisionConfig] = useState<LLMConfig>({
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
  const [savingVision, setSavingVision] = useState(false)
  const [successVision, setSuccessVision] = useState(false)
  const [showVisionApiKey, setShowVisionApiKey] = useState(false)
  const [testingVision, setTestingVision] = useState(false)
  const [testResultVision, setTestResultVision] = useState<{success: boolean; message: string} | null>(null)
  const [juejinToken, setJuejinToken] = useState("")
  const [savingJuejin, setSavingJuejin] = useState(false)
  const [successJuejin, setSuccessJuejin] = useState(false)
  const [showJuejinToken, setShowJuejinToken] = useState(false)
  const [testingJuejin, setTestingJuejin] = useState(false)
  const [testResultJuejin, setTestResultJuejin] = useState<{success: boolean; message: string} | null>(null)

  useEffect(() => {
    Promise.all([
      fetch("/api/llm-config").then((res) => res.json()),
      fetch("/api/vision-config").then((res) => res.json()),
      fetch("/api/juejin-config").then((res) => res.json()).catch(() => ({ token: "" })),
    ]).then(([llmData, visionData, juejinData]) => {
      setConfig(llmData)
      setVisionConfig(visionData)
      setJuejinToken(juejinData.token ?? "")
      setLoading(false)
    }).catch(() => setLoading(false))
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
      if (data.success) {
        setTimeout(() => setTestResult(null), 2000)
      }
    } catch {
      setTestResult({ success: false, message: "网络请求失败" })
    } finally {
      setTesting(false)
    }
  }, [])

  const handleSaveVision = useCallback(async () => {
    setSavingVision(true)
    setSuccessVision(false)
    try {
      const res = await fetch("/api/vision-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(visionConfig),
      })
      if (res.ok) {
        setSuccessVision(true)
        setTimeout(() => setSuccessVision(false), 2000)
      }
    } finally {
      setSavingVision(false)
    }
  }, [visionConfig])

  const handleTestVision = useCallback(async () => {
    setTestingVision(true)
    setTestResultVision(null)
    try {
      const res = await fetch("/api/vision-config/test", {
        method: "POST",
      })
      const data = await res.json()
      setTestResultVision(data)
      if (data.success) {
        setTimeout(() => setTestResultVision(null), 2000)
      }
    } catch {
      setTestResultVision({ success: false, message: "网络请求失败" })
    } finally {
      setTestingVision(false)
    }
  }, [])

  const handleSaveJuejin = useCallback(async () => {
    setSavingJuejin(true)
    setSuccessJuejin(false)
    setTestResultJuejin(null)
    try {
      const res = await fetch("/api/juejin-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: juejinToken }),
      })
      if (res.ok) {
        setSuccessJuejin(true)
        setTimeout(() => setSuccessJuejin(false), 2000)
      }
    } finally {
      setSavingJuejin(false)
    }
  }, [juejinToken])

  const handleTestJuejin = useCallback(async () => {
    setTestingJuejin(true)
    setTestResultJuejin(null)
    try {
      const res = await fetch("/api/juejin-config/test", {
        method: "POST",
      })
      const data = await res.json()
      setTestResultJuejin(data)
      if (data.success) {
        setTimeout(() => setTestResultJuejin(null), 3000)
      }
    } catch {
      setTestResultJuejin({ success: false, message: "网络请求失败" })
    } finally {
      setTestingJuejin(false)
    }
  }, [])

  function updateValue(key: keyof LLMConfig, value: string) {
    setConfig((prev) => ({ ...prev, [key]: value }))
  }

  function updateVisionValue(key: keyof LLMConfig, value: string) {
    setVisionConfig((prev) => ({ ...prev, [key]: value }))
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

      <div className="mt-6 rounded-lg border border-black/[0.06] bg-white p-6">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-full bg-[#E5A83D]/10">
            <EyeIcon className="size-5 text-[#E5A83D]" />
          </div>
          <div>
            <h2 className="font-medium text-[#1C1C1E]">视觉模型配置</h2>
            <p className="text-xs text-[#6B7280]">
              设置图像理解模型的连接参数，用于分析上传的图片并生成主题
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-5">
          <div>
            <label className="mb-1 block text-sm font-medium text-[#1C1C1E]">
              Base URL
            </label>
            <p className="mb-1.5 text-xs text-[#6B7280]">
              视觉模型 API 的基础地址
            </p>
            <Input
              value={visionConfig.baseUrl}
              onChange={(e) => updateVisionValue("baseUrl", e.target.value)}
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
              value={visionConfig.model}
              onChange={(e) => updateVisionValue("model", e.target.value)}
              className="w-full"
              placeholder="qwen-vl-max"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-[#1C1C1E]">
              API Key
            </label>
            <p className="mb-1.5 text-xs text-[#6B7280]">
              视觉模型 API 的访问密钥
            </p>
            <div className="relative">
              <Input
                type={showVisionApiKey ? "text" : "password"}
                value={visionConfig.apiKey}
                onChange={(e) => updateVisionValue("apiKey", e.target.value)}
                className="w-full pr-10"
                placeholder="sk-xxxxxxxxxxxxxxxxxxxxxxxx"
              />
              <button
                type="button"
                onClick={() => setShowVisionApiKey(!showVisionApiKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6B7280] hover:text-[#1C1C1E]"
              >
                {showVisionApiKey ? (
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
            onClick={handleSaveVision}
            disabled={savingVision}
            className="bg-[#E5A83D] text-[#181A1E] hover:bg-[#D4A035]"
          >
            {savingVision ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            保存配置
          </Button>
          <Button
            onClick={handleTestVision}
            disabled={testingVision}
            variant="outline"
          >
            {testingVision ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <EyeIcon className="size-4" />
            )}
            测试连接
          </Button>
          {testResultVision && (
            <span className={`text-sm ${testResultVision.success ? 'text-green-600' : 'text-red-600'} animate-in fade-in`}>
              {testResultVision.message}
            </span>
          )}
          {successVision && (
            <span className="text-sm text-green-600 animate-in fade-in">
              已保存
            </span>
          )}
        </div>

        <div className="mt-6 rounded-lg bg-[#F5F4F1] p-4">
          <p className="text-xs text-[#6B7280]">
            <strong>提示：</strong>视觉模型用于分析上传的图片，提取风格、配色、布局等设计特征，
            然后据此生成主题。推荐使用 qwen-vl-max 等多模态模型。
          </p>
        </div>
      </div>

      <div className="mt-6 rounded-lg border border-black/[0.06] bg-white p-6">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-full bg-[#E5A83D]/10">
            <BookMarked className="size-5 text-[#E5A83D]" />
          </div>
          <div>
            <h2 className="font-medium text-[#1C1C1E]">掘金发布配置</h2>
            <p className="text-xs text-[#6B7280]">
              配置掘金登录 Cookie，用于「发布到掘金」功能
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-5">
          <div>
            <label className="mb-1 block text-sm font-medium text-[#1C1C1E]">
              掘金登录 Cookie
            </label>
            <p className="mb-1.5 text-xs text-[#6B7280]">
              登录掘金后，在浏览器开发者工具（F12 → Network → 请求头）中复制完整 Cookie 字符串
            </p>
            <div className="relative">
              <textarea
                value={juejinToken}
                onChange={(e) => setJuejinToken(e.target.value)}
                rows={3}
                placeholder="sessionid=xxx; passport_csrf_token=yyy; ..."
                className="w-full resize-y rounded-lg border border-black/[0.08] bg-white px-3 py-2 pr-10 text-sm text-[#1C1C1E] outline-none transition-colors placeholder:text-[#9CA3AF] focus:border-[#E5A83D] focus:ring-2 focus:ring-[#E5A83D]/20"
              />
              <button
                type="button"
                onClick={() => setShowJuejinToken(!showJuejinToken)}
                className="absolute right-3 top-3 text-[#6B7280] hover:text-[#1C1C1E]"
              >
                {showJuejinToken ? (
                  <EyeOff className="size-4" />
                ) : (
                  <Eye className="size-4" />
                )}
              </button>
            </div>
            {!showJuejinToken && juejinToken && (
              <p className="mt-1 text-xs text-[#9CA3AF]">
                {juejinToken.replace(/; /g, "; ").slice(0, 60)}
                {juejinToken.length > 60 ? "…" : ""}
              </p>
            )}
          </div>
        </div>

        <div className="mt-6 flex items-center gap-3">
          <Button
            onClick={handleSaveJuejin}
            disabled={savingJuejin}
            className="bg-[#E5A83D] text-[#181A1E] hover:bg-[#D4A035]"
          >
            {savingJuejin ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            保存配置
          </Button>
          <Button
            onClick={handleTestJuejin}
            disabled={testingJuejin}
            variant="outline"
          >
            {testingJuejin ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <BookMarked className="size-4" />
            )}
            测试连接
          </Button>
          {testResultJuejin && (
            <span className={`text-sm ${testResultJuejin.success ? "text-green-600" : "text-red-600"} animate-in fade-in`}>
              {testResultJuejin.message}
            </span>
          )}
          {successJuejin && (
            <span className="text-sm text-green-600 animate-in fade-in">
              已保存
            </span>
          )}
        </div>

        <div className="mt-6 rounded-lg bg-[#F5F4F1] p-4">
          <p className="text-xs text-[#6B7280]">
            <strong>获取方式：</strong>在浏览器中登录掘金 → 按 F12 打开开发者工具 → 切换到
            Network（网络）标签 → 刷新页面并点击任意请求 → 在 Request Headers（请求头）中找到
            <code className="mx-0.5 rounded bg-black/[0.06] px-1">Cookie</code>字段，将其完整值复制到这里。
            Cookie 失效后需重新复制更新。
          </p>
        </div>
      </div>
    </div>
  )
}