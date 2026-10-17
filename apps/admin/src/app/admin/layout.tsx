"use client"

import { usePathname } from "next/navigation"
import { AdminSidebar } from "@/components/admin/admin-sidebar"
import { cn } from "@/lib/utils"

const titles: Record<string, string> = {
  personal: "个人管理",
  articles: "文章管理",
  themes: "主题管理",
}

function getBreadcrumbs(pathname: string) {
  const segments = pathname.split("/").filter(Boolean)
  const crumbs = [{ label: "管理", href: "/admin" }]

  if (segments.length > 1) {
    const key = segments[1]
    const title = titles[key] ?? key
    crumbs.push({ label: title, href: pathname })
  }

  return crumbs
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const crumbs = getBreadcrumbs(pathname)

  return (
    <div className="flex h-screen overflow-hidden">
      <AdminSidebar />
      <div className="flex flex-1 flex-col overflow-hidden bg-[#F5F4F1]">
        <header className="flex items-center gap-1.5 border-b border-black/[0.06] px-6 py-3 text-sm text-[#6B7280]">
          {crumbs.map((c, i) => (
            <span key={c.href} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-black/20">/</span>}
              <span
                className={cn(
                  i === crumbs.length - 1 && "font-medium text-[#1C1C1E]"
                )}
              >
                {c.label}
              </span>
            </span>
          ))}
        </header>
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  )
}
