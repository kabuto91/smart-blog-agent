import { renderHomePage } from "@/lib/home-page"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** /blog：与根路径一致地渲染主题首页（兼容主题内指向 /blog 的链接）。 */
export const GET = renderHomePage
