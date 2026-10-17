import {
  type ApiClient,
  type Infer,
  isMediaId,
  isNumber,
  listOf,
  type MediaItem,
  mediaLabel,
  object,
} from '@raven/core'
import type { PlayerServices } from '@raven/ui'
import type { DesktopClient } from '@/renderer/desktop/client'
import type { MenuHub } from '@/renderer/desktop/menuHub'
import { playerActionFor, requestQuietly } from '@/renderer/PlayPage/playerServices'
import { type DesktopReply, SERVER_GONE, type ServerView } from '@/shared/protocol'

/** What the Shell leaves in `location.state` when it opens a server title. */
export const isServerPlayState = object({ at: isNumber, next: listOf(isMediaId) })

export type ServerPlayState = Infer<typeof isServerPlayState>

/** The web's rule: resume past 0 and more than 10 s before a known end, else start over. */
const RESUME_MARGIN_S = 10

export const resumeAtFor = ({ at, media }: { at: number; media: MediaItem }): number => {
  const from = at > 0 ? at : media.position
  if (from <= 0) return 0
  if (media.duration !== null && from >= media.duration - RESUME_MARGIN_S) return 0
  return from
}

export const SERVER_COPY = {
  pinHint: (name: string) =>
    `Enter the PIN to open ${name}'s locked libraries in raven player. raven player asks again after it restarts.`,
  adminHint: (name: string) =>
    `${name} hides its locked libraries while its admin lock is on. Enter the admin password to see them in raven player.`,
  gone: (name: string) => `This title is not on ${name} any more.`,
  unknownServer: SERVER_GONE,
  inBrowser: (name: string) =>
    `raven player's video engine did not start, so this title opened from ${name} in your browser.`,
  engineStopped:
    "raven player's video engine stopped. Open this title in your browser to keep watching.",
  unplayable: (name: string) => `raven player could not play this title from ${name}.`,
} as const

/** The share of a title watched, for the recents; unknown without a length. */
export const shareOf = ({
  position,
  length,
}: {
  position: number
  length: number | null
}): number | null => (length === null || length <= 0 ? null : position / length)

/** Asks main to open the title's watch page; main says no for a server it does not keep. */
export const openInBrowser = ({
  client,
  serverId,
  mediaId,
}: {
  client: DesktopClient
  serverId: string
  mediaId: number
}): Promise<DesktopReply> => client.request({ type: 'openInBrowser', serverId, mediaId })

/** Main's reason for not opening the browser, or null when it did. */
export const browserRefusalOf = (reply: DesktopReply): string | null =>
  reply.type === 'refused' ? reply.message : null

/** A server call whose failure costs only a warning: the history or a saved spot. */
const callQuietly = ({ call, what }: { call: Promise<unknown>; what: string }) => {
  call.catch((error: unknown) => {
    console.warn(`raven player could not ${what}.`, error)
  })
}

export const serverServicesFor = ({
  media,
  server,
  api,
  client,
  menu,
  at,
  next,
  lastSaved,
  length,
  hasRecordedPlay,
  escape,
  onEngineError,
}: {
  media: MediaItem
  server: ServerView
  api: ApiClient
  client: DesktopClient
  menu: MenuHub
  at: number
  next: { mediaId: number; label: string; rest: number[] } | null
  /** The page's ref: `progress.save` writes each saved position here, for the relock path. */
  lastSaved: { current: number }
  /** The length the engine learned, which the recents share prefers to the server's; a ref, so a rebuild keeps it. */
  length: { current: number | null }
  /** The page's ref, so a player remounted by a relock records no second play. */
  hasRecordedPlay: { current: boolean }
  /** Unplayable's way out, or null when there is none, as for a server raven player no longer has. */
  escape: { run: () => void; feedback: string | null } | null
  onEngineError: PlayerServices['onEngineError']
}): PlayerServices => {
  const { serverId } = server
  const label = mediaLabel(media)
  return {
    title: {
      label,
      duration: media.duration,
      resumeAt: resumeAtFor({ at, media }),
      backTo: '/',
      next:
        next === null
          ? null
          : {
              to: `/server/${serverId}/${next.mediaId}`,
              state: { at: 0, next: next.rest } satisfies ServerPlayState,
              label: next.label,
            },
    },
    progress: {
      started: () => {
        if (hasRecordedPlay.current) return
        hasRecordedPlay.current = true
        callQuietly({ call: api.recordPlay(media.id), what: 'record the play' })
      },
      save: (position) => {
        lastSaved.current = position
        callQuietly({
          call: api.saveProgress({ id: media.id, position }),
          what: 'save the position',
        })
      },
      left: (position) =>
        requestQuietly({
          client,
          request: {
            type: 'noteServerTitle',
            serverId,
            mediaId: media.id,
            label,
            watched: shareOf({ position, length: length.current ?? media.duration }),
          },
        }),
      duration: (seconds) => {
        length.current = seconds
      },
    },
    // Fetching a poster from the server is the network the page does not have.
    posterUrl: null,
    escape: escape === null ? null : { label: 'Open in browser', icon: 'globe', run: escape.run },
    escapeHint: null,
    escapeFeedback: escape?.feedback ?? null,
    hostActions: {
      subscribe: (listener) =>
        menu.subscribe((action) => {
          const mapped = playerActionFor(action)
          if (mapped !== null) listener(mapped)
        }),
    },
    chrome: {
      shown: (isShown) =>
        requestQuietly({ client, request: { type: 'windowButtons', isVisible: isShown } }),
    },
    unplayableNote: SERVER_COPY.unplayable(server.name),
    onEngineError,
  }
}
