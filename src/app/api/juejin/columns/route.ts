import { spawn } from "node:child_process"
import path from "node:path"
import { bindCollectionJuejinColumn } from "@/lib/collections"
import { fetchOwnColumns } from "@/lib/juejin-columns"
import { getJuejinToken } from "@/lib/site-config"

export const runtime = "nodejs"

const SKILL_DIR = path.join(process.cwd(), "src", "agents", "juejin-publisher")
const CREATE_SCRIPT = path.join(SKILL_DIR, "scripts", "create-column.mjs")
const CREATE_TIMEOUT = 2 * 60 * 1000

interface CreateColumnRequest {
  collectionId?: string
  name: string
  abstract?: string
}

function runCreateScript(
  args: string[]
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [CREATE_SCRIPT, "--headless", ...args], {
      cwd: SKILL_DIR,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    const timer = setTimeout(() => {
      child.kill("SIGKILL")
      reject(new Error("新建专栏超时（2 分钟）"))
    }, CREATE_TIMEOUT)
    child.stdout.on("data", (d) => (stdout += d))
    child.stderr.on("data", (d) => (stderr += d))
    child.on("error", (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error(stderr.trim() || stdout.trim() || `脚本退出码 ${code}`))
    })
  })
}

/** 从脚本输出中提取最后一行 JSON 结果。 */
function parseResult(stdout: string): { ok?: boolean; columnId?: string; message?: string } | null {
  const lines = stdout.split("\n").map((l) => l.trim()).filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(lines[i])
      if (parsed && typeof parsed === "object" && "ok" in parsed) return parsed
    } catch {
      // 不是 JSON 行，继续向上找
    }
  }
  return null
}

export async function GET() {
  try {
    const cookie = await getJuejinToken()
    if (!cookie) {
      return Response.json(
        { error: "未配置掘金 Cookie，请先在「个人管理」中配置掘金登录 Cookie" },
        { status: 400 }
      )
    }
    const columns = await fetchOwnColumns(cookie)
    return Response.json(columns)
  } catch (error) {
    const msg = error instanceof Error ? error.message : "未知错误"
    return Response.json({ error: msg }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body: CreateColumnRequest = await request.json()
    const name = (body.name || "").trim()
    if (!name) {
      return Response.json({ error: "缺少专栏名称" }, { status: 400 })
    }
    const cookie = await getJuejinToken()
    if (!cookie) {
      return Response.json(
        { error: "未配置掘金 Cookie，请先在「个人管理」中配置掘金登录 Cookie" },
        { status: 400 }
      )
    }

    const scriptArgs = ["--name", name]
    if (body.abstract?.trim()) scriptArgs.push("--summary", body.abstract.trim())
    scriptArgs.push("--cookie", cookie)

    let result
    try {
      const { stdout } = await runCreateScript(scriptArgs)
      result = parseResult(stdout)
    } catch (error) {
      const msg = error instanceof Error ? error.message : "未知错误"
      return Response.json({ error: msg }, { status: 500 })
    }

    if (!result?.ok || !result.columnId) {
      return Response.json(
        { error: result?.message || "新建专栏失败" },
        { status: 400 }
      )
    }

    // 创建成功：绑定到指定本地合集（可选）
    let boundCollectionId: string | null = null
    if (body.collectionId) {
      const bound = await bindCollectionJuejinColumn(body.collectionId, result.columnId)
      if (bound) boundCollectionId = body.collectionId
    }

    return Response.json({
      success: true,
      columnId: result.columnId,
      title: name,
      boundCollectionId,
      message: `已在掘金创建专栏「${name}」` + (boundCollectionId ? "，并已绑定到本地合集" : ""),
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : "未知错误"
    return Response.json({ error: msg }, { status: 500 })
  }
}