#!/usr/bin/env node
// 校验掘金登录 Cookie 是否有效（无需启动浏览器，直接请求掘金 API）。
import { promises as fs, existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")
const AUTH_FILE = path.join(ROOT, ".auth", "juejin.json")

// 若项目内存在 .browsers（沙箱/CI 本地安装的浏览器），优先使用；否则回退到系统默认安装目录
if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  const localBrowsers = path.join(ROOT, "..", "..", "..", ".browsers")
  if (existsSync(localBrowsers)) process.env.PLAYWRIGHT_BROWSERS_PATH = localBrowsers
}

function parseArgs(argv) {
  const args = { cookie: "" }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--cookie") args.cookie = argv[++i] ?? ""
  }
  return args
}

async function readAuthFileCookies() {
  try {
    const raw = await fs.readFile(AUTH_FILE, "utf8")
    const state = JSON.parse(raw)
    const cookies = state.cookies ?? []
    return cookies
      .filter((c) => c.domain.includes("juejin.cn") || c.url?.includes("juejin.cn"))
      .map((c) => `${c.name}=${c.value}`)
      .join("; ")
  } catch {
    return ""
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  let cookie = args.cookie || process.env.JUEJIN_COOKIE || ""
  if (!cookie) cookie = await readAuthFileCookies()

  if (!cookie) {
    console.log(JSON.stringify({ ok: false, message: "未提供 Cookie：请用 --cookie 传入，或先在后台「个人管理」配置" }))
    process.exitCode = 1
    return
  }

  // 掘金登录态校验端点：返回 err_no=0 且带 profile_id 即视为已登录
  const url = "https://api.juejin.cn/user_api/v1/user/profile_id"
  try {
    const res = await fetch(url, {
      headers: {
        Cookie: cookie,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Referer: "https://juejin.cn/",
        Origin: "https://juejin.cn",
      },
    })
    const text = await res.text()
    let data = null
    try {
      data = JSON.parse(text)
    } catch {
      data = null
    }

    const profileId = data?.data?.profile_id
    // 未登录时掘金返回 profile_id 为空或 "0"，需要排除
    if (data && data.err_no === 0 && profileId && profileId !== "0") {
      console.log(JSON.stringify({ ok: true, message: "Cookie 有效，登录态正常", profileId }))
    } else if (data && data.err_no !== 0) {
      console.log(JSON.stringify({ ok: false, message: `Cookie 无效（err_no=${data.err_no}：${data.err_msg || "未登录"}），请重新复制最新 Cookie` }))
      process.exitCode = 1
    } else {
      console.log(JSON.stringify({ ok: false, message: "Cookie 无效（未获取到用户信息），请重新复制最新 Cookie" }))
      process.exitCode = 1
    }
  } catch (error) {
    console.log(JSON.stringify({ ok: false, message: `请求失败：${error instanceof Error ? error.message : String(error)}` }))
    process.exitCode = 1
  }
}

main()
