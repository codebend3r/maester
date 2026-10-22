import { PLAYER_COMMANDS, PLAYER_EVENTS, type PlayerSource } from '@raven/core'
import { Player } from '@raven/ui'
import {
  ENGINE_KINDS,
  type NativePlayer,
  type PlayerServices,
  useHostPlayer,
} from '@raven/ui/headless'
import { useEffect, useMemo, useRef } from 'react'
import { isEngineGone, isEngineStop } from '@/desktop/playerConnection'

/**
 * The native engine, watched for its loss: mpv stopping under the page, or main answering
 * that it has. `onLost` gets where the video was, for the page to carry on from there. It hosts
 * the player it renders, so the host lives exactly as long as the player.
 */
export const NativePlaying = ({
  services,
  player,
  source,
  resumeAt,
  onLost,
}: {
  services: PlayerServices
  player: NativePlayer
  source: PlayerSource
  resumeAt: number
  onLost: (at: number) => void
}) => {
  const isHosting = useHostPlayer(services)
  // Refs, so the page itself never renders on `time`.
  const position = useRef(resumeAt)
  // A `time` before the latest load is answered belongs to the file that load replaced.
  const load = useRef({ latest: 0, isAnswered: false })
  const watched = useMemo<NativePlayer>(
    () => ({
      send: (command) => {
        if (command.type === PLAYER_COMMANDS.seek) position.current = command.time
        if (command.type === PLAYER_COMMANDS.load) {
          load.current = { latest: load.current.latest + 1, isAnswered: false }
        }
        const sent = load.current.latest
        return player.send(command).then(
          () => {
            if (command.type !== PLAYER_COMMANDS.load || sent !== load.current.latest) return
            load.current = { latest: sent, isAnswered: true }
            position.current = command.start
          },
          (error: unknown) => {
            if (isEngineGone(error)) onLost(position.current)
            throw error
          },
        )
      },
      subscribe: player.subscribe,
    }),
    [player, onLost],
  )

  useEffect(
    () =>
      player.subscribe((event) => {
        if (event.type === PLAYER_EVENTS.time) {
          if (load.current.isAnswered) position.current = event.time
          return
        }
        if (isEngineStop(event)) onLost(position.current)
      }),
    [player, onLost],
  )

  return isHosting && <Player engine={{ kind: ENGINE_KINDS.native, player: watched, source }} />
}
