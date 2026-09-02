// 应用 ALTER TABLE 迁移（绕过 prisma migrate 的锁，用于 dev server 运行中）
import { createClient } from "@libsql/client"
const db = createClient({ url: "file:data/theme-sessions.db" })
try {
  await db.execute("ALTER TABLE articles ADD COLUMN juejin_article_id TEXT")
  console.log("column added")
} catch (e) {
  if (/duplicate column/i.test(e.message)) console.log("column already exists")
  else console.log("ERR:", e.message)
}
const r = await db.execute("PRAGMA table_info(articles)")
console.log("cols:", r.rows.map((x) => x.name).join(", "))
await db.close()
