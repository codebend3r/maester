import { PLAYER_COMMANDS, PLAYER_EVENTS, type PlayerSource } from '@raven/core'
import { type NativePlayer, Player, type PlayerServices, useHostPlayer } from '@raven/ui'
import { useEffect, useMemo, useRef } from 'react'
import { isEngineGone, isEngineStop, PlayerRefusal } from '@/renderer/desktop/playerConnection'

/**
 * The native engine, watched for its loss: mpv stopping under the page, or main answering
 * that it has. `onLost` gets where the video was, for the page to carry on from there;
 * `onRefused` hears main's reason when it turns a load down.
 */
export const NativePlaying = ({
  player,
  source,
  resumeAt,
  onLost,
  onRefused,
}: {
  services: PlayerServices
  player: NativePlayer
  source: PlayerSource
  resumeAt: number
  onLost: (at: number) => void
  onRefused?: (message: string) => void
}) => {
  const isHosting = useHostPlayer(services)
  // Refs, so the page itself never renders on `time`.
  const position = useRef(resumeAt)
  // A `time` before the latest load is answered belongs to the file that load replaced.
  const load = useRef({ latest: 0, isAnswered: false })
  const watched = useMemo<NativePlayer>(
    () => ({
      send: (command) => {
        if (command.type === 'seek') position.current = command.time
        if (command.type === 'load') {
          load.current = { latest: load.current.latest + 1, isAnswered: false }
        }
        const sent = load.current.latest
        return player.send(command).then(
          () => {
            if (command.type !== 'load' || sent !== load.current.latest) return
            load.current = { latest: sent, isAnswered: true }
            position.current = command.start
          },
          (error: unknown) => {
            if (isEngineGone(error)) onLost(position.current)
            const isRefusedLoad = command.type === 'load' && error instanceof PlayerRefusal
            if (isRefusedLoad && !error.isEngineGone && onRefused !== undefined) {
              onRefused(error.message)
            }
            throw error
          },
        )
      },
      subscribe: player.subscribe,
    }),
    [player, onLost, onRefused],
  )

  useEffect(
    () =>
      player.subscribe((event) => {
        if (event.type === 'time') {
          if (load.current.isAnswered) position.current = event.time
          return
        }
        if (isEngineStop(event)) onLost(position.current)
      }),
    [player, onLost],
  )

  return <Player engine={{ kind: 'native', player: watched, source }} />
}
