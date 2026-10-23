import {
  DESKTOP_PATHS,
  DESKTOP_REQUESTS,
  isOpaqueId,
  listOf,
  type LocalFile,
  MENU_PLAYER_ACTIONS,
  type MenuPlayerAction,
  object,
  PLAYER_ACTIONS,
  type PlayerAction,
} from '@raven/core'
import type { PlayerServices, ProgressSink } from '@raven/ui/headless'
import type { DesktopClient } from '@/desktop/client'
import { handled } from '@/desktop/handled'
import type { MenuHub } from '@/desktop/menuHub'
import { playPathOf } from '@/desktop/paths'

/** What the page leaves in `location.state` when it opens a file: the files to play after it. */
export const isPlayState = object({ queue: listOf(isOpaqueId) })

/** Which engine plays a file, and for the html one, why: the native one never started, or it stopped. */
export const ENGINE_USES = { native: 'native', fallback: 'fallback', stopped: 'stopped' } as const

export type EngineUse = (typeof ENGINE_USES)[keyof typeof ENGINE_USES]

export const ENGINE_NOTES = {
  native: 'Raven could not play this video.',
  fallback: "Raven's video engine did not start, and this video needs it.",
  stopped: "Raven's video engine stopped, and this video needs it.",
} as const satisfies Record<EngineUse, string>

export const ENGINE_MOVED =
  "Raven's video engine stopped, so this video moved to the built-in player."

/** What the Playback menu's Video Info says when the built-in player, which has no overlay, plays. */
export const STATS_UNAVAILABLE = 'Video info is not available in the built-in player.'

/** The Playback menu's actions as the player's own; Next is the page's, not the player's. */
export const playerActionFor = (action: MenuPlayerAction): PlayerAction | null => {
  switch (action) {
    case MENU_PLAYER_ACTIONS.togglePlay:
      return { type: PLAYER_ACTIONS.togglePlay }
    case MENU_PLAYER_ACTIONS.skipBack:
      return { type: PLAYER_ACTIONS.skip, direction: -1 }
    case MENU_PLAYER_ACTIONS.skipForward:
      return { type: PLAYER_ACTIONS.skip, direction: 1 }
    case MENU_PLAYER_ACTIONS.showShortcuts:
      return { type: PLAYER_ACTIONS.showShortcuts }
    case MENU_PLAYER_ACTIONS.stats:
      return { type: PLAYER_ACTIONS.toggleStats }
    case MENU_PLAYER_ACTIONS.next:
      return null
    default: {
      const unreachable: never = action
      return unreachable
    }
  }
}

/**
 * What Raven adds to any player's services: the Playback menu's actions, and the window's
 * traffic lights, which show and hide with the controls.
 */
export const windowPartsFor = ({
  client,
  menu,
}: {
  client: DesktopClient
  menu: MenuHub
}): Required<Pick<PlayerServices, 'hostActions' | 'chrome'>> => ({
  hostActions: {
    subscribe: (listener) =>
      menu.subscribe((action) => {
        const mapped = playerActionFor(action)
        if (mapped !== null) listener(mapped)
      }),
  },
  chrome: {
    shown: (isShown) =>
      handled(client.request({ type: DESKTOP_REQUESTS.windowButtons, isVisible: isShown })),
  },
})

/**
 * Progress for a file main granted: positions go to main, which keeps a local file's resume point
 * and sends a download's to its server under the account it was opened with. Main counts a
 * download's first position after an open as a play, so a file left while it loads says nothing.
 */
export const fileProgressFor = ({
  client,
  fileId,
}: {
  client: DesktopClient
  fileId: string
}): ProgressSink => {
  // Main stores a share watched, which needs the length only the engine learns.
  let length: number | null = null
  let hasStarted = false
  const savePosition = (position: number) =>
    handled(
      client.request({
        type: DESKTOP_REQUESTS.savePosition,
        fileId,
        position,
        duration: length,
      }),
    )
  return {
    // A file has no watch history of its own to open, so this only marks that playback began.
    started: () => {
      hasStarted = true
    },
    save: ({ position }) => savePosition(position),
    left: (position) => {
      if (hasStarted) savePosition(position)
    },
    duration: (seconds) => {
      length = seconds
    },
  }
}

/** A local file's or a download's services, as main described the file. */
export const fileServicesFor = ({
  file,
  client,
  menu,
  engine,
}: {
  file: LocalFile
  client: DesktopClient
  menu: MenuHub
  engine: EngineUse
}): PlayerServices => ({
  title: {
    label: file.label,
    // Only a download's folder says where it came from; any other file's is just its folder.
    context: file.isDownload ? file.folder : null,
    duration: null,
    resumeAt: file.resumeAt,
    backTo: file.isDownload ? DESKTOP_PATHS.downloads : DESKTOP_PATHS.local,
    next:
      file.next === null
        ? null
        : {
            to: playPathOf(file.next.fileId),
            state: { queue: file.next.queue },
            label: file.next.label,
          },
  },
  progress: fileProgressFor({ client, fileId: file.fileId }),
  posterUrl: null,
  escape: null,
  ...windowPartsFor({ client, menu }),
  trackPicks: {
    start: file.tracks,
    save: ({ audio, subtitle }) =>
      handled(
        client.request({ type: DESKTOP_REQUESTS.saveTracks, fileId: file.fileId, audio, subtitle }),
      ),
  },
  unplayableNote: ENGINE_NOTES[engine],
})
