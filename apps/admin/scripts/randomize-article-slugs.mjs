#!/usr/bin/env node
// 一次性数据维护：把现有文章的 slug 批量替换为随机 id（秒级时间戳 + 5 位随机后缀），
// 使详情页 URL 不再暴露标题内容。用法：node scripts/randomize-article-slugs.mjs [--dry-run]
import path from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_ROOT = path.resolve(__dirname, "..")
const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..")

const SLUG_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz"
// 已是随机格式的 slug 不再改动，避免重复执行时来回替换
const RANDOM_SLUG_RE = /^\d{10}-[a-z0-9]{5}$/

/** 独立运行时按需加载项目 env（app 优先，其次仓库根）；被 Next 进程 spawn 时变量已注入，不覆盖。 */
function loadProjectEnv() {
  for (const file of [
    path.join(APP_ROOT, ".env.local"),
    path.join(APP_ROOT, ".env"),
    path.join(PROJECT_ROOT, ".env.local"),
    path.join(PROJECT_ROOT, ".env"),
  ]) {
    try {
      process.loadEnvFile(file)
      return
    } catch {
      // 文件不存在则试下一个
    }
  }
}

function randomSuffix(length = 5) {
  let suffix = ""
  for (let i = 0; i < length; i++) {
    suffix += SLUG_ALPHABET[Math.floor(Math.random() * SLUG_ALPHABET.length)]
  }
  return suffix
}

function generateSlug(seconds) {
  return `${seconds}-${randomSuffix()}`
}

async function main() {
  const dryRun = process.argv.includes("--dry-run")
  if (!process.env.DATABASE_URL && !process.env.DIRECT_URL) loadProjectEnv()
  const conn = process.env.DATABASE_URL || process.env.DIRECT_URL
  if (!conn) {
    console.error("缺少 DATABASE_URL / DIRECT_URL，请确认 .env.local 已配置")
    process.exitCode = 1
    return
  }

  const client = new pg.Client({ connectionString: conn })
  await client.connect()
  try {
    const { rows } = await client.query(
      "SELECT id, slug, title, created_at FROM articles ORDER BY created_at ASC"
    )
    const used = new Set(rows.map((r) => r.slug))
    const updates = []
    for (const row of rows) {
      if (RANDOM_SLUG_RE.test(row.slug)) continue
      const seconds = Math.floor(new Date(row.created_at).getTime() / 1000)
      let next = generateSlug(seconds)
      let guard = 0
      while (used.has(next) && guard++ < 20) next = generateSlug(seconds)
      used.delete(row.slug)
      used.add(next)
      updates.push({ id: row.id, from: row.slug, to: next, title: row.title })
    }

    console.log(
      `共 ${rows.length} 篇，待更新 ${updates.length} 篇${dryRun ? "（dry-run，不写入）" : ""}`
    )
    for (const u of updates.slice(0, 10)) {
      console.log(`  ${u.from} -> ${u.to}  (${u.title})`)
    }
    if (updates.length > 10) console.log(`  ... 其余 ${updates.length - 10} 篇略`)

    if (!dryRun && updates.length) {
      await client.query("BEGIN")
      try {
        for (const u of updates) {
          await client.query("UPDATE articles SET slug = $1 WHERE id = $2", [
            u.to,
            u.id,
          ])
        }
        await client.query("COMMIT")
      } catch (err) {
        await client.query("ROLLBACK")
        throw err
      }
      console.log(`已更新 ${updates.length} 篇`)
    }
  } finally {
    await client.end().catch(() => {})
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exitCode = 1
})
