// The lightweight "doorbell" protocol used to ring another Lumen player.
// It deliberately carries no chat history, contacts, or account data: both
// players keep one outbound socket to the same relay and the relay forwards a
// short-lived Together room invitation.

export const WATCH_INVITE_PROTOCOL = 1
export const WATCH_INVITE_TTL_MS = 60_000

export type WatchInviteMode = 'library' | 'stream'

export interface WatchInvite {
  id: string
  fromId: string
  fromName: string
  invite: string
  roomId: string
  title: string
  mode: WatchInviteMode
  expiresAt: number
}

export type InviteDeliveryState = 'ringing' | 'accepted' | 'declined' | 'missed' | 'offline'

export type InviteClientMessage =
  | { t: 'invite:register'; protocol: number; memberId: string; name: string }
  | {
      t: 'invite:send'
      toId: string
      invite: string
      roomId: string
      title: string
      mode: WatchInviteMode
    }
  | { t: 'invite:respond'; inviteId: string; accept: boolean }
  | { t: 'invite:heartbeat' }

export type InviteServerMessage =
  | { t: 'invite:ready'; lumenId: string }
  | { t: 'invite:incoming'; invite: WatchInvite }
  | { t: 'invite:delivery'; inviteId?: string; toId: string; state: InviteDeliveryState }
  | { t: 'invite:error'; message: string }
  | { t: 'invite:pong' }

export type InviteStatus = 'disabled' | 'connecting' | 'online' | 'reconnecting' | 'error'

export type InviteEvent =
  | { type: 'status'; status: InviteStatus; message?: string; lumenId?: string }
  | { type: 'incoming'; invite: WatchInvite }
  | { type: 'delivery'; inviteId?: string; toId: string; state: InviteDeliveryState }
  | { type: 'error'; message: string }

/**
 * A member id is intentionally opaque inside the sync engine. Turn it into a
 * short, readable address without changing existing installations' identity.
 */
export function lumenIdFromMemberId(memberId: string): string {
  const body = memberId
    .replace(/^m-/i, '')
    .replace(/[^a-z0-9]/gi, '')
    .toUpperCase()
    .slice(0, 20)
  const groups = body.match(/.{1,4}/g)?.join('-') ?? ''
  return groups ? `LMN-${groups}` : ''
}

/** Case/spacing tolerant lookup key for IDs people type or read aloud. */
export function normalizeLumenId(value: string): string {
  return value.toUpperCase().replace(/^LMN[\s-]*/i, '').replace(/[^A-Z0-9]/g, '')
}

export function isLumenId(value: string): boolean {
  return /^[A-Z0-9]{10,20}$/.test(normalizeLumenId(value))
}
