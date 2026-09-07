// Mesh VPN support: what makes "different parts of the world" actually work.
//
// Two home connections cannot dial each other — that is NAT, and no amount of
// clever syncing gets around it. A mesh VPN gives both machines a stable
// address that works from anywhere with nothing configured on either router.
//
// Lumen does not redistribute one. It detects what is installed, offers a
// one-click install from the official source via winget (the same pattern as
// mpv and yt-dlp), and helps join a network. Nothing installs without the user
// asking for it, and every step is visible.

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { join } from 'node:path'
import {
  MESH_PROVIDERS,
  ZEROTIER_NETWORK_RE,
  classifyAddress,
  rankAddresses,
  type MeshProvider,
  type MeshStatus,
  type NetAddress
} from '@shared/together/mesh'
import { hasWinget, wingetInstall } from '../winget'

/**
 * Every usable IPv4 on this machine, ranked by how far it reaches. Loopback
 * and link-local are dropped: offering a friend a 169.254 address that cannot
 * possibly work is worse than offering nothing.
 */
export function scanAddresses(): NetAddress[] {
  const found: NetAddress[] = []
  for (const [adapter, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue
      if (a.address.startsWith('169.254.')) continue
      const { reach, provider } = classifyAddress(adapter, a.address)
      found.push({ address: a.address, adapter, reach, provider })
    }
  }
  return rankAddresses(found)
}

/** Where each provider puts itself, so we can spot an install that is not yet connected. */
const INSTALL_PATHS: Partial<Record<MeshProvider, string[]>> = {
  zerotier: [
    join(process.env.ProgramFiles ?? 'C:\\Program Files', 'ZeroTier', 'One', 'zerotier-cli.bat'),
    join(process.env.ProgramData ?? 'C:\\ProgramData', 'ZeroTier', 'One', 'zerotier-cli.bat')
  ],
  tailscale: [
    join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Tailscale', 'tailscale.exe'),
    join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Tailscale IPN', 'tailscale.exe')
  ]
}

function installedProviders(addresses: NetAddress[]): MeshProvider[] {
  const seen = new Set<MeshProvider>()
  // A live adapter is the strongest evidence — it is installed *and* running.
  for (const a of addresses) if (a.provider) seen.add(a.provider)
  // Otherwise fall back to the binary, so we can say "installed, not connected"
  // rather than repeatedly offering to install something already present.
  for (const [provider, paths] of Object.entries(INSTALL_PATHS)) {
    if (paths?.some((p) => existsSync(p))) seen.add(provider as MeshProvider)
  }
  return [...seen]
}

export function meshStatus(): MeshStatus {
  const all = scanAddresses()
  const addresses = all.filter((a) => a.reach === 'mesh')
  return {
    addresses,
    installed: installedProviders(all),
    ready: addresses.length > 0
  }
}

export function installMesh(
  provider: 'zerotier' | 'tailscale',
  onProgress: (line: string) => void
): Promise<{ ok: boolean; reason?: string }> {
  return wingetInstall(MESH_PROVIDERS[provider].wingetId, onProgress)
}

export { hasWinget }

/** Path to zerotier-cli.bat, or null when ZeroTier is not installed. */
function zerotierCli(): string | null {
  return INSTALL_PATHS.zerotier?.find((p) => existsSync(p)) ?? null
}

export type JoinResult = { ok: true } | { ok: false; reason: 'not-installed' | 'bad-network' | 'failed' }

/**
 * Join a ZeroTier network.
 *
 * ZeroTier's control socket is admin-only on Windows, so this needs elevation
 * and the user will see a UAC prompt. The network id is validated against a
 * strict 16-hex pattern first and passed as a single quoted argument — it
 * reaches an elevated shell, so nothing else is acceptable.
 */
export function joinZeroTier(networkId: string): Promise<JoinResult> {
  const id = networkId.trim().toLowerCase()
  if (!ZEROTIER_NETWORK_RE.test(id)) return Promise.resolve({ ok: false, reason: 'bad-network' })

  const cli = zerotierCli()
  if (!cli) return Promise.resolve({ ok: false, reason: 'not-installed' })

  return new Promise((resolve) => {
    let proc
    try {
      proc = spawn(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          // Start-Process -Verb RunAs raises the UAC prompt. -Wait so the exit
          // code below reflects the join rather than the launcher.
          `$p = Start-Process -FilePath '${cli}' -ArgumentList 'join','${id}' -Verb RunAs -WindowStyle Hidden -Wait -PassThru; exit $p.ExitCode`
        ],
        { windowsHide: true }
      )
    } catch {
      resolve({ ok: false, reason: 'failed' })
      return
    }
    proc.on('error', () => resolve({ ok: false, reason: 'failed' }))
    proc.on('exit', (code) => resolve(code === 0 ? { ok: true } : { ok: false, reason: 'failed' }))
  })
}
