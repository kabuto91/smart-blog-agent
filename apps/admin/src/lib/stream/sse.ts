export const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
} as const

export interface SseHandle {
  /** 发送一个 SSE 数据帧（自动 JSON 序列化）。 */
  send: (data: unknown) => void
  /** 关闭流。 */
  close: () => void
}

/**
 * 把底层数据库驱动的连接错误翻译成可操作的前端提示。
 * 原始报错（如 "Client has encountered a connection error and is not queryable"）
 * 对用户没有指导意义，而检查点已保留，应提示可从断点续生。
 */
function friendlySseError(message: string): string {
  if (
    /not queryable|connection (error|terminated|reset)|Connection terminated unexpectedly|ECONNRESET/i.test(
      message
    )
  ) {
    return "数据库连接中断，本次生成已停止。已完成的步骤保留在检查点中，可点击「继续生成」从断点恢复；若反复出现请检查数据库连接配置。"
  }
  return message
}

/**
 * 创建统一的 SSE ReadableStream：内部统一处理 error 帧与关闭逻辑，
 * 路由只需在 run 里调用 send/close。
 *
 * 客户端断开（刷新/关页/网络中断）时触发 onClientGone，
 * 调用方据此中止正在执行的任务（保留检查点供续生）。
 */
export function createSSEStream(
  run: (handle: SseHandle) => Promise<void>,
  onClientGone?: () => void
): ReadableStream {
  let closed = false
  const markClientGone = () => {
    if (closed) return
    closed = true
    onClientGone?.()
  }

  return new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      const send = (data: unknown) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        } catch {
          // 写入失败说明连接已断开
          markClientGone()
        }
      }
      const close = () => {
        if (closed) return
        closed = true
        try {
          controller.close()
        } catch {
          // 已关闭
        }
      }
      try {
        await run({ send, close })
      } catch (error) {
        const message = error instanceof Error ? error.message : "未知错误"
        send({ type: "error", error: friendlySseError(message) })
      } finally {
        close()
      }
    },
    cancel() {
      // 客户端主动断开（刷新/关页/网络中断）
      markClientGone()
    },
  })
}