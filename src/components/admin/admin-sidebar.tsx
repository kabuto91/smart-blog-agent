"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  User,
  FileText,
  Palette,
  Settings,
  Sparkles,
  Library,
} from "lucide-react"
import { cn } from "@/lib/utils"

const navItems = [
  { href: "/admin/personal", label: "个人管理", icon: User },
  { href: "/admin/articles", label: "文章管理", icon: FileText },
  { href: "/admin/collections", label: "合集管理", icon: Library },
  { href: "/admin/themes", label: "主题管理", icon: Palette },
  { href: "/admin/settings", label: "博客设置", icon: Settings },
] as const

export function AdminSidebar() {
  const pathname = usePathname()

  return (
    <aside className="flex h-full w-56 shrink-0 flex-col bg-[#181A1E] text-sm">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <Sparkles className="size-5 text-[#E5A83D]" />
        <span className="font-semibold text-white/90">智能博客助手</span>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 px-3">
        {navItems.map((item) => {
          const active = pathname.startsWith(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "relative flex items-center gap-2.5 rounded-lg px-3 py-2.5 transition-colors",
                active
                  ? "bg-white/[0.06] text-[#E5A83D]"
                  : "text-white/50 hover:bg-white/[0.04] hover:text-white/70"
              )}
            >
              {active && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-0.5 rounded-full bg-[#E5A83D]" />
              )}
              <item.icon className="size-4 shrink-0" />
              {item.label}
            </Link>
          )
        })}
      </nav>

      <div className="border-t border-white/[0.06] px-5 py-4 text-xs text-white/30">
        Smart Blog Agent v0.1
      </div>
    </aside>
  )
}
