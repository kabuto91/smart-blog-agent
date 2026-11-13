import { PrismaPg } from "@prisma/adapter-pg"
import { Pool } from "pg"
import { PrismaClient } from "../../generated/prisma/client"

/**
 * 长流程（AI 主题生成）共用的 Postgres 连接池参数。
 * 单次 LLM 调用可能耗时数分钟，期间没有 DB 查询，空闲连接容易被服务端/中间层
 * 断开；复用坏连接会抛 "Client has encountered a connection error and is not
 * queryable"，导致整次生成中断。keepAlive 保活 + 主动回收空闲连接可避免。
 */
export const LONG_RUNNING_POOL_OPTIONS = {
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 30_000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
} as const

/** 为 LangGraph checkpointer 等长流程创建独立连接池（core 包已装 @types/pg）。 */
export function createLongRunningPgPool(
  connectionString: string,
  max = 3
): Pool {
  return new Pool({ connectionString, ...LONG_RUNNING_POOL_OPTIONS, max })
}

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

function createPrismaClient(): PrismaClient {
  // Supabase：应用运行时走 DATABASE_URL（事务模式池化端口 6543），
  // 迁移/建表走 DIRECT_URL（会话模式 5432），见 prisma.config.ts
  //
  // 生成流程里单次 LLM 调用可能耗时数分钟，期间没有任何 DB 查询，空闲连接
  // 容易被服务端/中间层断开；复用坏连接会抛 "Client has encountered a
  // connection error and is not queryable"，导致整次生成中断。连接池参数与
  // 主题 checkpointer 保持一致：TCP keepAlive 保活 + 主动回收空闲连接。
  const adapter = new PrismaPg(
    {
      connectionString: process.env.DATABASE_URL!,
      ...LONG_RUNNING_POOL_OPTIONS,
      max: 5,
    },
    {
      onPoolError: (err: Error) => {
        console.error("[prisma-pg] idle pool client error:", err.message)
      },
    }
  )
  return new PrismaClient({ adapter })
}

export const prisma = globalForPrisma.prisma || createPrismaClient()

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma
