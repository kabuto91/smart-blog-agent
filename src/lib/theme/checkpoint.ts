import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite"

const globalForCheckpoint = globalThis as unknown as {
  themeCheckpointer?: SqliteSaver | null
}

/**
 * 检查点库与业务库（DATABASE_URL）同目录但独立文件，
 * 避免与 Prisma 的 SQLite 写冲突，dev 模式下进程重启后仍可 resume。
 */
function checkpointDbPath(): string {
  const url = process.env.DATABASE_URL || "file:./dev.db"
  const file = url.startsWith("file:") ? url.slice("file:".length) : url
  return file.endsWith(".db")
    ? `${file.slice(0, -3)}-checkpoints.db`
    : `${file}-checkpoints.db`
}

/** 主题生成图的持久化 checkpointer（进程内单例）。 */
export function getThemeCheckpointer(): SqliteSaver {
  if (!globalForCheckpoint.themeCheckpointer) {
    globalForCheckpoint.themeCheckpointer = SqliteSaver.fromConnString(
      checkpointDbPath()
    )
  }
  return globalForCheckpoint.themeCheckpointer
}

/** 保留的最近线程数：完成态检查点要留一段时间供"继续生成"重放结果。 */
const KEEP_THREADS = 20

/**
 * 清理旧检查点线程，只保留最近 keep 个。
 * 完成态检查点不随生成成功立即删除（否则客户端断线后无法重放结果），
 * 体积控制由这里按数量回收；checkpoint_id 为 uuid6（时间有序）可直接排序。
 */
export function pruneThemeCheckpoints(keep = KEEP_THREADS): void {
  try {
    const saver = getThemeCheckpointer()
    const rows = saver.db
      .prepare(
        `SELECT thread_id, MAX(checkpoint_id) AS last
         FROM checkpoints
         GROUP BY thread_id
         ORDER BY last DESC`
      )
      .all() as { thread_id: string }[]
    for (const row of rows.slice(keep)) {
      saver.db
        .prepare(`DELETE FROM checkpoints WHERE thread_id = ?`)
        .run(row.thread_id)
      saver.db.prepare(`DELETE FROM writes WHERE thread_id = ?`).run(row.thread_id)
    }
  } catch {
    // 表尚未创建或数据库不可用：跳过清理，不影响生成
  }
}
