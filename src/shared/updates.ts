// The update events main pushes to the renderer. Kept in shared so the
// renderer never imports electron-updater's types (or the module itself).

export type UpdateEvent =
  | { type: 'checking' }
  | { type: 'available'; version: string; notes: string | null }
  | { type: 'none'; version: string }
  | { type: 'progress'; percent: number; transferred: number; total: number }
  | { type: 'ready'; version: string }
  | { type: 'error'; message: string }
