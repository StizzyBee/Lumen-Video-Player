// Reachability: working out which of this machine's addresses a friend on the
// other side of the world could actually connect to.
//
// The hard part of a watch party is not sync, it is NAT. Two home connections
// cannot dial each other directly, and telling people to forward a port is
// where most of them give up. A mesh VPN (ZeroTier, Tailscale) solves it
// properly: it gives both machines a stable private address that works from
// anywhere, with no router configuration at all.
//
// So Lumen classifies every local address by how far it reaches, and offers
// the one that will actually work — rather than handing out a 192.168 address
// that only ever works from the next room.

export type MeshProvider = 'zerotier' | 'tailscale' | 'hamachi' | 'radmin' | 'wireguard'

/** How far an address reaches, best first. */
export type Reach =
  /** A mesh VPN address: reachable anywhere, no port forwarding. */
  | 'mesh'
  /** A public address: reachable, but only if the firewall allows it. */
  | 'public'
  /** A private address: same network only. */
  | 'lan'

export interface NetAddress {
  address: string
  /** OS adapter name, e.g. "ZeroTier One [8056c2e21c000001]". */
  adapter: string
  reach: Reach
  provider: MeshProvider | null
}

const PROVIDER_PATTERNS: Array<{ re: RegExp; provider: MeshProvider }> = [
  { re: /zerotier/i, provider: 'zerotier' },
  { re: /tailscale/i, provider: 'tailscale' },
  { re: /hamachi/i, provider: 'hamachi' },
  { re: /radmin/i, provider: 'radmin' },
  { re: /wireguard|wg\d/i, provider: 'wireguard' }
]

function octets(ip: string): number[] {
  return ip.split('.').map((n) => Number(n))
}

function isPrivate(ip: string): boolean {
  const [a, b] = octets(ip)
  if (a === 10) return true
  if (a === 192 && b === 168) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  return false
}

/**
 * Tailscale hands out addresses from the carrier-grade NAT range 100.64/10.
 * Recognising the range as well as the adapter name matters because Windows
 * adapter names are not guaranteed — a renamed adapter would otherwise be
 * misread as an ordinary LAN address and offered to a remote friend who
 * cannot reach it.
 */
function isTailscaleRange(ip: string): boolean {
  const [a, b] = octets(ip)
  return a === 100 && b >= 64 && b <= 127
}

/** Hamachi's fixed allocation. */
function isHamachiRange(ip: string): boolean {
  return octets(ip)[0] === 25
}

export function classifyAddress(adapter: string, address: string): { reach: Reach; provider: MeshProvider | null } {
  for (const { re, provider } of PROVIDER_PATTERNS) {
    if (re.test(adapter)) return { reach: 'mesh', provider }
  }
  if (isTailscaleRange(address)) return { reach: 'mesh', provider: 'tailscale' }
  if (isHamachiRange(address)) return { reach: 'mesh', provider: 'hamachi' }
  if (isPrivate(address)) return { reach: 'lan', provider: null }
  return { reach: 'public', provider: null }
}

const REACH_RANK: Record<Reach, number> = { mesh: 0, public: 1, lan: 2 }

/**
 * Order addresses by how likely they are to work for the person being invited.
 * Mesh first: it is the only option that needs nothing configured on either
 * router, which is exactly the "watching from different parts of the world"
 * case this feature exists for.
 */
export function rankAddresses(addresses: NetAddress[]): NetAddress[] {
  return [...addresses].sort((a, b) => REACH_RANK[a.reach] - REACH_RANK[b.reach])
}

export interface MeshStatus {
  /** Mesh addresses currently active on this machine. */
  addresses: NetAddress[]
  /** Providers we can see installed, whether or not they are connected. */
  installed: MeshProvider[]
  /** True when at least one mesh address is live — invites will work anywhere. */
  ready: boolean
}

export const MESH_PROVIDERS: Record<
  Exclude<MeshProvider, 'hamachi' | 'radmin' | 'wireguard'>,
  { label: string; wingetId: string; setupUrl: string; blurb: string }
> = {
  zerotier: {
    label: 'ZeroTier',
    wingetId: 'ZeroTier.ZeroTierOne',
    setupUrl: 'https://my.zerotier.com/',
    blurb:
      'Free for up to 25 devices. Create a network, join it on both machines, and your watch party works from anywhere.'
  },
  tailscale: {
    label: 'Tailscale',
    wingetId: 'Tailscale.Tailscale',
    setupUrl: 'https://login.tailscale.com/start',
    blurb: 'Free for personal use. Sign in on both machines with the same account and they can reach each other.'
  }
}

/** ZeroTier network IDs are exactly 16 hex digits. */
export const ZEROTIER_NETWORK_RE = /^[0-9a-f]{16}$/i

// ── Invites ─────────────────────────────────────────────────────────────────

export interface Invite {
  url: string
  roomId: string
}

/**
 * One string carrying everything a friend needs. Reading an IP address and a
 * room code aloud over a call is where invites go wrong; a single token they
 * can paste removes the whole class of mistake.
 */
export function formatInvite(host: string, port: number, roomId: string): string {
  return `${host}:${port}#${roomId}`
}

/**
 * Accept an invite in any shape somebody might realistically paste: the token
 * we generate, a bare host with the code alongside, a full ws:// URL, or the
 * same separated by a space or a slash instead of a hash.
 */
export function parseInvite(raw: string, defaultPort = 7345): Invite | null {
  const text = raw.trim()
  if (!text) return null

  // Split the room code off the end. Accept #, /, whitespace, or a comma.
  const match = text.match(/^(.*?)[\s#/,]+([A-Za-z0-9]{6})\s*$/)
  if (!match) return null

  const [, hostPart, code] = match
  const roomId = code.toUpperCase()
  const url = normalizeHost(hostPart, defaultPort)
  return url ? { url, roomId } : null
}

/**
 * A hostname or IPv4, optionally with a port. Deliberately strict: without it,
 * `parseInvite` happily reads "not an invite" as the host "not an" plus the
 * code "INVITE" and produces a confident-looking invite that can only fail
 * later, with a connection error instead of "that is not an invite".
 */
const HOST_RE = /^[A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?$/

/** Turn whatever the user typed into a ws:// URL, or null if unusable. */
export function normalizeHost(raw: string, defaultPort = 7345): string | null {
  let text = raw.trim().replace(/^lumen:\/\/(join\/?)?/i, '')
  if (!text) return null

  let scheme = 'ws://'
  const schemeMatch = text.match(/^(wss?|https?):\/\//i)
  if (schemeMatch) {
    // https implies a TLS-terminating proxy in front of the relay.
    scheme = /^(wss|https)/i.test(schemeMatch[1]) ? 'wss://' : 'ws://'
    text = text.slice(schemeMatch[0].length)
  }
  // Drop any trailing path — the room code is carried separately.
  text = text.split(/[/?]/)[0]
  if (!text) return null

  // Split off an explicit port so the host can be validated on its own.
  const portMatch = text.match(/^(.*):(\d{1,5})$/)
  const host = portMatch ? portMatch[1] : text
  const port = portMatch ? Number(portMatch[2]) : null
  if (!HOST_RE.test(host)) return null
  if (port !== null && (port < 1 || port > 65535)) return null

  // A secure relay normally sits behind 443, so do not staple our port onto it.
  if (port === null && scheme === 'ws://') return `${scheme}${host}:${defaultPort}`
  return `${scheme}${text}`
}
