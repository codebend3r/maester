import { type Track, artistNames } from '@raven/core'
import { playingTrackOf, useAudioQueue } from '@raven/ui/headless'
import { useRouter } from 'expo-router'
import type { ComponentType } from 'react'
import { Pressable, Text, View } from 'react-native'

import { HOME_COPY } from '@raven/wren'
import type { Covers } from '@/music/useCovers'
import { WREN_ROUTES } from '@/routes'
import { type WrenTheme, themedStyles, useFormFactor, useWrenTheme } from '@/theme/wrenTheme'
import {
  HOME_SIZES,
  RADIUS,
  SIZE,
  SPACE,
  TYPE,
  FORM_FACTORS,
  type FormFactor,
} from '@/theme/wrenTokens'
import { AlbumArt } from '@/ui/AlbumArt'
import { Button } from '@/ui/Button'
import { Card } from '@/ui/Card'
import { IconButton } from '@/ui/IconButton'
import { pressedStyleOf } from '@/ui/press'
import { ICONS } from '@/ui/WrenIcon'

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  card: {
    alignItems: 'center',
    borderRadius: RADIUS.feature,
    flexDirection: 'row',
    gap: SPACE.s4,
    padding: SPACE.s3,
  },
  open: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: SPACE.s4 },
  text: { flex: 1, gap: SPACE.s1 },
  overline: { ...TYPE.overline, color: colors.text3 },
  line: { ...TYPE.time, color: colors.text2 },
}))

// How the card and its album's title sit on each form factor.
const useLookStyles = themedStyles(({ colors }: WrenTheme) => ({
  [FORM_FACTORS.phone]: { ...TYPE.cardTitle, color: colors.text },
  [FORM_FACTORS.tablet]: { ...TYPE.albumTitle, color: colors.text },
}))

const useCardStyles = themedStyles(() => ({
  [FORM_FACTORS.phone]: {},
  [FORM_FACTORS.tablet]: { flex: 1, padding: SPACE.s6 },
}))

const ALBUM_LINES = {
  [FORM_FACTORS.phone]: 1,
  [FORM_FACTORS.tablet]: 2,
} as const satisfies Record<FormFactor, number>

/**
 * The card only ever resumes: pausing is the mini player's and the player bar's, so the two
 * never offer the same control under the same name.
 */
type ActionProps = { onResume: () => void }

/** The phone's round red play button, read out as Resume. */
function PlayCircle({ onResume }: ActionProps) {
  const { colors } = useWrenTheme()
  return (
    <IconButton
      color={colors.accentInk}
      fill={colors.accent}
      icon={ICONS.play}
      label={HOME_COPY.resume}
      onPress={onResume}
      size={SIZE.button}
    />
  )
}

/** The tablet's Resume. */
function ResumeButton({ onResume }: ActionProps) {
  return <Button icon={ICONS.play} label={HOME_COPY.resume} onPress={onResume} />
}

const ACTIONS = {
  [FORM_FACTORS.phone]: PlayCircle,
  [FORM_FACTORS.tablet]: ResumeButton,
} as const satisfies Record<FormFactor, ComponentType<ActionProps>>

/** The art's size on each layout. */
const ART_SIZES = {
  [FORM_FACTORS.phone]: HOME_SIZES.continueArt,
  [FORM_FACTORS.tablet]: HOME_SIZES.tabletContinueArt,
} as const satisfies Record<FormFactor, number>

type LineOfProps = { track: Track; at: number; count: number; formFactor: FormFactor }

type PlaceLineProps = { line: string; track: Track }

// What follows "Sia · Track 11 of 20": nothing on a phone, the track's title on a tablet.
const PLACE_LINES = {
  [FORM_FACTORS.phone]: ({ line }: PlaceLineProps) => line,
  [FORM_FACTORS.tablet]: ({ line, track }: PlaceLineProps) =>
    HOME_COPY.continueLine({ artists: line, track: track.title }),
} as const satisfies Record<FormFactor, (props: PlaceLineProps) => string>

/** "Sia · Track 11 of 20", and on a tablet the track's title after it. */
const lineOf = ({ track, at, count, formFactor }: LineOfProps): string =>
  PLACE_LINES[formFactor]({
    line: HOME_COPY.continueLine({
      artists: artistNames(track),
      track: HOME_COPY.trackOf({ at, count }),
    }),
    track,
  })

type ContinueCardOfProps = { track: Track; covers: Covers }

function ContinueCardOf({ track, covers }: ContinueCardOfProps) {
  const styles = useStyles()
  const lookStyles = useLookStyles()
  const cardStyles = useCardStyles()
  const router = useRouter()
  const formFactor = useFormFactor()
  const at = useAudioQueue((store) => (store.queue.at ?? 0) + 1)
  const count = useAudioQueue((store) => store.queue.order.length)
  const play = useAudioQueue((store) => store.play)
  const line = lineOf({ track, at, count, formFactor })
  const Action = ACTIONS[formFactor]
  return (
    <Card style={[styles.card, cardStyles[formFactor]]}>
      <Pressable
        accessibilityLabel={HOME_COPY.continueLabel({ album: track.album.title, line })}
        accessibilityRole="button"
        onPress={() => router.push(WREN_ROUTES.nowPlaying)}
        style={pressedStyleOf({ style: styles.open })}
      >
        <AlbumArt
          cover={covers.trackCoverOf(track)}
          radius={RADIUS.item}
          size={ART_SIZES[formFactor]}
        />
        <View style={styles.text}>
          <Text style={styles.overline}>{HOME_COPY.continueListening}</Text>
          <Text numberOfLines={ALBUM_LINES[formFactor]} style={lookStyles[formFactor]}>
            {track.album.title}
          </Text>
          <Text numberOfLines={2} style={styles.line}>
            {line}
          </Text>
        </View>
      </Pressable>
      <Action onResume={play} />
    </Card>
  )
}

type ContinueCardProps = { covers: Covers }

/** Continue listening: the queue's track, where it stands in the queue, and Resume. None while nothing is queued. */
export function ContinueCard({ covers }: ContinueCardProps) {
  const track = useAudioQueue(playingTrackOf)
  return track !== null && <ContinueCardOf covers={covers} track={track} />
}
