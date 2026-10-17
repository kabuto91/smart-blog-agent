import { renderHomePage } from "@/lib/home-page"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** 站点根路径：直接渲染主题首页。 */
export const GET = renderHomePage
