import type {
  MovieBoxPlaybackChoice,
  MovieBoxPlaybackCommand,
  MovieBoxPlaybackReply,
  MovieBoxPlaybackSource
} from '@shared/moviebox'
import { create } from 'zustand'
import { platform } from '@/core/platform'
import { makeStreamItem } from '@/core/streams'
import { setExternalPlaybackNavigation, usePlayer } from '@/core/store/player'
import { useSettings } from '@/core/store/settings'
import { useUi } from '@/core/store/ui'
import { adjacentMovieBoxEpisodeId, authorizedMovieBoxUrl, movieBoxCommandEffect } from '@/core/moviebox-logic'

let initialized = false
let activeRevision = 0
let activeItemId: string | null = null
let openedRevision = 0
let failedRevision = 0
let endedRevision = 0
let desiredPlaying = true
let desiredRate = 1
let suppressClose = false

interface MovieBoxPlaybackUiState {
  active: boolean
  isSeries: boolean
  episodes: MovieBoxPlaybackChoice[]
}

export const useMovieBoxPlayback = create<MovieBoxPlaybackUiState>(() => ({
  active: false,
  isSeries: false,
  episodes: []
}))

export function selectMovieBoxEpisode(id: string): void {
  if (!useMovieBoxPlayback.getState().active) return
  platform.movieBox.action('episode', id)
}

function resetMovieBoxUi(): void {
  useMovieBoxPlayback.setState({ active: false, isSeries: false, episodes: [] })
}

function applyCommand(command: MovieBoxPlaybackCommand): void {
  const effect = movieBoxCommandEffect(command)
  if (!effect) return
  const player = usePlayer.getState()
  switch (effect.type) {
    case 'play':
      desiredPlaying = true
      player.play()
      break
    case 'pause':
      desiredPlaying = false
      player.pause()
      break
    case 'close':
      suppressClose = true
      player.close()
      activeRevision = 0
      activeItemId = null
      resetMovieBoxUi()
      break
    case 'seek':
      player.seekTo(effect.value)
      break
    case 'rate':
      desiredRate = effect.value
      player.setRate(effect.value)
      break
  }
}

async function openSource(source: MovieBoxPlaybackSource): Promise<void> {
  const url = authorizedMovieBoxUrl(source.Uri)
  if (!url) {
    platform.movieBox.action('failed')
    useUi.getState().toast({
      kind: 'warn',
      title: 'MovieBox hand-off was blocked',
      desc: 'Lumen only accepts HTTP(S) media from the local authorized playback session.'
    }, 5000)
    return
  }

  const revision = Math.max(0, Math.trunc(source.Revision))
  if (revision === activeRevision && usePlayer.getState().item?.id === activeItemId) return

  // Detection is asynchronous at app startup. Wait for it before choosing an
  // engine so an installed mpv is not briefly mistaken for a missing one.
  await usePlayer.getState().detectMpv()
  if (activeRevision > revision) return
  if (revision === activeRevision && usePlayer.getState().item?.id === activeItemId) return

  activeRevision = revision
  useMovieBoxPlayback.setState((state) => ({
    active: true,
    isSeries: source.BoxType === 2,
    episodes: source.BoxType === 2 ? state.episodes : []
  }))
  desiredPlaying = source.Playing !== false
  desiredRate = Number.isFinite(source.Rate) ? Math.max(0.06, Math.min(16, source.Rate)) : 1
  openedRevision = 0
  failedRevision = 0
  endedRevision = 0
  suppressClose = false

  const item = makeStreamItem(url, source.Title || source.SettingsTitle || 'MovieBox')
  // Keep each playback revision distinct even when a server reuses the URL.
  item.id = `${item.id}#moviebox:${activeRevision}`
  item.positionSec = Math.max(0, Number.isFinite(source.Seconds) ? source.Seconds : 0)
  activeItemId = item.id
  usePlayer.getState().openItem(item, { queue: [], forceMpv: true, startAt: item.positionSec })
}

