#!/usr/bin/env node
// 自动把本地 Markdown 发布到掘金（juejin.cn）。
import { chromium } from "playwright"
import { promises as fs, existsSync, readdirSync } from "node:fs"
import path from "node:path"
import os from "node:os"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")
const AUTH_FILE = path.join(ROOT, ".auth", "juejin.json")
const TMP_DIR = path.join(ROOT, ".tmp")
const EDITOR_URL = "https://juejin.cn/editor/drafts/new?v=2"

// 若项目内存在 .browsers（沙箱/CI 本地安装的浏览器），优先使用；否则回退到系统默认安装目录
if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  const localBrowsers = path.join(ROOT, "..", "..", "..", ".browsers")
  if (existsSync(localBrowsers)) process.env.PLAYWRIGHT_BROWSERS_PATH = localBrowsers
}

// 动态扫描 .browsers 目录定位 chromium 可执行文件（不硬编码版本号，跨平台）
function resolveLocalChrome() {
  const localBrowsers = path.join(ROOT, "..", "..", "..", ".browsers")
  if (!existsSync(localBrowsers)) return null
  let chromiumDir = ""
  try {
    chromiumDir = readdirSync(localBrowsers).find(
      (d) => d.startsWith("chromium-") && !d.includes("headless")
    ) ?? ""
  } catch {
    return null
  }
  if (!chromiumDir) return null
  const base = path.join(localBrowsers, chromiumDir)
  const exe = process.platform === "win32" ? "chrome.exe" : "chrome"
  const subs = ["chrome-win64", "chrome-win", "chrome-linux", "chrome-mac-arm64", "chrome-mac"]
  for (const sub of subs) {
    const p = path.join(base, sub, exe)
    if (existsSync(p)) return p
  }
  return null
}

const DEFAULT_TIMEOUT = 180000

// ---------- 工具 ----------

function parseArgs(argv) {
  const args = { tags: [], headless: false, timeout: DEFAULT_TIMEOUT }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => argv[++i]
    if (a === "--file") args.file = next()
    else if (a === "--title") args.title = next()
    else if (a === "--tags") args.tags = (next() ?? "").split(",").map((s) => s.trim()).filter(Boolean)
    else if (a === "--category") args.category = next()
    else if (a === "--cookie") args.cookie = next()
    else if (a === "--article-id") args.articleId = next()
    else if (a === "--force-new") args.forceNew = true
    else if (a === "--headless") args.headless = true
    else if (a === "--dry-run") args.dryRun = true
    else if (a === "--timeout") args.timeout = Number(next()) || DEFAULT_TIMEOUT
  }
  return args
}

// 把掘金 Cookie 字符串（如 "sessionid=xxx; passport_csrf_token=yyy; ..."）解析成 Playwright cookie 数组
function parseCookies(cookieString) {
  return cookieString
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => {
      const idx = pair.indexOf("=")
      if (idx <= 0) return null
      return {
        name: pair.slice(0, idx).trim(),
        value: pair.slice(idx + 1).trim(),
        domain: ".juejin.cn",
        path: "/",
        secure: true,
        httpOnly: true,
        sameSite: "Lax",
      }
    })
    .filter(Boolean)
}

// 解析可选 front matter：---\ntitle: ...\ntags: ...\ncategory: ...\n---
function parseFrontMatter(content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!m) return { frontMatter: {}, body: content }
  const meta = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([\w-]+)\s*:\s*(.+)$/)
    if (kv) meta[kv[1].trim()] = kv[2].trim()
  }
  return { frontMatter: meta, body: content.slice(m[0].length) }
}

