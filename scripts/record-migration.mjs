import { createClient } from "@libsql/client"
import { createHash, randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, "..")
const sql = readFileSync(path.join(PROJECT_ROOT, "prisma", "migrations", "20260901000000_add_juejin_article_id", "migration.sql"))
// prisma 的 checksum 是对文件内容的 hash，尝试 sha256
const checksum = createHash("sha256").update(sql).digest("hex")

const db = createClient({ url: "file:data/theme-sessions.db" })
// 先检查是否已插入
const existing = await db.execute("SELECT id FROM _prisma_migrations WHERE migration_name='20260901000000_add_juejin_article_id'")
if (existing.rows.length) {
  console.log("already recorded")
} else {
  const now = Date.now()
  await db.execute({
    sql: "INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    args: [randomUUID(), checksum, now, "20260901000000_add_juejin_article_id", null, null, now, 1],
  })
  console.log("inserted with checksum:", checksum)
}
await db.close()
