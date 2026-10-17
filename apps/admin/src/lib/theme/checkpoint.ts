import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres"
import { prisma } from "@smart-blog/core/lib/db/client"

const globalForCheckpoint = globalThis as unknown as {
  themeCheckpointer?: Promise<PostgresSaver> | null
}

/**
 * 检查点连接串。优先走会话模式的 DIRECT_URL：LangGraph 的 saver 会显式 BEGIN/COMMIT，
 * 会话模式行为更接近直连，避开事务模式池化的连接复用语义。
 */
function checkpointConnString(): string {
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL
  if (!url) throw new Error("缺少 DIRECT_URL / DATABASE_URL，无法初始化检查点存储")
  return url
}

/**
 * 主题生成图的持久化 checkpointer（进程内单例，存 Supabase Postgres）。
 * 首次调用会建表（LangGraph 自带迁移，可重复执行），并发调用共享同一个初始化 Promise，
 * 避免 dev 热重载下重复 setup。
 */
export function getThemeCheckpointer(): Promise<PostgresSaver> {
  if (!globalForCheckpoint.themeCheckpointer) {
    globalForCheckpoint.themeCheckpointer = (async () => {
      const saver = PostgresSaver.fromConnString(checkpointConnString())
      await saver.setup()
      return saver
    })()
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
export async function pruneThemeCheckpoints(keep = KEEP_THREADS): Promise<void> {
  try {
    const saver = await getThemeCheckpointer()
    const rows = await prisma.$queryRaw<{ thread_id: string }[]>`
      SELECT thread_id, MAX(checkpoint_id) AS last
      FROM checkpoints
      GROUP BY thread_id
      ORDER BY last DESC
    `
    for (const row of rows.slice(keep)) {
      await saver.deleteThread(row.thread_id)
    }
  } catch {
    // 表尚未创建或数据库不可用：跳过清理，不影响生成
  }
}
