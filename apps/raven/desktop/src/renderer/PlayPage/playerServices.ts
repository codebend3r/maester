import type { PlayerAction, PlayerServices } from '@raven/ui'
import { listOf, object } from '@raven/core'
import type { DesktopClient } from '@/renderer/desktop/client'
import type { MenuHub } from '@/renderer/desktop/menuHub'
import {
  type DesktopRequest,
  isOpaqueId,
  type LocalFile,
  MENU_PLAYER_ACTIONS,
  type MenuPlayerAction,
} from '@/shared/protocol'

/** What the Shell leaves in `location.state` when it opens a video. */
export const isPlayState = object({ queue: listOf(isOpaqueId) })

/** Which engine plays, and for the html one, why: the native one never started, or it stopped. */
export const ENGINE_USES = { native: 'native', fallback: 'fallback', stopped: 'stopped' } as const

export type EngineUse = (typeof ENGINE_USES)[keyof typeof ENGINE_USES]

export const ENGINE_NOTES = {
  native: 'raven player could not play this video.',
  fallback: "raven player's video engine did not start, and this video needs it.",
  stopped: "raven player's video engine stopped, and this video needs it.",
} as const satisfies Record<EngineUse, string>

export const ENGINE_MOVED =
  "raven player's video engine stopped, so this video moved to the built-in player."

/** What the Playback menu's Video Info says when the built-in player, which has no overlay, plays. */
export const STATS_UNAVAILABLE = 'Video info is not available in the built-in player.'

export const OUTPUT_KEY = ['desktop', 'output'] as const

/** The Playback menu's actions as the player's own; Next is the page's, not the player's. */
export const playerActionFor = (action: MenuPlayerAction): PlayerAction | null => {
  switch (action) {
    case MENU_PLAYER_ACTIONS.togglePlay:
      return { type: 'togglePlay' }
    case MENU_PLAYER_ACTIONS.skipBack:
      return { type: 'seekBy', seconds: -10 }
    case MENU_PLAYER_ACTIONS.skipForward:
      return { type: 'seekBy', seconds: 10 }
    case MENU_PLAYER_ACTIONS.showShortcuts:
      return { type: 'showShortcuts' }
    case MENU_PLAYER_ACTIONS.stats:
      return { type: 'toggleStats' }
    case MENU_PLAYER_ACTIONS.next:
      return null
    default: {
      const unreachable: never = action
      return unreachable
    }
  }
}

/** Main answers every request; one that fails to arrive is only worth a warning. */
export const requestQuietly = ({
  client,
  request,
}: {
  client: DesktopClient
  request: DesktopRequest
}) => {
  client.request(request).catch((error: unknown) => {
    console.warn(`raven player could not send ${request.type}.`, error)
  })
}

export const servicesFor = ({
  file,
  client,
  menu,
  engine,
}: {
  file: LocalFile
  client: DesktopClient
  menu: MenuHub
  engine: EngineUse
}): PlayerServices => {
  // Main stores a share watched, which needs the length only the engine learns.
  let length: number | null = null
  let hasStarted = false
  const savePosition = (position: number) =>
    requestQuietly({
      client,
      request: { type: 'savePosition', fileId: file.fileId, position, duration: length },
    })
  return {
    title: {
      label: file.label,
      // Only a download's folder says where it came from; any other file's is just its folder.
      context: file.isDownload ? file.folder : null,
      duration: null,
      resumeAt: file.resumeAt,
      backTo: '/',
      next:
        file.next === null
          ? null
          : {
              to: `/play/${file.next.fileId}`,
              state: { queue: file.next.queue },
              label: file.next.label,
            },
    },
    progress: {
      // A local file has no watch history to open, so this only marks that playback began.
      started: () => {
        hasStarted = true
      },
      save: savePosition,
      // The player reports a leave even before playback began, and main counts a download's
      // first position after an open as a play, so a file left while it loads says nothing.
      left: (position) => {
        if (hasStarted) savePosition(position)
      },
      duration: (seconds) => {
        length = seconds
      },
    },
    posterUrl: null,
    escape: null,
    hostActions: {
      subscribe: (listener) =>
        menu.subscribe((action) => {
          const mapped = playerActionFor(action)
          if (mapped !== null) listener(mapped)
        }),
    },
    trackPicks: {
      start: file.tracks,
      save: ({ audio, subtitle }) =>
        requestQuietly({
          client,
          request: { type: 'saveTracks', fileId: file.fileId, audio, subtitle },
        }),
    },
    chrome: {
      shown: (isShown) =>
        requestQuietly({ client, request: { type: 'windowButtons', isVisible: isShown } }),
    },
    unplayableNote: ENGINE_NOTES[engine],
  }
}
