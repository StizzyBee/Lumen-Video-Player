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

/** Format the short, relay-assigned number shown to another Lumen player. */
export function lumenIdFromNumber(number: number): string {
  return Number.isSafeInteger(number) && number > 0 ? `LMN-${number}` : ''
}

/** Case/spacing tolerant lookup key for IDs people type or read aloud. */
export function normalizeLumenId(value: string): string {
  const match = /^(?:(?:LUMEN|LMN)\s*)?[#-]?\s*(\d{1,12})\s*$/i.exec(value.trim())
  return match?.[1] ?? ''
}

export function isLumenId(value: string): boolean {
  const normalized = normalizeLumenId(value)
  if (!/^\d{1,12}$/.test(normalized)) return false
  const number = Number(normalized)
  return Number.isSafeInteger(number) && number > 0
}
