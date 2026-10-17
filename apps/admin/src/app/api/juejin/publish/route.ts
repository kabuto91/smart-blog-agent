import { spawn } from "node:child_process"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { getArticleById, updateJuejinArticleId } from "@smart-blog/core/lib/articles"
import { getCollectionsForArticle } from "@smart-blog/core/lib/collections"
import { getUpload, MAX_UPLOAD_SIZE } from "@smart-blog/core/lib/uploads"
import { fetchOwnColumns } from "@/lib/juejin-columns"
import { getJuejinToken } from "@smart-blog/core/lib/site-config"

export const runtime = "nodejs"

const SKILL_DIR = path.join(process.cwd(), "src", "agents", "juejin-publisher")
const PUBLISH_SCRIPT = path.join(SKILL_DIR, "scripts", "publish.mjs")
const PUBLISH_TIMEOUT = 5 * 60 * 1000
const COVER_FETCH_TIMEOUT = 15 * 1000

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
  coverUploaded?: boolean | null
  bodyImagesUploaded?: number
  bodyImagesFailed?: { id: string; reason: string }[]
  message: string
}

/** 传给发布脚本的图片数据：base64 原文 + 原始文件名/类型 */
interface ImagePayload {
  name: string
  mimeType: string
  data: string
}

/** 正文图片：额外带上正文里出现的站内地址 id，供脚本替换正文中的相对地址 */
interface BodyImagePayload extends ImagePayload {
  id: string
}

/** 经 stdin 交给脚本的图片素材集合 */
interface AssetsPayload {
  cover: ImagePayload | null
  images: BodyImagePayload[]
}

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
}

/** 从 uploads 表取站内图片，还原成掘金文件上传所需的 base64 */
async function resolveUploadImage(uploadId: string, fallbackName: string): Promise<ImagePayload | null> {
  const upload = await getUpload(uploadId)
  if (!upload?.data) return null
  return {
    name: upload.filename || `${fallbackName}.${EXT_BY_MIME[upload.mimeType] ?? "jpg"}`,
    mimeType: upload.mimeType || "image/jpeg",
    data: upload.data,
  }
}

/**
 * 把图片地址解析成可直接交给掘金文件上传的 base64 数据。
 * - 站内上传：形如 /api/uploads/<id>，直接取 uploads 表里存好的 base64，无需公网可访问。
 * - 外链图片（http/https）：服务端抓取字节后转 base64。
 * 解析失败返回 null（图片可选，不影响发布主流程）。
 */
async function resolveImagePayload(
  imageUrl: string | null | undefined,
  fallbackName = "image"
): Promise<ImagePayload | null> {
  if (!imageUrl) return null
  try {
    const uploadMatch = imageUrl.match(/\/api\/uploads\/([^/?#]+)/)
    if (uploadMatch) {
      return await resolveUploadImage(decodeURIComponent(uploadMatch[1]), fallbackName)
    }

    if (/^https?:\/\//i.test(imageUrl)) {
      const res = await fetch(imageUrl, { signal: AbortSignal.timeout(COVER_FETCH_TIMEOUT) })
      if (!res.ok) return null
      const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase()
      const mimeType = contentType.startsWith("image/") ? contentType : "image/jpeg"
      const buffer = Buffer.from(await res.arrayBuffer())
      if (buffer.byteLength === 0 || buffer.byteLength > MAX_UPLOAD_SIZE) return null
      return {
        name: `${fallbackName}.${EXT_BY_MIME[mimeType] ?? "jpg"}`,
        mimeType,
        data: buffer.toString("base64"),
      }
    }
  } catch {
    // 图片获取失败不阻断发布
    return null
  }
  return null
}

/** 提取正文中所有站内图片的 upload id（按出现顺序去重） */
function extractBodyUploadIds(content: string | null | undefined): string[] {
  if (!content) return []
  const ids: string[] = []
  const re = /\/api\/uploads\/([A-Za-z0-9._-]+)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(content)) !== null) {
    const id = decodeURIComponent(match[1])
    if (!ids.includes(id)) ids.push(id)
  }
  return ids
}

function runScript(
  args: string[],
  stdinPayload?: string
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    // 有封面数据时通过 stdin 传递（base64 体积可能达数 MB，不能走命令行参数）
    const stdio: ["pipe" | "ignore", "pipe", "pipe"] = stdinPayload
      ? ["pipe", "pipe", "pipe"]
      : ["ignore", "pipe", "pipe"]
    const child = spawn("node", [PUBLISH_SCRIPT, ...args], {
      cwd: SKILL_DIR,
      env: { ...process.env },
      stdio,
    })
    let stdout = ""
    let stderr = ""
    const timer = setTimeout(() => {
      child.kill("SIGKILL")
      reject(new Error("发布超时（5 分钟）"))
    }, PUBLISH_TIMEOUT)
    const out = child.stdout
    const err = child.stderr
    if (out) out.on("data", (d) => (stdout += d))
    if (err) err.on("data", (d) => (stderr += d))
    if (stdinPayload) {
      const stdin = child.stdin
      if (stdin) {
        stdin.on("error", () => {})
        stdin.write(stdinPayload)
        stdin.end()
      }
    }
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

    // 图片素材处理：封面 + 正文内联图片统一解析成 base64（站内 /api/uploads/<id> 直接取库里的
    // base64），通过 stdin 交给脚本，由脚本用 Chromium 上传控件逐张提交给掘金，
    // 拿到掘金图床地址后替换正文里的相对地址，无需图片公网可访问。
    const cover = await resolveImagePayload(article.coverImage, "cover")
    const bodyImages: BodyImagePayload[] = []
    for (const id of extractBodyUploadIds(article.content)) {
      const payload = await resolveUploadImage(id, "body")
      if (payload) bodyImages.push({ id, ...payload })
    }
    const assets: AssetsPayload = { cover, images: bodyImages }
    const hasAssets = !!cover || bodyImages.length > 0
    if (hasAssets) {
      scriptArgs.push("--assets-stdin")
    }

    try {
      const { stdout } = await runScript(scriptArgs, hasAssets ? JSON.stringify(assets) : undefined)
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
          coverUploaded: result.coverUploaded ?? null,
          bodyImagesUploaded: result.bodyImagesUploaded ?? 0,
          bodyImagesFailed: result.bodyImagesFailed ?? [],
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
