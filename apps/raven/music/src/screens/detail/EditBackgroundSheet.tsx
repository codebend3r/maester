import type { ArtistBackgroundOption } from '@raven/core'
import { useChooseArtistBackground } from '@raven/ui/headless'
import type { ComponentType, ReactNode } from 'react'
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native'
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import { type QueryStatus, useQuery } from '@tanstack/react-query'

import { ARTIST_COPY } from '@raven/wren'
import { useCovers } from '@/music/useCovers'
import { toastFailure } from '@/stores/toast'
import { type WrenTheme, themedStyles, useFormFactor, useWrenTheme } from '@/theme/wrenTheme'
import {
  FORM_FACTORS,
  MOTION,
  OPACITIES,
  RADIUS,
  SIZE,
  SPACE,
  TYPE,
  type FormFactor,
} from '@/theme/wrenTokens'
import { LoadingMark } from '@/components/LoadingMark'
import { BottomSheet } from '@/ui/BottomSheet'
import { tileWidthOf } from '@/ui/tileWidth'
import { ICONS, WrenIcon } from '@/ui/WrenIcon'
import type { WrenSession } from '@/useWren'

/** What a picture does under a finger or a pointer: it grows by this much. */
const LIFT_SCALE = 1.04

/** A picture's width for its height, as the hero crops it: wider than tall. */
const TILE_ASPECT = 1.6

/** How many pictures a row of the grid holds on each form factor. */
const BACKGROUND_COLUMNS = {
  [FORM_FACTORS.phone]: 2,
  [FORM_FACTORS.tablet]: 4,
} as const satisfies Record<FormFactor, number>

/** The room each side of the grid: the sheet's padding and the body's. */
const SHEET_SIDES = SPACE.s2 + SPACE.s3

/** The share of the window's height the grid may take before it scrolls. */
const GRID_HEIGHT_SHARE = 0.55

/** What the picker is showing: the options while they load, once they failed, or once found, by the query's status. */
const BACKGROUND_STATES = {
  loading: 'pending',
  failed: 'error',
  ready: 'success',
} as const satisfies Record<string, QueryStatus>

type BackgroundState = (typeof BACKGROUND_STATES)[keyof typeof BACKGROUND_STATES]

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  body: { gap: SPACE.s3, paddingHorizontal: SPACE.s3, paddingTop: SPACE.s3 },
  note: { ...TYPE.meta, color: colors.text2 },
  grid: { columnGap: SPACE.s3, flexDirection: 'row', flexWrap: 'wrap', rowGap: SPACE.s3 },
  tile: {
    backgroundColor: colors.surface2,
    borderColor: colors.line2,
    borderRadius: RADIUS.md,
    borderWidth: SIZE.hairline,
    justifyContent: 'center',
    overflow: 'hidden',
    padding: SPACE.s2,
  },
  worn: { borderColor: colors.accentText, borderWidth: SIZE.focusRing },
  busy: { opacity: OPACITIES.disabled },
  plain: { alignItems: 'center', gap: SPACE.s2 },
  defaultLabel: { ...TYPE.rowStrong, color: colors.text2, textAlign: 'center' },
  badge: {
    backgroundColor: colors.accentText,
    borderRadius: RADIUS.pill,
    bottom: SPACE.s2,
    left: SPACE.s2,
    paddingHorizontal: SPACE.s2,
    paddingVertical: SPACE.s1,
    position: 'absolute',
  },
  badgeText: { ...TYPE.actionLabel, color: colors.bg },
  message: { alignItems: 'center', gap: SPACE.s3, paddingVertical: SPACE.s6 },
  messageText: { ...TYPE.body, color: colors.text2, textAlign: 'center' },
}))

type BackgroundTileProps = {
  /** What the tile is called aloud. */
  label: string
  isWorn: boolean
  /** Whether a choice is being saved, so no other can be pressed meanwhile. */
  isDisabled: boolean
  width: number
  onPress: () => void
  /** The tile's picture, or the default's words. */
  children: ReactNode
}

/** One choice in the grid: it grows a little under a finger or a pointer, and says when it is the one worn. */
function BackgroundTile({
  label,
  isWorn,
  isDisabled,
  width,
  onPress,
  children,
}: BackgroundTileProps) {
  const styles = useStyles()
  const isReduced = useReducedMotion()
  const scale = useSharedValue(1)
  const duration = isReduced ? 0 : MOTION.tile
  const lift = (to: number) => () => scale.set(withTiming(to, { duration }))
  const grow = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }))
  return (
    <Animated.View style={[{ width }, grow]}>
      <Pressable
        accessibilityLabel={label}
        accessibilityRole="radio"
        accessibilityState={{ checked: isWorn, disabled: isDisabled }}
        disabled={isDisabled}
        onHoverIn={lift(LIFT_SCALE)}
        onHoverOut={lift(1)}
        onPress={onPress}
        onPressIn={lift(LIFT_SCALE)}
        onPressOut={lift(1)}
        style={[
          styles.tile,
          isWorn && styles.worn,
          isDisabled && styles.busy,
          { height: width / TILE_ASPECT },
        ]}
      >
        {children}
        {isWorn && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{ARTIST_COPY.backgroundWorn}</Text>
          </View>
        )}
      </Pressable>
    </Animated.View>
  )
}

