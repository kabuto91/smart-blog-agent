#!/usr/bin/env node
// 浏览器自动化：在掘金「专栏管理」页新建一个专栏。
// 说明：新建专栏的 create POST 无法稳定捕获（抓包时点击「确定」不触发可识别的 create 接口），
// 因此本脚本采用「提交后刷新本人专栏列表，按标题反查 column_id」的方式确认创建成功。
// 入参：--name 专栏名称，--summary 专栏简介，--cookie 掘金 Cookie（缺省从本地 DB/auth 文件读取）。
// 输出：{ ok, columnId?, title?, message }
import { chromium } from "playwright"
import { promises as fs, existsSync, readdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createClient } from "@libsql/client"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const CryptoJS = require("crypto-js")
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")
const AUTH_FILE = path.join(ROOT, ".auth", "juejin.json")
const COLUMN_URL = "https://juejin.cn/creator/content/column?status=all"
const COLUMN_LIST_API = "https://api.juejin.cn/content_api/v1/column/author_center_list?aid=2608&spider=0"
const PAGE_SIZE = 10
const MAX_PAGES = 20
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  const localBrowsers = path.join(ROOT, "..", "..", "..", ".browsers")
  if (existsSync(localBrowsers)) process.env.PLAYWRIGHT_BROWSERS_PATH = localBrowsers
}

function resolveLocalChrome() {
  const localBrowsers = path.join(ROOT, "..", "..", "..", ".browsers")
  if (!existsSync(localBrowsers)) return null
  let dir = ""
  try {
    dir = readdirSync(localBrowsers).find((d) => d.startsWith("chromium-") && !d.includes("headless")) ?? ""
  } catch {
    return null
  }
  if (!dir) return null
  const base = path.join(localBrowsers, dir)
  const exe = process.platform === "win32" ? "chrome.exe" : "chrome"
  const subs = ["chrome-win64", "chrome-win", "chrome-linux", "chrome-mac-arm64", "chrome-mac"]
  for (const sub of subs) {
    const p = path.join(base, sub, exe)
    if (existsSync(p)) return p
  }
  return null
}

function parseArgs(argv) {
  const args = { cookie: "", headless: true, name: "", summary: "" }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => argv[++i]
    if (a === "--cookie") args.cookie = next()
    else if (a === "--name") args.name = next()
    else if (a === "--summary") args.summary = next()
    else if (a === "--headless") args.headless = true
  }
  return args
}

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

async function readAuthFileCookies() {
  try {
    const raw = await fs.readFile(AUTH_FILE, "utf8")
    const state = JSON.parse(raw)
    const cookies = state.cookies ?? []
    return cookies
      .filter((c) => c.domain.includes("juejin.cn") || (c.url ?? "").includes("juejin.cn"))
      .map((c) => `${c.name}=${c.value}`)
      .join("; ")
  } catch {
    return ""
  }
}

