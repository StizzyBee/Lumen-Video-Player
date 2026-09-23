export interface MovieBoxPlaybackState {
  revision: number
  position: number
  duration: number
  playing: boolean
  ready: boolean
  volume: number
  muted: boolean
}

export interface MovieBoxPlaybackSource {
  Revision: number
  Uri: string
  Title: string
  Engine: string
  Seconds: number
  Playing: boolean
  Rate: number
  SettingsTitle: string
  Season: number
  Episode: number
  BoxType: number
}

export interface MovieBoxPlaybackChoice {
  Id: string
  Label: string
  Group: string
  Selected: boolean
}

export interface MovieBoxPlaybackMetadata {
  IsSeries: boolean
  Loading: boolean
  Error?: string | null
  Episodes: MovieBoxPlaybackChoice[]
  Qualities: MovieBoxPlaybackChoice[]
  Subtitles: MovieBoxPlaybackChoice[]
  Servers: MovieBoxPlaybackChoice[]
}

export interface MovieBoxPlaybackCommand {
  Action: string
  Values: Record<string, unknown>
}

export interface MovieBoxSubtitleCue {
  Start: number
  End: number
  Text: string
}

export interface MovieBoxPlaybackReply {
  Error?: string | null
  Source?: MovieBoxPlaybackSource | null
  Metadata?: MovieBoxPlaybackMetadata | null
  Commands?: MovieBoxPlaybackCommand[]
  Cues?: MovieBoxSubtitleCue[] | null
  SubtitleDelay?: number
  Closed?: boolean
}

export type MovieBoxBridgeEvent =
  | { type: 'connected' }
  | { type: 'disconnected'; reason?: string }
  | { type: 'reply'; reply: MovieBoxPlaybackReply }

export interface MovieBoxBridgeSession {
  connected: boolean
  reply: MovieBoxPlaybackReply | null
  error: string | null
}

export const EMPTY_MOVIEBOX_STATE: MovieBoxPlaybackState = {
  revision: 0,
  position: 0,
  duration: 0,
  playing: false,
  ready: false,
  volume: 100,
  muted: false
}
