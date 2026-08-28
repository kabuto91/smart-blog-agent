"use client"

import { create } from "zustand"

interface AppState {
  /** 是否已配置视觉模型；null 表示尚未加载。 */
  visionConfigured: boolean | null
  /** 全局能力是否已加载完成。 */
  visionLoaded: boolean
  setVisionConfigured: (value: boolean) => void
  /** 从配置接口加载全局能力标记。 */
  loadCapabilities: () => Promise<void>
}

export const useAppStore = create<AppState>((set) => ({
  visionConfigured: null,
  visionLoaded: false,
  setVisionConfigured: (value) =>
    set({ visionConfigured: value, visionLoaded: true }),
  loadCapabilities: async () => {
    try {
      const res = await fetch("/api/vision-config")
      const data = (await res.json()) as { configured?: boolean }
      set({
        visionConfigured: data.configured ?? false,
        visionLoaded: true,
      })
    } catch {
      set({ visionConfigured: null, visionLoaded: true })
    }
  },
}))