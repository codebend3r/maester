import type { PlayerAction, PlayerServices } from '@raven/ui'
import { type Infer, listOf, object } from '@raven/core'
import type { DesktopClient } from '@/renderer/desktop/client'
import type { MenuHub } from '@/renderer/desktop/menuHub'
import { isOpaqueId, type LocalFile, type MenuPlayerAction } from '@/shared/protocol'

/** What the Shell leaves in `location.state` when it opens a video. */
export const isPlayState = object({ queue: listOf(isOpaqueId) })

export type PlayState = Infer<typeof isPlayState>

/** The Playback menu's actions as the player's own; Next is the page's, not the player's. */
export const playerActionFor = (action: MenuPlayerAction): PlayerAction | null => {
  switch (action) {
    case 'togglePlay':
      return { type: 'togglePlay' }
    case 'skipBack':
      return { type: 'seekBy', seconds: -10 }
    case 'skipForward':
      return { type: 'seekBy', seconds: 10 }
    case 'showShortcuts':
      return { type: 'showShortcuts' }
    case 'next':
      return null
    default: {
      const unreachable: never = action
      return unreachable
    }
  }
}

export const servicesFor = ({
  file,
  client,
  menu,
}: {
  file: LocalFile
  client: DesktopClient
  menu: MenuHub
}): PlayerServices => {
  // Main stores a share watched, which needs the length only the engine learns.
  let length: number | null = null
  const savePosition = (position: number) =>
    void client.request({
      type: 'savePosition',
      fileId: file.fileId,
      position,
      duration: length,
    })
  return {
    title: {
      label: file.label,
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
      // A local file has no watch history to open.
      started: () => undefined,
      save: savePosition,
      left: savePosition,
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
  }
}