function extractTitle(body, explicit) {
  if (explicit) return explicit
  const m = body.match(/^#\s+(.+?)\s*$/m)
  return m ? m[1].trim() : ""
}

function stripTitleLine(body) {
  // 移除正文开头的 # 标题行，避免掘金正文重复出现标题
  return body.replace(/^#\s+.+\s*$/m, "").replace(/^\s*\n+/, "").trim()
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function saveFailureScreenshot(page, label) {
  try {
    await fs.mkdir(TMP_DIR, { recursive: true })
    const file = path.join(TMP_DIR, `failure-${Date.now()}-${label}.png`)
    await page.screenshot({ path: file, fullPage: true })
    return file
  } catch {
    return null
  }
}

// 命中任意一个可见选择器，返回 Locator；找不到返回 null
async function firstVisible(page, selectors, timeout = 10000) {
  for (const sel of selectors) {
    const loc = page.locator(sel).first()
    try {
      await loc.waitFor({ state: "visible", timeout })
      return loc
    } catch {
      // 继续尝试下一个
    }
  }
  return null
}

// 把文本复制到剪贴板并 Ctrl+V 粘贴到当前聚焦元素
async function pasteText(page, context, text) {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: "https://juejin.cn",
  })
  await page.evaluate((t) => navigator.clipboard.writeText(t), text)
  await page.keyboard.press("Control+V")
}

// 用掘金 API 探测 post id 对应文章是否仍存在（本人文章才会返回 draft_id）。
// 返回 draft_id 字符串；无法确认时返回 null（不抛错，交由浏览器探测兜底）。
async function probeArticleDraftId(cookieString, articleId) {
  if (!articleId || articleId === "0") return null
  try {
    const res = await fetch(`https://api.juejin.cn/content_api/v1/article/detail?aid=2608&spider=0`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieString,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Referer: "https://juejin.cn/",
        Origin: "https://juejin.cn",
      },
      // article_id 必须是数字，传字符串会被掘金判为“参数错误”
      body: JSON.stringify({ article_id: Number(articleId) }),
    })
    if (!res.ok) return null
    const json = await res.json()
    if (json && json.err_no === 0 && json.data && json.data.draft_id) {
      return String(json.data.draft_id)
    }
  } catch {
    // 探测异常忽略，交由浏览器探测兜底
  }
  return null
}

// 用浏览器探测 post id 对应文章是否存在，并在存在时尝试提取“编辑”入口的 draft_id。
// 返回 { exists: boolean, draftId: string }。
async function probePostInBrowser(page, articleId) {
  await page.goto(`https://juejin.cn/post/${articleId}`, { waitUntil: "domcontentloaded", timeout: 60000 })
  // 等待文章内容渲染，或出现“找不到页面”
  await page
    .waitForFunction(() => {
      const text = document.title + " " + (document.body?.innerText || "").slice(0, 2000)
      return (
        !!document.querySelector("#article-root, .article-content, .markdown-body, article h1") ||
        /找不到页面|文章不存在|内容为空/.test(text)
      )
    }, { timeout: 30000 })
    .catch(() => {})
  await delay(3000)
  // 若是本人文章，等待“编辑”入口渲染（a[href*='/editor/drafts/']）
  try {
    await page.waitForSelector("a[href*='/editor/drafts/']", { timeout: 5000 })
  } catch {
    // 未发现编辑入口，忽略
  }
  return page.evaluate(() => {
    const hasArticle = !!document.querySelector("#article-root, .article-content, .markdown-body, article h1")
    const text = document.title + " " + (document.body?.innerText || "").slice(0, 2000)
    const notFound = /找不到页面|文章不存在|内容为空|页面不存在/.test(text)
    const editLinks = Array.from(document.querySelectorAll("a[href*='/editor/drafts/']")).map((a) => a.getAttribute("href") || "")
    const m = editLinks[0]?.match(/\/editor\/drafts\/(\d+)/)
    return { exists: hasArticle && !notFound, draftId: m ? m[1] : "" }
  })
}

// 从结果 URL 提取掘金 post id
function extractPostId(url) {
  const m = url.match(/\/(?:post|spost)\/(\d+)/)
  return m ? m[1] : ""
}

