import { create } from 'zustand'
import { DEFAULT_SETTINGS, type Settings, type ThemeMode } from '@shared/types'
import type { DeepPartial } from '@shared/lumen-api'
import { platform, isDesktop } from '@/core/platform'

interface SettingsStore {
  settings: Settings
  resolvedTheme: 'dark' | 'light' | 'oled'
  ready: boolean
  init(): Promise<void>
  patch(p: DeepPartial<Settings>): void
}

const systemDark = window.matchMedia?.('(prefers-color-scheme: dark)')

function resolveTheme(mode: ThemeMode): 'dark' | 'light' | 'oled' {
  if (mode === 'system') return systemDark?.matches !== false ? 'dark' : 'light'
  return mode
}

/** WCAG-ish relative luminance to pick readable text on the accent */
function onAccentColor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return '#ffffff'
  const n = parseInt(m[1], 16)
  const lin = (c: number): number => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  const lum = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255)
  return lum > 0.45 ? '#101018' : '#ffffff'
}

function applyToDom(s: Settings, resolved: 'dark' | 'light' | 'oled'): void {
  const root = document.documentElement
  root.dataset.theme = resolved
  root.style.setProperty('--accent', s.theme.accent)
  root.style.setProperty('--on-accent', onAccentColor(s.theme.accent))
  if (isDesktop) {
    // Native zoom keeps pointer hit-testing exact at any scale; CSS zoom does not.
    platform.win.setZoomFactor(s.ui.scale)
    root.style.setProperty('--ui-scale', '1')
  } else {
    root.style.setProperty('--ui-scale', String(s.ui.scale))
  }
  root.dataset.reducedMotion = s.ui.reducedMotion ? 'true' : 'false'
  const useMaterial = isDesktop && s.theme.material !== 'solid' && resolved !== 'oled'
  if (useMaterial) root.dataset.material = s.theme.material
  else delete root.dataset.material
}

export const useSettings = create<SettingsStore>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  resolvedTheme: 'dark',
  ready: false,

  async init() {
    const settings = await platform.settings.get()
    const resolved = resolveTheme(settings.theme.mode)
    applyToDom(settings, resolved)
    set({ settings, resolvedTheme: resolved, ready: true })

    platform.settings.onChanged((s) => {
      const r = resolveTheme(s.theme.mode)
      applyToDom(s, r)
      set({ settings: s, resolvedTheme: r })
    })

    systemDark?.addEventListener?.('change', () => {
      const { settings: s } = get()
      if (s.theme.mode === 'system') {
        const r = resolveTheme('system')
        applyToDom(s, r)
        set({ resolvedTheme: r })
      }
    })
  },

  patch(p) {
    // Optimistic local apply for zero-lag theme/typography changes
    const current = get().settings
    const merged = deepMerge(current, p)
    const resolved = resolveTheme(merged.theme.mode)
    applyToDom(merged, resolved)
    set({ settings: merged, resolvedTheme: resolved })
    void platform.settings.patch(p)
  }
}))

function deepMerge<T>(base: T, patch: unknown): T {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    return (patch === undefined ? base : (patch as T))
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    out[k] = deepMerge((base as Record<string, unknown>)?.[k], v)
  }
  return out as T
}
