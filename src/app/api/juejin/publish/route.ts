import { spawn } from "node:child_process"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { getArticleById, updateJuejinArticleId } from "@/lib/articles"
import { getCollectionsForArticle } from "@/lib/collections"
import { fetchOwnColumns } from "@/lib/juejin-columns"
import { getJuejinToken } from "@/lib/site-config"

export const runtime = "nodejs"

const SKILL_DIR = path.join(process.cwd(), "src", "agents", "juejin-publisher")
const PUBLISH_SCRIPT = path.join(SKILL_DIR, "scripts", "publish.mjs")
const PUBLISH_TIMEOUT = 5 * 60 * 1000

interface PublishRequest {
  articleId: string
  category?: string
  tags?: string[]
  forceNew?: boolean
  unbind?: boolean
}

interface PublishResult {
  ok: boolean
  title?: string
  url?: string
  postId?: string
  status?: string
  columns?: string[]
  message: string
}

function runScript(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [PUBLISH_SCRIPT, ...args], {
      cwd: SKILL_DIR,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    const timer = setTimeout(() => {
      child.kill("SIGKILL")
      reject(new Error("发布超时（5 分钟）"))
    }, PUBLISH_TIMEOUT)
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
function parseResult(stdout: string): PublishResult | null {
  const lines = stdout.split("\n").map((l) => l.trim()).filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(lines[i])
      if (parsed && typeof parsed === "object" && "ok" in parsed) return parsed as PublishResult
    } catch {
      // 不是 JSON 行，继续向上找
    }
  }
  return null
}

export async function POST(request: Request) {
  try {
    const body: PublishRequest = await request.json()
    if (!body.articleId) {
      return Response.json({ error: "缺少 articleId" }, { status: 400 })
    }
    const article = await getArticleById(body.articleId)
    if (!article) {
      return Response.json({ error: "文章不存在" }, { status: 404 })
    }

    // 把数据库文章落成临时 markdown 文件，再交给 publish 脚本
    const tmpFile = path.join(
      os.tmpdir(),
      `juejin-publish-${article.id}-${Date.now()}.md`
    )
    const md = `# ${article.title}\n\n${article.content}\n`
    await fs.writeFile(tmpFile, md, "utf8")

    const scriptArgs = ["--file", tmpFile, "--title", article.title]
    // 已绑定文章默认走更新流程（脚本内部先探测掘金上该 ID 是否仍存在）；
    // forceNew 时强制新增
    if (body.forceNew) {
      scriptArgs.push("--force-new")
    } else if (article.juejinArticleId) {
      scriptArgs.push("--article-id", article.juejinArticleId)
    }
    const cookie = await getJuejinToken()
    if (!cookie) {
      await fs.rm(tmpFile, { force: true }).catch(() => {})
      return Response.json(
        { error: "未配置掘金 Cookie，请先在「个人管理」中配置掘金登录 Cookie" },
        { status: 400 }
      )
    }
    scriptArgs.push("--cookie", cookie)
    if (body.category || article.category?.name) {
      scriptArgs.push("--category", body.category || article.category!.name)
    }
    const tags = body.tags?.length ? body.tags : article.tags.map((t) => t.tag.name)
    if (tags.length > 0) {
      scriptArgs.push("--tags", tags.join(","))
    }

    // 文章→掘金专栏同步：收集文章所属「已绑定掘金专栏」的合集，取前 3 个，
    // 把 columnId 映射为掘金专栏标题传入 --column-names（best-effort，失败不阻断发布）。
    let syncedColumns: string[] = []
    try {
      const cols = await getCollectionsForArticle(article.id)
      const bound = cols
        .map((c) => c.juejinColumnId)
        .filter((id): id is string => !!id)
      if (bound.length > 0) {
        const ownColumns = await fetchOwnColumns(cookie)
        const byId = new Map(ownColumns.map((c) => [c.columnId, c.title]))
        syncedColumns = bound.slice(0, 3)
          .map((id) => byId.get(id))
          .filter((t): t is string => !!t)
        if (syncedColumns.length > 0) {
          scriptArgs.push("--column-names", syncedColumns.join(","))
        }
      }
    } catch {
      // 专栏拉取失败不影响文章发布
      syncedColumns = []
    }

    try {
      const { stdout } = await runScript(scriptArgs)
      const result = parseResult(stdout)
      if (result?.ok) {
        // 发布成功：回写掘金文章 ID（新增或更新均覆盖本地绑定）
        let juejinArticleId = article.juejinArticleId
        if (result.postId) {
          await updateJuejinArticleId(article.id, result.postId)
          juejinArticleId = result.postId
        } else if (body.unbind) {
          await updateJuejinArticleId(article.id, null)
          juejinArticleId = null
        }
        return Response.json({
          title: result.title,
          url: result.url,
          postId: result.postId ?? juejinArticleId,
          status: result.status,
          juejinArticleId,
          columns: result.columns?.length ? result.columns : syncedColumns,
          message: result.message,
        })
      }
      const message = result?.message || stdout.trim() || "发布失败，未获取到结果"
      return Response.json({ error: message }, { status: 400 })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return Response.json({ error: msg }, { status: 500 })
    } finally {
      await fs.rm(tmpFile, { force: true }).catch(() => {})
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "未知错误"
    return Response.json({ error: msg }, { status: 500 })
  }
}
