import { redirect } from "next/navigation"

/** 后台应用入口：根路径直接进入管理后台。 */
export default function Home() {
  redirect("/admin")
}
