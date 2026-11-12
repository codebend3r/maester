import { type UpNextMoment, useUpNextCountdown } from '@raven/ui/headless'
import { StyleSheet, View } from 'react-native'

import { PLAYER_COPY, type PlayerChromeProps } from '@/layouts/playerKit'
import { Text, TEXT_VARIANTS } from '@/layouts/Text'
import { PlateButton } from '@/layouts/tvControls'
import { TV_GUTTER, TV_SIZES } from '@/theme/tvSizes'
import { pictureStyles } from '@/theme/useTheme'

/** What plays next, as the card offers it: its words, the countdown to it, and its two answers. */
type UpNextOffer = Pick<UpNextMoment, 'secondsLeft' | 'hasSceneAfter'> & {
  words: string
  onPlay: () => void
  onDismiss: () => void
}

type UseUpNextOfferProps = Pick<PlayerChromeProps, 'next' | 'transport' | 'credits'>

/**
 * The web player's up next, on a TV: the card shows from the credits on, or over the video's
 * last seconds when those come first or the credits are unknown, until Watch credits puts it
 * away for this title. With autoplay on it counts the viewer's `autoplayCountdownSeconds` down
 * and plays what is next as it runs out; off, it waits for a press. Null while there is nothing
 * to offer.
 */
export const useUpNextOffer = ({
  next,
  transport,
  credits,
}: UseUpNextOfferProps): UpNextOffer | null => {
  const { isOffered, secondsLeft, hasSceneAfter, dismiss } = useUpNextCountdown({
    time: transport?.position ?? 0,
    duration: transport?.duration ?? null,
    credits,
    hasNext: next !== null,
    canPlayItself: true,
    onDue: () => next?.onPlay(),
  })
  if (!isOffered || next === null) return null
  return { words: next.words, secondsLeft, hasSceneAfter, onPlay: next.onPlay, onDismiss: dismiss }
}

type UpNextCardProps = {
  offer: UpNextOffer
  /** How far the card stands up from the bottom of the screen, clear of the controls while they show. */
  lift: number
}

/**
 * What plays next, at the bottom right over the video whether or not the controls show: its
 * words, how long until it plays by itself, whether a scene follows the credits, Play now and
 * Watch credits. Play now takes the remote as the card appears, so one press plays on.
 */
export const UpNextCard = ({ offer, lift }: UpNextCardProps) => {
  const styles = useStyles()
  const { words, secondsLeft, hasSceneAfter, onPlay, onDismiss } = offer
  return (
    <View pointerEvents="box-none" style={[styles.slot, { paddingBottom: TV_GUTTER + lift }]}>
      <View style={styles.card}>
        <Text style={styles.lead}>{PLAYER_COPY.upNext}</Text>
        <Text variant={TEXT_VARIANTS.display} numberOfLines={2} style={styles.title}>
          {words}
        </Text>
        {secondsLeft !== null && (
          <Text accessibilityLiveRegion="polite" style={styles.line}>
            {PLAYER_COPY.playsIn(secondsLeft)}
          </Text>
        )}
        {hasSceneAfter && <Text style={styles.line}>{PLAYER_COPY.sceneAfter}</Text>}
        <View style={styles.actions}>
          <PlateButton
            icon="play"
            isOverPicture
            label={PLAYER_COPY.playNow}
            onPress={onPlay}
            shouldFocusOnMount
            text={PLAYER_COPY.playNow}
          />
          <PlateButton
            isOverPicture
            label={PLAYER_COPY.watchCredits}
            onPress={onDismiss}
            text={PLAYER_COPY.watchCredits}
          />
        </View>
      </View>
    </View>
  )
}

const useStyles = pictureStyles((colours) =>
  StyleSheet.create({
    slot: {
      ...StyleSheet.absoluteFill,
      alignItems: 'flex-end',
      justifyContent: 'flex-end',
      paddingHorizontal: TV_GUTTER,
    },
    card: {
      gap: TV_SIZES.space2,
      maxWidth: TV_SIZES.measure,
      padding: TV_SIZES.space4,
      borderRadius: TV_SIZES.radius * 2,
      backgroundColor: colours.raised,
    },
    lead: { color: colours.muted, fontSize: TV_SIZES.text },
    title: { color: colours.text, fontSize: TV_SIZES.textLg },
    line: { color: colours.muted, fontSize: TV_SIZES.text, fontVariant: ['tabular-nums'] },
    actions: { flexDirection: 'row', gap: TV_SIZES.space3, paddingTop: TV_SIZES.space2 },
  }),
)
