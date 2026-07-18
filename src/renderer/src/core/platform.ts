// The single gateway to the privileged API. In Electron, `window.lumen` is
// injected by the preload script. In a plain browser (npm run dev:web) we
// install a mock so the entire UI runs with demo data.
import type { LumenApi } from '@shared/lumen-api'
import { createMockLumen } from './platform.mock'

declare global {
  interface Window {
    lumen?: LumenApi
  }
}

export const platform: LumenApi = window.lumen ?? createMockLumen()
export const isDesktop = platform.app.platform === 'win32'
