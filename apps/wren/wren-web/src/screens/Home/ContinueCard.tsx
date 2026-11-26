import { type Track, artistNames } from '@raven/core'
import { playingTrackOf, useAudioQueue } from '@raven/ui/headless'
import { HOME_COPY, WREN_ICONS } from '@raven/wren'
import type { ComponentType } from 'react'
import { useCovers } from '@/music/useCovers'
import { WREN_ROUTES } from '@/routes'
import { FORM_FACTORS, type FormFactor, useFormFactor } from '@/theme/formFactor'
import { COLORS, RADII, SIZES, type Size } from '@/theme/tokens'
import { AlbumArt } from '@/ui/AlbumArt/AlbumArt'
import { Button } from '@/ui/Button/Button'
import { Card } from '@/ui/Card/Card'
import { IconButton } from '@/ui/IconButton/IconButton'
import { Pressable } from '@/ui/Pressable/Pressable'
import styles from '@/screens/Home/ContinueCard.module.scss'

/**
 * The card only ever resumes: pausing is the mini player's and the player bar's, so the two
 * never offer the same control under the same name.
 */
type ActionProps = { onResume: () => void }

/** The narrow layout's round red play button, read out as Resume. */
function PlayCircle({ onResume }: ActionProps) {
  return (
    <IconButton
      color={COLORS.accentInk}
      fill={COLORS.accent}
      icon={WREN_ICONS.play}
      label={HOME_COPY.resume}
      onPress={onResume}
      size={SIZES.button}
    />
  )
}

/** The wide layout's Resume. */
function ResumeButton({ onResume }: ActionProps) {
  return <Button icon={WREN_ICONS.play} label={HOME_COPY.resume} onPress={onResume} />
}

const ACTIONS = {
  [FORM_FACTORS.phone]: PlayCircle,
  [FORM_FACTORS.tablet]: ResumeButton,
} as const satisfies Record<FormFactor, ComponentType<ActionProps>>

/** The art's size on each layout. */
const ART_SIZES = {
  [FORM_FACTORS.phone]: SIZES.continueArt,
  [FORM_FACTORS.tablet]: SIZES.continueArtWide,
} as const satisfies Record<FormFactor, Size>

type PlaceLineProps = { line: string; track: Track }

type PlaceLine = (props: PlaceLineProps) => string

// What follows "Sia · Track 11 of 20": nothing on the narrow layout, the track's title on the wide.
const PLACE_LINES = {
  [FORM_FACTORS.phone]: ({ line }) => line,
  [FORM_FACTORS.tablet]: ({ line, track }) =>
    HOME_COPY.continueLine({ artists: line, track: track.title }),
} as const satisfies Record<FormFactor, PlaceLine>

type LineOfProps = { track: Track; at: number; count: number; formFactor: FormFactor }

/** "Sia · Track 11 of 20", and on the wide layout the track's title after it. */
const lineOf = ({ track, at, count, formFactor }: LineOfProps): string =>
  PLACE_LINES[formFactor]({
    line: HOME_COPY.continueLine({
      artists: artistNames(track),
      track: HOME_COPY.trackOf({ at, count }),
    }),
    track,
  })

type ContinueCardOfProps = { track: Track }

function ContinueCardOf({ track }: ContinueCardOfProps) {
  const { trackCoverOf } = useCovers()
  const formFactor = useFormFactor()
  const at = useAudioQueue((store) => (store.queue.at ?? 0) + 1)
  const count = useAudioQueue((store) => store.queue.order.length)
  const play = useAudioQueue((store) => store.play)
  const line = lineOf({ track, at, count, formFactor })
  const Action = ACTIONS[formFactor]
  return (
    <Card className={styles.card}>
      <Pressable
        className={styles.open}
        href={WREN_ROUTES.nowPlaying}
        label={HOME_COPY.continueLabel({ album: track.album.title, line })}
      >
        <AlbumArt cover={trackCoverOf(track)} radius={RADII.item} size={ART_SIZES[formFactor]} />
        <span className={styles.text}>
          <span className={styles.overline}>{HOME_COPY.continueListening}</span>
          <span className={styles.album}>{track.album.title}</span>
          <span className={styles.line}>{line}</span>
        </span>
      </Pressable>
      <Action onResume={play} />
    </Card>
  )
}

/** Continue listening: the queue's track, where it stands in the queue, and Resume. None while nothing is queued. */
export function ContinueCard() {
  const track = useAudioQueue(playingTrackOf)
  return track !== null && <ContinueCardOf track={track} />
}
