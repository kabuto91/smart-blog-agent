import { createClient } from "@libsql/client"
import { createHash } from "node:crypto"
const db = createClient({ url: "file:data/theme-sessions.db" })
// 看一条记录的 checksum 格式
const r = await db.execute("SELECT checksum, migration_name FROM _prisma_migrations WHERE migration_name='20260818000000_add_theme_message_metrics'")
console.log("sample checksum:", JSON.stringify(r.rows))
// 计算新迁移的 checksum（prisma 对 migration.sql 内容做 hash，格式为 hex）
const sql = '-- AlterTable\nALTER TABLE "articles" ADD COLUMN "juejin_article_id" TEXT;\n'
// prisma 实际用 sha256 之类；先尝试两种格式插入，供比对
console.log("sha256:", createHash("sha256").update(sql).digest("hex"))
console.log("md5:", createHash("md5").update(sql).digest("hex"))
await db.close()