async function readAuthDbCookies() {
  try {
    const dbUrl = `file:${path.join(__dirname, "..", "..", "..", "..", "data", "theme-sessions.db")}`
    const client = createClient({ url: dbUrl })
    const rows = await client.execute({ sql: "SELECT config FROM site_config WHERE id = 1", args: [] })
    client.close()
    const raw = rows.rows?.[0]?.config
    if (raw) {
      const config = JSON.parse(raw)
      const stored = config?.juejinToken
      const key = process.env.LLM_ENCRYPTION_KEY || "kabuto"
      return stored ? CryptoJS.AES.decrypt(stored, key).toString(CryptoJS.enc.Utf8) : ""
    }
  } catch {
    // ignore
  }
  return ""
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

// 逐个尝试选择器，返回第一个可见的元素（找不到返回 null）
async function firstVisible(page, selectors, timeout = 8000) {
  for (const sel of selectors) {
    const loc = page.locator(sel).first()
    try {
      await loc.waitFor({ state: "visible", timeout })
      return loc
    } catch {
      // next
    }
  }
  return null
}

/** 用 Cookie 直连分页拉取本人全部专栏（新建后用于反查 column_id）。 */
async function* fetchOwnColumnIds(cookie) {
  for (let pageNo = 1; pageNo <= MAX_PAGES; pageNo++) {
    const res = await fetch(COLUMN_LIST_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": UA,
        Referer: "https://juejin.cn/",
        Origin: "https://juejin.cn",
        Cookie: cookie,
      },
      body: JSON.stringify({ audit_status: null, page_no: pageNo, page_size: PAGE_SIZE }),
    })
    if (!res.ok) throw new Error(`掘金专栏接口请求失败：HTTP ${res.status}`)
    const json = await res.json()
    if (json.err_no !== 0) {
      throw new Error(`掘金专栏接口返回异常：${json.err_msg || `err_no=${json.err_no}`}`)
    }
    const items = json.data ?? []
    for (const item of items) {
      const id = item?.column?.column_id
      const title = item?.column_version?.title?.trim()
      if (id && title) {
        yield { columnId: id, title }
      }
    }
    if (!items.length || !json.has_more) break
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const name = (args.name || "").trim()
  if (!name) {
    console.log(JSON.stringify({ ok: false, message: "缺少 --name 专栏名称" }))
    process.exitCode = 1
    return
  }
  const summary = (args.summary || "").trim()

  let cookie = args.cookie || process.env.JUEJIN_COOKIE || ""
  if (!cookie) cookie = await readAuthFileCookies()
  if (!cookie) cookie = await readAuthDbCookies()
  if (!cookie) {
    console.log(JSON.stringify({ ok: false, message: "未提供 Cookie：请用 --cookie 传入，或在后台「个人管理」配置" }))
    process.exitCode = 1
    return
  }

  let browser
  try {
    browser = await chromium.launch({ headless: args.headless, executablePath: resolveLocalChrome() ?? undefined })
    const context = await browser.newContext({
      viewport: { width: 1366, height: 900 },
      storageState: { cookies: parseCookies(cookie), origins: [] },
    })
    const page = await context.newPage()

    await page.goto(COLUMN_URL, { waitUntil: "domcontentloaded", timeout: 60000 })
    await delay(5000)

    // 点击「新建专栏」
    const createBtn = await firstVisible(page, ['button:has-text("新建专栏")', 'text=新建专栏'], 8000)
    if (!createBtn) {
      console.log(JSON.stringify({ ok: false, message: "未找到「新建专栏」按钮，可能登录态失效" }))
      process.exitCode = 1
      return
    }
    await createBtn.click()
    await delay(1500)

    // 填写名称（placeholder 含「请输入专栏名称」，maxlength 50）
    const titleInput = await firstVisible(
      page,
      ['input[placeholder*="请输入专栏名称"]', 'input[placeholder*="专栏名称"]', "input[maxlength='50']"],
      6000
    )
    if (!titleInput) {
      console.log(JSON.stringify({ ok: false, message: "未找到专栏名称输入框" }))
      process.exitCode = 1
      return
    }
    await titleInput.fill(name)
    await titleInput.press("Enter").catch(() => {})

    // 填写简介 textarea（可选）
    const summaryInput = await firstVisible(page, ['textarea[placeholder*="简介"]', "textarea"], 4000)
    if (summaryInput && summary) {
      await summaryInput.fill(summary)
    }

    await delay(800)

    // 点击「确定」提交（若按钮当时禁用，稍等待后再试一次）
    for (let attempt = 0; attempt < 3; attempt++) {
      const submit = await firstVisible(page, ['button:has-text("确定")'], 4000)
      if (!submit) break
      const disabled = await submit.isDisabled().catch(() => false)
      if (disabled) {
        await delay(1200)
        continue
      }
      await submit.click()
      await delay(2000)
      break
    }

    // 等待弹窗关闭，随后刷新列表反查新专栏
    await delay(3000)
    let foundColumnId = ""
    for (let i = 0; i < 3 && !foundColumnId; i++) {
      const list = []
      try {
        for await (const col of fetchOwnColumnIds(cookie)) list.push(col)
      } catch (e) {
        // 列表拉取失败时，稍等重试
        await delay(2000)
        continue
      }
      foundColumnId = list.find((c) => c.title === name)?.columnId ?? ""
      if (!foundColumnId) await delay(2500)
    }

    if (!foundColumnId) {
      console.log(JSON.stringify({ ok: false, message: `提交后未能在掘金专栏列表确认到「${name}」，可能创建未成功` }))
      process.exitCode = 1
      return
    }

    console.log(JSON.stringify({ ok: true, columnId: foundColumnId, title: name, message: "已在掘金创建专栏" }))
  } catch (e) {
    console.log(JSON.stringify({ ok: false, message: `新建专栏失败：${e instanceof Error ? e.message : String(e)}` }))
    process.exitCode = 1
  } finally {
    if (browser) await browser.close().catch(() => {})
  }
}

main()