function handleReply(reply: MovieBoxPlaybackReply): void {
  if (reply.Source) void openSource(reply.Source)
  if (reply.Metadata) {
    useMovieBoxPlayback.setState({
      isSeries: reply.Metadata.IsSeries,
      episodes: reply.Metadata.Episodes ?? []
    })
  }
  for (const command of reply.Commands ?? []) applyCommand(command)
  if (reply.Error) {
    useUi.getState().toast({ kind: 'warn', title: 'MovieBox bridge', desc: reply.Error }, 5000)
  }
  if (reply.Closed && activeItemId) {
    suppressClose = true
    usePlayer.getState().close()
    activeRevision = 0
    activeItemId = null
    resetMovieBoxUi()
  }
}

function reportState(): void {
  if (!activeRevision || !activeItemId) return
  const player = usePlayer.getState()
  if (player.item?.id !== activeItemId) return
  const audio = useSettings.getState().settings.audio
  const ready = player.mpvMode === 'playing'
    ? player.mpvEmbedded && (player.status === 'playing' || player.status === 'paused' || player.status === 'ended')
    : player.status === 'playing' || player.status === 'paused' || player.status === 'ended'
  platform.movieBox.updateState({
    revision: activeRevision,
    position: player.time,
    duration: player.duration,
    playing: player.status === 'playing',
    ready,
    volume: Math.round(audio.volume * 100),
    muted: audio.muted
  })
}

export function initMovieBoxBridge(): void {
  if (initialized || platform.app.platform !== 'win32') return
  initialized = true

  setExternalPlaybackNavigation({
    next: () => {
      const session = useMovieBoxPlayback.getState()
      if (!session.active || !session.isSeries) return false
      const episodeId = adjacentMovieBoxEpisodeId(session.episodes, 'next')
      // Before metadata arrives, preserve MovieBox's native next command.
      // Once the full list is present, selecting the exact episode crosses
      // season boundaries that its in-player Next command does not.
      if (episodeId) platform.movieBox.action('episode', episodeId)
      else if (!session.episodes.length) platform.movieBox.action('next')
      return true
    },
    previous: () => {
      const session = useMovieBoxPlayback.getState()
      if (!session.active || !session.isSeries) return false
      const episodeId = adjacentMovieBoxEpisodeId(session.episodes, 'previous')
      if (episodeId) platform.movieBox.action('episode', episodeId)
      else if (!session.episodes.length) platform.movieBox.action('previous')
      return true
    }
  })

  platform.movieBox.onEvent((event) => {
    if (event.type === 'reply') handleReply(event.reply)
    else if (event.type === 'disconnected' && activeRevision) {
      resetMovieBoxUi()
      useUi.getState().toast({
        kind: 'warn',
        title: 'MovieBox disconnected',
        desc: event.reason || 'Playback can continue, but progress can no longer be synchronized.'
      }, 5000)
    }
  })
  void platform.movieBox.getSession().then((session) => {
    if (session.reply) handleReply(session.reply)
  })

  usePlayer.subscribe((player, previous) => {
    if (!activeRevision || !activeItemId) return
    if (previous.item?.id === activeItemId && player.item?.id !== activeItemId) {
      if (!suppressClose) platform.movieBox.action('close')
      suppressClose = false
      activeRevision = 0
      activeItemId = null
      resetMovieBoxUi()
      return
    }
    if (player.item?.id !== activeItemId) return

    const ready = (player.status === 'playing' || player.status === 'paused') &&
      (player.mpvMode !== 'playing' || player.mpvEmbedded)
    if (ready && openedRevision !== activeRevision) {
      openedRevision = activeRevision
      player.setRate(desiredRate)
      if (!desiredPlaying && player.status === 'playing') player.pause()
      platform.movieBox.action('opened')
    }
    if (player.status === 'error' && failedRevision !== activeRevision) {
      failedRevision = activeRevision
      platform.movieBox.action('failed')
    }
    if (player.status === 'ended' && endedRevision !== activeRevision) {
      endedRevision = activeRevision
      platform.movieBox.action('ended')
    }
    reportState()
  })
  window.setInterval(reportState, 250)
}
