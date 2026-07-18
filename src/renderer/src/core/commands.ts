// Central command registry. Every user-facing action is a command so the
// palette, menus, and shortcuts share one source of truth — and so future
// plugins can contribute commands like first-class citizens.

export interface Command {
  id: string
  title: string
  category: string
  keywords?: string[]
  /** Enablement — a disabled command is skipped by shortcuts and the palette */
  when?: () => boolean
  /** Never shown in the palette (alias bindings, internal actions) */
  hidden?: boolean
  run: () => void
}

const commands = new Map<string, Command>()

export function registerCommands(list: Command[]): void {
  for (const c of list) commands.set(c.id, c)
}

export function getCommand(id: string): Command | undefined {
  return commands.get(id)
}

export function allCommands(): Command[] {
  return [...commands.values()]
}

export function executeCommand(id: string): boolean {
  const c = commands.get(id)
  if (!c) return false
  if (c.when && !c.when()) return false
  c.run()
  return true
}
