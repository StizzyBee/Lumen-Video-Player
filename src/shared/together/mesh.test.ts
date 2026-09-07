import { describe, expect, it } from 'vitest'
import {
  classifyAddress,
  formatInvite,
  normalizeHost,
  parseInvite,
  rankAddresses,
  ZEROTIER_NETWORK_RE,
  type NetAddress
} from './mesh'

describe('address classification', () => {
  it('recognises ZeroTier by adapter name', () => {
    // ZeroTier networks hand out whatever range the admin picked — very often
    // 10.x, which is indistinguishable from a LAN by address alone. The
    // adapter name is the only reliable signal.
    expect(classifyAddress('ZeroTier One [8056c2e21c000001]', '10.147.17.42')).toEqual({
      reach: 'mesh',
      provider: 'zerotier'
    })
  })

  it('recognises Tailscale by its address range even if the adapter is renamed', () => {
    expect(classifyAddress('Ethernet 3', '100.101.102.103')).toEqual({
      reach: 'mesh',
      provider: 'tailscale'
    })
  })

  it('treats an ordinary private address as LAN-only', () => {
    expect(classifyAddress('Wi-Fi', '192.168.1.20').reach).toBe('lan')
    expect(classifyAddress('Ethernet', '10.0.0.5').reach).toBe('lan')
    expect(classifyAddress('Ethernet', '172.20.1.1').reach).toBe('lan')
  })

  it('does not mistake 172.32 for a private range', () => {
    // The private block stops at 172.31 — an off-by-one here would tell a
    // watcher their public address is LAN-only.
    expect(classifyAddress('Ethernet', '172.32.0.1').reach).toBe('public')
    expect(classifyAddress('Ethernet', '172.15.0.1').reach).toBe('public')
  })

  it('does not mistake 100.128 for Tailscale', () => {
    // 100.64/10 ends at 100.127. Beyond it is ordinary public space.
    expect(classifyAddress('Ethernet', '100.128.0.1').reach).toBe('public')
    expect(classifyAddress('Ethernet', '100.63.0.1').reach).toBe('public')
  })

  it('offers the address most likely to work first', () => {
    const found: NetAddress[] = [
      { address: '192.168.1.20', adapter: 'Wi-Fi', reach: 'lan', provider: null },
      { address: '10.147.17.42', adapter: 'ZeroTier One', reach: 'mesh', provider: 'zerotier' },
      { address: '203.0.113.9', adapter: 'Ethernet', reach: 'public', provider: null }
    ]
    // Mesh first: it is the only one that needs nothing configured on either
    // router, which is the whole point for a friend on another continent.
    expect(rankAddresses(found).map((a) => a.reach)).toEqual(['mesh', 'public', 'lan'])
  })
})

describe('invites', () => {
  it('round-trips what we generate', () => {
    const token = formatInvite('100.101.102.103', 7345, 'ABC234')
    expect(token).toBe('100.101.102.103:7345#ABC234')
    expect(parseInvite(token)).toEqual({ url: 'ws://100.101.102.103:7345', roomId: 'ABC234' })
  })

  it('accepts the shapes people actually paste', () => {
    const expected = { url: 'ws://192.168.1.20:7345', roomId: 'ABC234' }
    expect(parseInvite('192.168.1.20:7345#ABC234')).toEqual(expected)
    expect(parseInvite('192.168.1.20#ABC234')).toEqual(expected)
    expect(parseInvite('192.168.1.20 ABC234')).toEqual(expected)
    expect(parseInvite('192.168.1.20/ABC234')).toEqual(expected)
    expect(parseInvite('ws://192.168.1.20:7345#ABC234')).toEqual(expected)
    expect(parseInvite('  192.168.1.20:7345 # abc234  '.replace(/ # /, '#'))).toEqual(expected)
  })

  it('lower-cases nothing and upper-cases the code', () => {
    expect(parseInvite('relay.example.com:7345#abc234')?.roomId).toBe('ABC234')
  })

  it('keeps a secure relay on its own port', () => {
    // wss:// almost always means a TLS proxy on 443; stapling 7345 onto it
    // would send the watcher somewhere nothing is listening.
    expect(parseInvite('wss://relay.example.com#ABC234')).toEqual({
      url: 'wss://relay.example.com',
      roomId: 'ABC234'
    })
    expect(parseInvite('https://relay.example.com#ABC234')?.url).toBe('wss://relay.example.com')
  })

  it('rejects text that is not an invite', () => {
    expect(parseInvite('')).toBeNull()
    expect(parseInvite('hello there')).toBeNull()
    expect(parseInvite('ABC234')).toBeNull()
    expect(parseInvite('192.168.1.20')).toBeNull()
  })

  it('does not read ordinary prose as an address plus a code', () => {
    // Any six-letter word at the end looks like a room code, so without a real
    // host check these produce a confident-looking invite that can only fail
    // later — with a connection error rather than "that is not an invite".
    expect(parseInvite('not an invite')).toBeNull()
    expect(parseInvite('send me the invite please')).toBeNull()
    expect(parseInvite('paste your friends code here')).toBeNull()
  })

  it('rejects an impossible port', () => {
    expect(parseInvite('192.168.1.20:99999#ABC234')).toBeNull()
    expect(parseInvite('192.168.1.20:0#ABC234')).toBeNull()
  })

  it('still accepts a bare hostname on a home network', () => {
    // Plenty of people share `desktop-pc` rather than an IP.
    expect(parseInvite('living-room-pc#ABC234')?.url).toBe('ws://living-room-pc:7345')
    expect(normalizeHost('localhost')).toBe('ws://localhost:7345')
  })

  it('normalizes a bare host for the manual join field', () => {
    expect(normalizeHost('192.168.1.20')).toBe('ws://192.168.1.20:7345')
    expect(normalizeHost('192.168.1.20:9000')).toBe('ws://192.168.1.20:9000')
    expect(normalizeHost('wss://relay.example.com')).toBe('wss://relay.example.com')
    expect(normalizeHost('')).toBeNull()
  })
})

describe('zerotier network ids', () => {
  it('accepts a real id and rejects anything else', () => {
    // Validated strictly because this value is passed to an elevated command.
    expect(ZEROTIER_NETWORK_RE.test('8056c2e21c000001')).toBe(true)
    expect(ZEROTIER_NETWORK_RE.test('8056C2E21C000001')).toBe(true)
    expect(ZEROTIER_NETWORK_RE.test('8056c2e21c00000')).toBe(false)
    expect(ZEROTIER_NETWORK_RE.test('8056c2e21c000001 && calc')).toBe(false)
    expect(ZEROTIER_NETWORK_RE.test('zzzzzzzzzzzzzzzz')).toBe(false)
  })
})
