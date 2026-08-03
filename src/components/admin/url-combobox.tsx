"use client"

import { useState, useRef, useEffect } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import { ChevronDown, Sparkles } from "lucide-react"
import { UrlGenerateDialog } from "@/components/admin/url-generate-dialog"

export interface UrlComboboxOption {
  url: string
  label: string
  type: "home" | "archive" | "category" | "tag" | "article" | "custom"
}

interface UrlComboboxProps {
  value: string
  onChange: (value: string) => void
  options: UrlComboboxOption[]
  placeholder?: string
  onPageGenerated?: (url: string) => void
}

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i

function isImageUrl(url: string): boolean {
  try {
    const path = url.split("?")[0]
    return IMAGE_EXT.test(path)
  } catch {
    return false
  }
}

export function UrlCombobox({
  value,
  onChange,
  options,
  placeholder = "/link",
  onPageGenerated,
}: UrlComboboxProps) {
  const [previewUrl, setPreviewUrl] = useState("")
  const [genOpen, setGenOpen] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setPreviewUrl(value.trim())
    }, 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [value])

  function handleSelect(url: string) {
    onChange(url)
  }

  const isExisting = options.some((o) => o.url === value.trim())
  const showGenerate = value.trim() !== "" && !isExisting
  const showImage = isImageUrl(previewUrl)

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1">
        <div className="relative flex-1">
          <Input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className="pr-7"
          />
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  className="absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-[#6B7280] outline-none hover:bg-muted hover:text-[#1C1C1E]"
                  aria-label="选择已有链接"
                >
                  <ChevronDown className="size-3.5" />
                </button>
              }
            />
            <DropdownMenuContent
              align="end"
              className="w-64 max-h-64"
            >
              {options.length === 0 && (
                <div className="px-2 py-3 text-center text-xs text-[#6B7280]">
                  暂无可用链接
                </div>
              )}
              {options.map((option) => (
                <DropdownMenuItem
                  key={option.url}
                  onClick={() => handleSelect(option.url)}
                  className="flex-col items-start py-1.5"
                >
                  <span className="w-full truncate text-sm text-[#1C1C1E]">
                    {option.label}
                  </span>
                  <span className="w-full truncate text-[11px] text-[#6B7280]">
                    {option.url}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {showGenerate && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => setGenOpen(true)}
            title="AI 生成页面"
            className="text-[#E5A83D] hover:text-[#D4A035]"
          >
            <Sparkles className="size-3.5" />
          </Button>
        )}
      </div>

      {previewUrl && !isExisting && (
        <div className="relative overflow-hidden rounded-lg border border-black/[0.06] bg-[#F5F4F1]">
          {showImage ? (
            <div className="flex h-28 items-center justify-center bg-white p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewUrl}
                alt="链接预览"
                className="max-h-full max-w-full object-contain"
              />
            </div>
          ) : (
            <iframe
              src={previewUrl}
              sandbox="allow-scripts"
              className="pointer-events-none h-28 w-full"
              title="链接预览"
            />
          )}
        </div>
      )}

      <UrlGenerateDialog
        open={genOpen}
        onOpenChange={setGenOpen}
        url={value}
        onSaved={onPageGenerated}
      />
    </div>
  )
}
