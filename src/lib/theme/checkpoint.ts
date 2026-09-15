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
