// Keyboard shortcut resolution: default keymap + user overrides → command ids.
// Pure logic (unit-tested); the DOM listener lives in App.

export interface KeymapEntry {
  binding: string
  commandId: string
}

/** Default bindings — industry-standard player keys. All user-rebindable. */
export const DEFAULT_KEYMAP: Record<string, string> = {
  // command id → binding
  'playback.toggle': 'Space',
  'playback.toggleK': 'K',
  'playback.seekBack': 'Left',
  'playback.seekForward': 'Right',
  'playback.seekBackLarge': 'J',
  'playback.seekForwardLarge': 'L',
  'playback.volumeUp': 'Up',
  'playback.volumeDown': 'Down',
  'playback.mute': 'M',
  'playback.fullscreen': 'F',
  'playback.speedDown': '[',
  'playback.speedUp': ']',
  'playback.speedReset': '\\',
  'playback.frameBack': ',',
  'playback.frameForward': '.',
  'playback.next': 'N',
  'playback.previous': 'P',
  'playback.loop': 'R',
  'playback.abRepeat': 'Shift+R',
  'playback.bookmark': 'B',
  'playback.stats': 'I',
  'playback.screenshot': 'Ctrl+Shift+S',
  'playback.pip': 'Alt+P',
  'playback.miniPlayer': 'Ctrl+M',
  'subtitles.cycle': 'C',
  'subtitles.delayMinus': 'Z',
  'subtitles.delayPlus': 'X',
  'app.openFile': 'Ctrl+O',
  'app.palette': 'Ctrl+Shift+P',
  'app.search': 'Ctrl+K',
  'app.searchAlt': 'Ctrl+F',
  'app.playlistDrawer': 'Ctrl+B',
  'app.settings': 'Ctrl+,',
  'app.back': 'Escape',
  'nav.home': 'Ctrl+1',
  'nav.library': 'Ctrl+2',
  'nav.playlists': 'Ctrl+3'
}

/**
 * Normalize a KeyboardEvent into a binding string like "Ctrl+Shift+S".
 * Shift is only a prefix for letters/digits/named keys — shifted punctuation
 * (e.g. "?") already arrives shifted in `e.key`.
 */
export function bindingFromEvent(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>): string | null {
  const key = normalizeKey(e.key)
  if (!key) return null
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey && (key.length > 1 || /[A-Z0-9]/.test(key))) parts.push('Shift')
  parts.push(key)
  return parts.join('+')
}

function normalizeKey(k: string): string | null {
  if (k === ' ' || k === 'Spacebar') return 'Space'
  if (k === 'ArrowLeft') return 'Left'
  if (k === 'ArrowRight') return 'Right'
  if (k === 'ArrowUp') return 'Up'
  if (k === 'ArrowDown') return 'Down'
  if (k === 'Esc') return 'Escape'
  if (k === 'Control' || k === 'Shift' || k === 'Alt' || k === 'Meta') return null
  if (k.length === 1) return k.toUpperCase()
  return k
}

/**
 * Build binding→command lookup. User overrides replace a command's default
 * binding entirely; an override also steals the binding from any command that
 * had it by default.
 */
export function resolveKeymap(overrides: Record<string, string>): Map<string, string> {
  const bindingToCommand = new Map<string, string>()
  const effective = new Map<string, string>() // commandId → binding
  for (const [cmd, binding] of Object.entries(DEFAULT_KEYMAP)) effective.set(cmd, binding)
  for (const [cmd, binding] of Object.entries(overrides)) {
    if (!binding) {
      effective.delete(cmd) // unbound by user
      continue
    }
    effective.set(cmd, binding)
  }
  // Later overrides win over defaults holding the same binding
  const overriddenBindings = new Set(Object.values(overrides))
  for (const [cmd, binding] of effective) {
    const isOverride = overrides[cmd] === binding
    if (!isOverride && overriddenBindings.has(binding)) continue // stolen by an override
    bindingToCommand.set(binding, cmd)
  }
  return bindingToCommand
}

/** Human label for a binding: "Ctrl+Shift+S" → "Ctrl Shift S" chips are built in UI; here keep symbolic form */
export function formatBinding(binding: string): string {
  return binding
    .replace('Left', '←')
    .replace('Right', '→')
    .replace('Up', '↑')
    .replace('Down', '↓')
}

/** Find commands whose effective binding equals `binding` (conflict detection) */
export function findConflicts(
  binding: string,
  selfCommandId: string,
  overrides: Record<string, string>
): string[] {
  const out: string[] = []
  const effective = new Map<string, string>()
  for (const [cmd, b] of Object.entries(DEFAULT_KEYMAP)) effective.set(cmd, b)
  for (const [cmd, b] of Object.entries(overrides)) {
    if (b) effective.set(cmd, b)
    else effective.delete(cmd)
  }
  for (const [cmd, b] of effective) {
    if (cmd !== selfCommandId && b === binding) out.push(cmd)
  }
  return out
}
