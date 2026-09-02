#!/usr/bin/env node
// 一次性登录掘金并保存登录态（storage state），供后续发布复用。
import { chromium } from "playwright"
import { promises as fs, existsSync, readdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import readline from "node:readline"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")
const AUTH_FILE = path.join(ROOT, ".auth", "juejin.json")
const HOME_URL = "https://juejin.cn/"
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

// 已登录的判定选择器（命中任意一个即可）
const LOGGED_IN_SELECTORS = [
  'img[class*="avatar"]',
  '[class*="user-info"] [class*="avatar"]',
  '[class*="my-box"] [class*="avatar"]',
  '.nav-user img',
  '[data-v-inspector] img[class*="avatar"]',
]

function parseArgs(argv) {
  const args = { force: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--force") args.force = true
  }
  return args
}

async function isLoggedIn(page) {
  for (const sel of LOGGED_IN_SELECTORS) {
    const loc = page.locator(sel).first()
    if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) {
      return true
    }
  }
  return false
}

function promptEnter(message) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question(message, () => {
      rl.close()
      resolve()
    })
  })
}

async function main() {
  const { force } = parseArgs(process.argv.slice(2))

  if (!force && (await fs.access(AUTH_FILE).then(() => true).catch(() => false))) {
    console.log(JSON.stringify({ ok: true, message: "已存在登录态，跳过登录（如需重新登录请加 --force）", file: AUTH_FILE }))
    return
  }

  const browser = await chromium.launch({ headless: false, executablePath: resolveLocalChrome() ?? undefined })
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()

  try {
    await page.goto(HOME_URL, { waitUntil: "domcontentloaded", timeout: 60000 })
    console.log(JSON.stringify({ ok: true, message: "请在打开的浏览器中完成扫码/账号登录……" }))

    // 轮询检测登录态，最长 10 分钟
    const deadline = Date.now() + 10 * 60 * 1000
    let loggedIn = await isLoggedIn(page)
    while (!loggedIn && Date.now() < deadline) {
      await page.waitForTimeout(2000)
      loggedIn = await isLoggedIn(page)
    }

    if (!loggedIn) {
      console.log(JSON.stringify({ ok: false, message: "登录超时（10 分钟），请重新运行 login 脚本" }))
      process.exitCode = 1
      return
    }

    // 额外校验：进入编辑器页，确认标题框出现（防止仅主页误判）
    await page.goto(EDITOR_URL, { waitUntil: "domcontentloaded", timeout: 60000 })
    try {
      await page.waitForSelector('input[placeholder="输入文章标题..."]', { timeout: 20000 })
    } catch {
      console.log(JSON.stringify({ ok: false, message: "登录态校验失败：未能进入掘金编辑器页，请确认账号状态" }))
      process.exitCode = 1
      return
    }

    await fs.mkdir(path.dirname(AUTH_FILE), { recursive: true })
    await context.storageState({ path: AUTH_FILE })
    console.log(JSON.stringify({ ok: true, message: "登录成功，登录态已保存", file: AUTH_FILE }))
  } catch (error) {
    console.log(JSON.stringify({ ok: false, message: `登录失败：${error instanceof Error ? error.message : String(error)}` }))
    process.exitCode = 1
  } finally {
    await browser.close()
  }
}

main()
