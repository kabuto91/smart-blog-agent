import { spawn } from "node:child_process"
import path from "node:path"
import { getJuejinToken } from "@/lib/site-config"

export const runtime = "nodejs"

const SKILL_DIR = path.join(process.cwd(), "src", "agents", "juejin-publisher")
const TEST_SCRIPT = path.join(SKILL_DIR, "scripts", "test.mjs")
const TEST_TIMEOUT = 60 * 1000

function runScript(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [TEST_SCRIPT, ...args], {
      cwd: SKILL_DIR,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    const timer = setTimeout(() => {
      child.kill("SIGKILL")
      reject(new Error("测试超时（60 秒）"))
    }, TEST_TIMEOUT)
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
function parseResult(stdout: string): { ok?: boolean; message?: string; profileId?: string } | null {
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

export async function POST() {
  try {
    const token = await getJuejinToken()
    if (!token) {
      return Response.json(
        { success: false, message: "未配置掘金 Cookie，请先保存掘金登录 Cookie" },
        { status: 400 }
      )
    }

    try {
      const { stdout } = await runScript(["--cookie", token])
      const result = parseResult(stdout)
      if (result?.ok) {
        return Response.json({
          success: true,
          message: result.message,
          profileId: result.profileId,
        })
      }
      const message = result?.message || stdout.trim() || "Cookie 无效"
      return Response.json({ success: false, message }, { status: 400 })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return Response.json({ success: false, message: msg }, { status: 500 })
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "未知错误"
    return Response.json({ success: false, message: msg }, { status: 500 })
  }
}