type PickerViewProps = {
  options: readonly ArtistBackgroundOption[]
  chosen: string | null
  artistId: number
  session: WrenSession
  /** Whether a choice is being saved. */
  isChoosing: boolean
  onChoose: (key: string | null) => void
}

/**
 * Every option, and the default photo first, in a grid; the one worn is marked. With no other
 * picture the default stays, so an owner can always go back to it.
 */
function ReadyView({ options, chosen, artistId, session, isChoosing, onChoose }: PickerViewProps) {
  const styles = useStyles()
  const { colors } = useWrenTheme()
  const { width: windowWidth } = useWindowDimensions()
  const { artistBackgroundOf } = useCovers(session)
  const columns = BACKGROUND_COLUMNS[useFormFactor()]
  const width = tileWidthOf({ width: windowWidth - 2 * SHEET_SIDES, columns, gap: SPACE.s3 })
  return (
    <>
      <View style={styles.grid}>
        <BackgroundTile
          isDisabled={isChoosing}
          isWorn={chosen === null}
          label={ARTIST_COPY.backgroundDefault}
          onPress={() => onChoose(null)}
          width={width}
        >
          <View style={styles.plain}>
            <WrenIcon color={colors.text2} name={ICONS.artist} size={SIZE.smallIcon} />
            <Text style={styles.defaultLabel}>{ARTIST_COPY.backgroundDefault}</Text>
          </View>
        </BackgroundTile>
        {options.map(({ key, kind }, at) => {
          const picture = artistBackgroundOf({ artistId, key })
          return (
            <BackgroundTile
              isDisabled={isChoosing}
              isWorn={chosen === key}
              key={key}
              label={ARTIST_COPY.backgroundOption({ kind, position: at + 1 })}
              onPress={() => onChoose(key)}
              width={width}
            >
              {picture !== null && (
                <Image
                  accessibilityIgnoresInvertColors
                  resizeMode="cover"
                  source={picture}
                  style={StyleSheet.absoluteFill}
                />
              )}
            </BackgroundTile>
          )
        })}
      </View>
      {options.length === 0 && (
        <View style={styles.message}>
          <Text style={styles.messageText}>{ARTIST_COPY.backgroundEmpty}</Text>
        </View>
      )}
    </>
  )
}

/** The options are on their way. */
function LoadingView() {
  const styles = useStyles()
  return (
    <View style={styles.message}>
      <LoadingMark label={ARTIST_COPY.backgroundLoading} />
    </View>
  )
}

/** The server did not answer; opening the sheet again asks again. */
function FailedView() {
  const styles = useStyles()
  return (
    <View style={styles.message}>
      <Text style={styles.messageText}>{ARTIST_COPY.backgroundFailed}</Text>
    </View>
  )
}

const PICKER_VIEWS = {
  [BACKGROUND_STATES.loading]: LoadingView,
  [BACKGROUND_STATES.failed]: FailedView,
  [BACKGROUND_STATES.ready]: ReadyView,
} as const satisfies Record<BackgroundState, ComponentType<PickerViewProps>>

type BackgroundPickerProps = { session: WrenSession; artistId: number; onDone: () => void }

/** The options, asked for only while the sheet is up, and the choice sent when one is pressed. */
function BackgroundPicker({ session, artistId, onDone }: BackgroundPickerProps) {
  const styles = useStyles()
  const backgrounds = useQuery(session.queries.artistBackgroundsQuery(artistId))
  const choose = useChooseArtistBackground({
    api: session.api,
    artistId,
    onChosen: onDone,
    onFailure: toastFailure,
  })
  const PickerView = PICKER_VIEWS[backgrounds.status]
  const { height } = useWindowDimensions()
  return (
    <ScrollView style={{ maxHeight: height * GRID_HEIGHT_SHARE }}>
      <View style={styles.body}>
        <Text style={styles.note}>{ARTIST_COPY.backgroundNote}</Text>
        <PickerView
          artistId={artistId}
          chosen={backgrounds.data?.chosen ?? null}
          isChoosing={choose.isPending}
          onChoose={(key) => choose.mutate(key)}
          options={backgrounds.data?.options ?? []}
          session={session}
        />
      </View>
    </ScrollView>
  )
}

type EditBackgroundSheetProps = {
  session: WrenSession
  artistId: number
  /** Whose background it is, under the sheet's title. */
  artistName: string
  isOpen: boolean
  onClose: () => void
}

/** The owner's sheet of pictures to put behind an artist's name; choosing one sets it and closes the sheet. */
export function EditBackgroundSheet({
  session,
  artistId,
  artistName,
  isOpen,
  onClose,
}: EditBackgroundSheetProps) {
  return (
    <BottomSheet
      head={{ title: ARTIST_COPY.backgroundTitle, subtitle: artistName }}
      isOpen={isOpen}
      onClose={onClose}
    >
      <BackgroundPicker artistId={artistId} onDone={onClose} session={session} />
    </BottomSheet>
  )
}