// ---------- 主流程 ----------

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (!args.file) {
    console.log(JSON.stringify({ ok: false, message: "缺少必填参数 --file" }))
    process.exitCode = 1
    return
  }

  // 1. 读取并解析 markdown
  let md
  try {
    md = await fs.readFile(args.file, "utf8")
  } catch (error) {
    console.log(JSON.stringify({ ok: false, message: `无法读取文件 ${args.file}：${error instanceof Error ? error.message : error}` }))
    process.exitCode = 1
    return
  }
  const { frontMatter, body: mdBody } = parseFrontMatter(md)
  const title = extractTitle(mdBody, args.title || frontMatter.title) || args.title || ""
  const tags = args.tags.length ? args.tags : (frontMatter.tags ? frontMatter.tags.split(",").map((s) => s.trim()).filter(Boolean) : [])
  const category = args.category || frontMatter.category || ""
  const content = stripTitleLine(mdBody)

  if (!title) {
    console.log(JSON.stringify({ ok: false, message: "无法确定标题：请提供 --title 或让文件首行为 # 标题" }))
    process.exitCode = 1
    return
  }
  if (!content) {
    console.log(JSON.stringify({ ok: false, message: "文章正文为空" }))
    process.exitCode = 1
    return
  }

  // 2. 校验登录态：优先用 --cookie 传入的 Cookie 字符串；否则回退到 login 保存的 storage state
  const cookieString = args.cookie || process.env.JUEJIN_COOKIE || ""
  const hasAuthFile = await fs.access(AUTH_FILE).then(() => true).catch(() => false)
  if (!cookieString && !hasAuthFile) {
    console.log(JSON.stringify({ ok: false, message: "未找到登录态，请在后台「个人管理」配置掘金 Cookie，或先运行 node scripts/login.mjs" }))
    process.exitCode = 1
    return
  }

  // 2.5 发布模式在浏览器启动后决定（见下方，依赖登录态页面渲染探测）

  const browser = await chromium.launch({ headless: args.headless, executablePath: resolveLocalChrome() ?? undefined })
  const contextOptions = { viewport: { width: 1366, height: 900 } }
  if (cookieString) {
    // 用 Cookie 字符串构造登录态：覆盖原 storageState，避免旧文件干扰
    const cookies = parseCookies(cookieString)
    if (cookies.length === 0) {
      await browser.close()
      console.log(JSON.stringify({ ok: false, message: "Cookie 字符串为空或格式不正确，请检查后台配置" }))
      process.exitCode = 1
      return
    }
    contextOptions.storageState = { cookies, origins: [] }
  } else {
    contextOptions.storageState = AUTH_FILE
  }
  const context = await browser.newContext(contextOptions)
  const page = await context.newPage()

  // 决定发布模式：提供了 --article-id 且未强制新增时，先探测掘金上该文章是否存在
  // 存在 → 更新流程（打开草稿编辑器修改）；不存在 → 回退新增流程
  let targetUrl = EDITOR_URL
  let isUpdate = false
  if (args.articleId && !args.forceNew) {
    // 快速 API 探测（仅本人文章返回 draft_id），失败/不确定则交由浏览器探测兜底
    let draftId = cookieString ? await probeArticleDraftId(cookieString, args.articleId) : null
    if (!draftId) {
      const probe = await probePostInBrowser(page, args.articleId)
      if (probe.exists) {
        draftId = probe.draftId
        if (!draftId) {
          await browser.close()
          console.log(JSON.stringify({ ok: false, message: `已绑定的掘金文章（post ${args.articleId}）仍存在，但未能定位其草稿编辑入口，已中止发布，避免重复新增；请到掘金手动编辑该文章，或使用 --force-new 强制新增` }))
          process.exitCode = 1
          return
        }
        console.log(`检测到已绑定掘金文章（post ${args.articleId}），走更新流程`)
      } else {
        console.log(`已绑定的掘金文章（post ${args.articleId}）在掘金不存在，自动走新增发布`)
      }
    } else {
      console.log(`检测到已绑定掘金文章（post ${args.articleId}），走更新流程`)
    }
    if (draftId) {
      isUpdate = true
      targetUrl = `https://juejin.cn/editor/drafts/${draftId}`
    }
  }

  try {
    // 3. 打开编辑器（新增：/editor/drafts/new；更新：/editor/drafts/<draft_id>）
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60000 })

    // 4. 填写标题
    const titleInput = await firstVisible(page, [
      'input[placeholder="输入文章标题..."]',
      'textarea[placeholder="输入文章标题..."]',
    ], 30000)
    if (!titleInput) {
      const shot = await saveFailureScreenshot(page, "title-not-found")
      console.log(JSON.stringify({ ok: false, message: `未能定位标题输入框（可能未登录或页面结构变化）${shot ? `，截图：${shot}` : ""}` }))
      process.exitCode = 1
      return
    }
    await titleInput.fill(title)

    // 5. 粘贴正文（CodeMirror 编辑器，必须用剪贴板粘贴）
    // 注意：直接点击 .CodeMirror-code 会被父级 .CodeMirror-scroll 拦截（pointer-events），
    // 因此点击可交互的滚动容器 .CodeMirror-scroll（force 强制点击，聚焦编辑器）
    const editor = await firstVisible(page, [
      ".CodeMirror-scroll",
      ".CodeMirror-code",
      ".CodeMirror",
    ], 30000)
    if (!editor) {
      const shot = await saveFailureScreenshot(page, "editor-not-found")
      console.log(JSON.stringify({ ok: false, message: `未能定位正文编辑器${shot ? `，截图：${shot}` : ""}` }))
      process.exitCode = 1
      return
    }
    try {
      await editor.click({ force: true })
    } catch (e) {
      // 某些情况下 force 点击仍失败，尝试点击编辑区域中心
      await editor.click({ position: { x: 60, y: 60 } }).catch(() => {})
    }
    if (isUpdate) {
      // 更新流程：编辑器预填旧正文，先全选删除再粘贴新内容
      await page.keyboard.press("Control+A")
      await page.keyboard.press("Delete")
    }
    await pasteText(page, context, content)
    // 等待掘金解析 markdown 并上传图片（图片较多时耗时较长）
    await delay(12000)

    // 6. 点击「发布」，打开发布设置弹窗
    // 掘金编辑页顶栏有「发布」按钮（草稿箱右侧），点击后弹出发布设置弹窗
    const publishBtn = await firstVisible(page, [
      'button:has-text("发布")',
      '.panel button:has-text("发布")',
      '[class*="editor"] button:has-text("发布")',
      'text=发布文章',
    ], 30000)
    if (!publishBtn) {
      const shot = await saveFailureScreenshot(page, "publish-btn-not-found")
      console.log(JSON.stringify({ ok: false, message: `未能定位发布按钮${shot ? `，截图：${shot}` : ""}` }))
      process.exitCode = 1
      return
    }
    await publishBtn.click()
    // 等待发布弹窗渲染（出现「确定并发布」按钮）
    const confirmBtnWait = await firstVisible(page, [
      'button:has-text("确定并发布")',
      '[class*="dialog"] button:has-text("确定并发布")',
    ], 15000)

    // 7. 选择分类：优先指定分类；找不到则回退到第一个分类（避免分类为空被掘金校验拦截）
    let selectedCategory = ""
    if (confirmBtnWait) {
      if (category) {
        const catEl = await firstVisible(page, [
          `[class*="category-list"] div:has-text("${category}")`,
          `.form-item-content.category-list div:text-is("${category}")`,
          `.category-list:has-text("${category}")`,
        ], 8000)
        if (catEl) {
          await catEl.click()
          selectedCategory = category
        }
      }
      if (!selectedCategory) {
        // 指定分类不存在（如「教程」不在掘金固定分类中）→ 选第一个分类
        const firstCat = await firstVisible(page, [
          '[class*="category-list"] div:not([class*="category-list"])',
          '[class*="category-list"] li:first-child',
          '[class*="category-list"] *:nth-child(1)',
        ], 5000)
        if (firstCat) {
          await firstCat.click()
          selectedCategory = "（自动选择第一个分类）"
        }
      }
    }

    // 8. 添加标签（至少 1 个；掘金要求发布时至少选一个标签）
    // 传入的标签若在掘金不存在则跳过；全部不可用时兜底添加默认标签「前端」，避免发布被拦截
    let addedTagCount = 0
    const allTags = tags.length ? tags : ["前端"]
    for (const tag of allTags) {
      const tagSelect = await firstVisible(page, [
        '.byte-select__placeholder:has-text("请搜索添加标签")',
        'div[class*="byte-select__placeholder"]:has-text("请搜索添加标签")',
        '[class*="byte-select"]:has-text("请搜索添加标签")',
      ], 10000)
      if (!tagSelect) break
      await tagSelect.click()
      await page.keyboard.insertText(tag)
      await delay(1200)
      const option = await firstVisible(page, [
        `li.byte-select-option:has-text("${tag}")`,
        `li[class*="byte-select-option"]:has-text("${tag}")`,
        `.byte-select-dropdown li:has-text("${tag}")`,
        `[class*="byte-select-option"]:has-text("${tag}")`,
      ], 6000)
      if (option) {
        await option.click()
        addedTagCount++
      }
      // 找不到则跳过（不按回车，避免误选）；已添加过标签则停止
      await delay(500)
      if (addedTagCount > 0) break
    }
    if (addedTagCount === 0) {
      // 极端兜底：尝试直接输入回车创建标签（掘金允许自定义标签）
      const tagSelect = await firstVisible(page, [
        '.byte-select__placeholder:has-text("请搜索添加标签")',
        'div[class*="byte-select__placeholder"]:has-text("请搜索添加标签")',
      ], 5000)
      if (tagSelect) {
        await tagSelect.click()
        await page.keyboard.insertText("前端")
        await delay(1000)
        await page.keyboard.press("Enter")
      }
    }

    // 9. 点击「确定并发布」
    if (!confirmBtnWait) {
      const shot = await saveFailureScreenshot(page, "confirm-not-found")
      console.log(JSON.stringify({ ok: false, message: `未能定位「确定并发布」按钮${shot ? `，截图：${shot}` : ""}` }))
      process.exitCode = 1
      return
    }
    const confirmBtn = confirmBtnWait

    if (args.dryRun) {
      // 试跑模式：不真正发布，停在发布弹窗供人工确认
      const shot = await saveFailureScreenshot(page, "dry-run-ready")
      console.log(JSON.stringify({
        ok: true,
        title,
        dryRun: true,
        mode: isUpdate ? "update" : "new",
        category: selectedCategory || (category || "未选择"),
        message: `试跑成功（${isUpdate ? "更新流程" : "新增流程"}）：标题/正文/分类/标签均已填充，发布弹窗已就绪，未执行最终发布${shot ? `，截图：${shot}` : ""}`,
      }))
      return
    }
    await confirmBtn.click()

    // 监听掘金发布接口返回的 article_id（最可靠的 post id 来源）。
    // 掘金发布成功后不一定会跳转到 /post/<id>（可能停留编辑器并弹成功提示），
    // 但前端必定会调用 content_api/v1/article/publish，其响应 data.article_id 即新文章 id。
    let apiArticleId = ""
    page.on("response", (res) => {
      try {
        if (/\/content_api\/v1\/article\/[^/]*publish/.test(res.url())) {
          res
            .json()
            .then((json) => {
              const id =
                json?.data?.article_id ??
                json?.data?.id ??
                json?.data?.article?.article_id ??
                ""
              if (id) apiArticleId = String(id)
            })
            .catch(() => {})
        }
      } catch {
        // 忽略解析异常
      }
    })

    // 10. 等待跳转，确认发布结果
    // 掘金发布成功后可能跳转到：/post/<id>（详情）、/spost/<id>（审核中）、/published（已发布列表），也可能停留编辑器页
    let finalUrl = page.url()
    try {
      await page.waitForURL(/\/spost\/\d+|\/post\/\d+|\/published/, { timeout: 60000 })
      finalUrl = page.url()
    } catch {
      finalUrl = page.url()
    }
    // 接口响应可能晚于 URL 判断，再等一小段
    if (!apiArticleId) await delay(3000)

    const urlPostId = extractPostId(finalUrl)
    const postId = apiArticleId || urlPostId

    if (postId) {
      const auditing = /\/spost\/\d+/.test(finalUrl)
      const url = /\/post\/\d+|\/spost\/\d+/.test(finalUrl)
        ? finalUrl
        : `https://juejin.cn/post/${postId}`
      console.log(JSON.stringify({
        ok: true,
        title,
        url,
        postId,
        status: auditing ? "auditing" : "published",
        category: selectedCategory || (category || ""),
        message: `${isUpdate ? "更新成功" : "发布成功"}${auditing ? "（审核中）" : ""}：${url}`,
      }))
    } else if (/\/published/.test(finalUrl)) {
      // 跳转到已发布列表页：从页面中提取刚发布文章的文章链接
      let postUrl = ""
      let pid = ""
      try {
        postUrl = await page.evaluate((t) => {
          const links = Array.from(document.querySelectorAll("a[href*='/post/']"))
          // 优先找标题匹配的文章链接；找不到则取列表第一个
          const hit = links.find((a) => (a.innerText || "").includes(t))
          const target = hit || links[0]
          return target ? target.getAttribute("href") || "" : ""
        }, title).catch(() => "")
        if (postUrl && !postUrl.startsWith("http")) postUrl = "https://juejin.cn" + postUrl
        pid = extractPostId(postUrl)
      } catch {
        postUrl = ""
      }
      console.log(JSON.stringify({
        ok: true,
        title,
        url: postUrl || finalUrl,
        postId: pid,
        status: "published",
        message: `${isUpdate ? "更新成功" : "发布成功"}${pid ? `：${postUrl}` : "（已跳转到发布列表页，但未能提取文章链接）"}`,
      }))
    } else {
      const shot = await saveFailureScreenshot(page, "no-redirect")
      console.log(JSON.stringify({ ok: false, title, url: finalUrl, message: `未能确认发布结果（未捕获到发布接口返回的文章 id，且未跳转到文章页）${shot ? `，截图：${shot}` : ""}，当前页面：${finalUrl}` }))
      process.exitCode = 1
    }
  } catch (error) {
    const shot = await saveFailureScreenshot(page, "error")
    console.log(JSON.stringify({ ok: false, message: `发布过程出错：${error instanceof Error ? error.message : String(error)}${shot ? `，截图：${shot}` : ""}` }))
    process.exitCode = 1
  } finally {
    await browser.close()
  }
}

main()
