import { THEME_TONES } from '@raven/core'
import { Icon } from '@raven/native'
import type { IconName } from '@raven/ui/iconDrawings'
import { type ComponentRef, type ComponentType, useRef } from 'react'
import { Image, Pressable, StyleSheet, View } from 'react-native'

import { DOWNLOAD_COPY } from '@/downloads/copy'
import {
  FINISHED_KINDS,
  type FinishedRow,
  UNDERWAY_PHASES,
  type UnderwayPhase,
  type UnderwayRow,
} from '@/downloads/downloadsPage'
import type { DownloadsLayoutProps, ShownGroup, ShownUnderway } from '@/layouts/downloadsKit'
import { openPickerSheet } from '@/layouts/Picker.touch'
import { Text, TEXT_VARIANTS } from '@/layouts/Text'
import { LINE_RATIO, linesHeightOf } from '@/layouts/textHeights'
import { TitleArt } from '@/layouts/TitleArt'
import { OPACITIES, SIZES } from '@/theme/appTheme'
import { themedStyles, useTheme } from '@/theme/useTheme'

/** How wide a group's picture stands beside its name. */
const ART_WIDTH = SIZES.fieldHeight * 1.5

/** A poster's height to its width; an album's cover is square. */
const POSTER_RATIO = 1.5

/** A running download's poster, smaller than a finished group's. */
const ROW_ART_WIDTH = ART_WIDTH * 0.75

/** How tall a running download's title art stands, and a finished group's. */
const LOGO_HEIGHTS = { row: SIZES.fieldHeight * 0.75, group: SIZES.fieldHeight } as const

/** How wide title art may run before it is shrunk to fit. */
const LOGO_MAX_WIDTH = SIZES.fieldHeight * 6

/** What a long press on a finished download offers. */
const HELD_ACTIONS = { play: 'play', delete: 'delete' } as const

type HeldAction = (typeof HELD_ACTIONS)[keyof typeof HELD_ACTIONS]

/**
 * How tall a running download's row stands, the same for every one so the queue's drag reads
 * its slot off the distance: the padding, the taller of its poster and its three lines, the
 * bar and the facts line, grown with the viewer's text size.
 */
export const underwayHeightOf = (fontScale: number): number => {
  const words =
    LOGO_HEIGHTS.row +
    linesHeightOf({ sizes: [SIZES.text, SIZES.textSm], fontScale }) +
    SIZES.space1 * 2
  const head = Math.max(ROW_ART_WIDTH * POSTER_RATIO, words)
  const facts = linesHeightOf({ sizes: [SIZES.textSm], fontScale })
  return SIZES.space3 * 2 + head + SIZES.space1 * 2 + SIZES.space1 + facts
}

type HeldSheetProps = {
  title: string
  anchor: Parameters<typeof openPickerSheet>[0]['anchor']
  playLabel: string
  deleteLabel: string
  onPlay: () => void
  onDelete: () => void
}

/** The sheet a long press opens: Play, and Delete in red, which still asks before it deletes. */
const openHeldSheet = ({
  title,
  anchor,
  playLabel,
  deleteLabel,
  onPlay,
  onDelete,
}: HeldSheetProps) => {
  const actions = {
    [HELD_ACTIONS.play]: onPlay,
    [HELD_ACTIONS.delete]: onDelete,
  } as const satisfies Record<HeldAction, () => void>
  openPickerSheet<HeldAction>({
    label: title,
    anchor,
    options: [
      { key: HELD_ACTIONS.play, label: playLabel },
      { key: HELD_ACTIONS.delete, label: deleteLabel },
    ],
    destructiveKey: HELD_ACTIONS.delete,
    onChoose: (key) => actions[key](),
  })
}

/**
 * The colour title art is drawn in on this theme. TMDB's logos are mostly light, made for a dark
 * picture, and vanish on a light ground; React Native cannot read a logo's pixels to tell one that
 * would, as the web does, so on a light theme every logo is drawn in the text colour.
 */
const useLogoTint = (): string | null => {
  const isLight = useTheme((theme) => theme.tone === THEME_TONES.light)
  const text = useTheme((theme) => theme.palette.text)
  return isLight ? text : null
}

type IconPressProps = { icon: IconName; label: string; onPress: () => void }

/** A finger-sized icon button, said by its label. */
const IconPress = ({ icon, label, onPress }: IconPressProps) => {
  const styles = useStyles()
  const text = useTheme((theme) => theme.palette.text)
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={SIZES.space1}
      onPress={onPress}
      style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
    >
      <Icon colour={text} name={icon} size={SIZES.textLg} />
    </Pressable>
  )
}

type ProgressBarProps = { fraction: number | null }

/** How far a download has come, as a bar; an empty track while there is nothing to measure. */
const ProgressBar = ({ fraction }: ProgressBarProps) => {
  const styles = useStyles()
  const percent = Math.round((fraction ?? 0) * 100)
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: percent }}
      style={styles.bar}
    >
      <View style={[styles.barFill, { width: `${percent}%` }]} />
    </View>
  )
}

type GroupArtProps = Pick<ShownGroup, 'art'> & {
  /** A square cover, not a poster. */
  isMusic: boolean
  name: string
  /** How wide the tile stands; a poster is half again as tall. */
  width: number
}

/** A poster or cover, saved on the device; the name's first letter without one. */
const GroupArt = ({ art, isMusic, name, width }: GroupArtProps) => {
  const styles = useStyles()
  const height = isMusic ? width : width * POSTER_RATIO
  return (
    <View style={[styles.art, { width, height }]}>
      {art !== null && (
        <Image accessibilityIgnoresInvertColors source={art} style={styles.artPicture} />
      )}
      {art === null && (
        <Text variant={TEXT_VARIANTS.display} style={styles.initial}>
          {name.slice(0, 1)}
        </Text>
      )}
    </View>
  )
}

type UnderwayFootProps = { row: ShownUnderway; facts: string }

/** A download on its way: its bar, then its status, bytes and speed with the time left at the end. */
const ComingFoot = ({ row, facts }: UnderwayFootProps) => {
  const styles = useStyles()
  return (
    <>
      <ProgressBar fraction={row.fraction} />
      <View style={styles.facts}>
        <Text numberOfLines={1} style={[styles.muted, styles.figures, styles.grow]}>
          {facts}
        </Text>
        {row.timeLeft !== null && (
          <Text numberOfLines={1} style={[styles.muted, styles.figures]}>
            {row.timeLeft}
          </Text>
        )}
      </View>
    </>
  )
}

/** A failed download: why, in the error colour. */
const FailedFoot = ({ facts }: UnderwayFootProps) => {
  const styles = useStyles()
  return (
    <Text numberOfLines={1} style={styles.error}>
      {facts}
    </Text>
  )
}

const UNDERWAY_FEET = {
  [UNDERWAY_PHASES.coming]: ComingFoot,
  [UNDERWAY_PHASES.failed]: FailedFoot,
} as const satisfies Record<UnderwayPhase, ComponentType<UnderwayFootProps>>

type UnderwayEntryProps = {
  row: ShownUnderway
  /** The row's one height, shared by every row so the queue drags by it. */
  height: number
  onCancel: (row: UnderwayRow) => void
  onRetry: (row: UnderwayRow) => void
}

/** A download on its way: its name, its bar, its bytes, speed and time left, and Cancel; Retry once it failed. */
export const UnderwayEntry = ({ row, height, onCancel, onRetry }: UnderwayEntryProps) => {
  const styles = useStyles()
  const logoTint = useLogoTint()
  const facts = [row.status, row.bytes, row.speed]
    .filter((fact) => fact !== null)
    .join(DOWNLOAD_COPY.separator)
  const Foot = UNDERWAY_FEET[row.phase]
  return (
    <View style={[styles.underway, { height }]}>
      <View style={styles.rowHead}>
        <GroupArt art={row.art} isMusic={row.isMusic} name={row.name} width={ROW_ART_WIDTH} />
        <View style={[styles.grow, styles.named]}>
          <TitleArt
            height={LOGO_HEIGHTS.row}
            logo={row.logo}
            maxWidth={LOGO_MAX_WIDTH}
            name={row.name}
            textStyle={styles.rowName}
            tint={logoTint}
          />
          {row.title !== row.name && (
            <Text numberOfLines={1} style={styles.rowTitle}>
              {row.title}
            </Text>
          )}
          <Text numberOfLines={1} style={styles.muted}>
            {row.line}
          </Text>
        </View>
        {row.phase === UNDERWAY_PHASES.failed && (
          <IconPress
            icon="reset"
            label={DOWNLOAD_COPY.retryDownload}
            onPress={() => onRetry(row)}
          />
        )}
        <IconPress
          icon="close"
          label={DOWNLOAD_COPY.cancelDownload(row.title)}
          onPress={() => onCancel(row)}
        />
      </View>
      <Foot facts={facts} row={row} />
    </View>
  )
}

type FinishedEntryProps = {
  group: ShownGroup
  row: FinishedRow
  onPlay: DownloadsLayoutProps['onPlay']
  onDelete: DownloadsLayoutProps['onDelete']
}

/** A finished file in its group: pressed to play, held for Play or Delete, with Delete beside it. */
const FinishedEntry = ({ group, row, onPlay, onDelete }: FinishedEntryProps) => {
  const styles = useStyles()
  const anchor = useRef<ComponentRef<typeof View>>(null)
  return (
    <View style={styles.rowHead}>
      <Pressable
        ref={anchor}
        accessibilityLabel={DOWNLOAD_COPY.playTitle(row.title)}
        accessibilityRole="button"
        onLongPress={() =>
          openHeldSheet({
            title: row.title,
            anchor,
            playLabel: DOWNLOAD_COPY.play,
            deleteLabel: DOWNLOAD_COPY.deleteDownload,
            onPlay: () => onPlay({ group, row }),
            onDelete: () => onDelete(row),
          })
        }
        onPress={() => onPlay({ group, row })}
        style={({ pressed }) => [styles.grow, styles.entry, pressed && styles.pressed]}
      >
        <Text numberOfLines={1} style={styles.rowTitle}>
          {row.title}
        </Text>
        <Text numberOfLines={1} style={styles.muted}>
          {[row.line, row.size].join(DOWNLOAD_COPY.separator)}
        </Text>
      </Pressable>
      <IconPress
        icon="trash"
        label={DOWNLOAD_COPY.deleteTitle(row.title)}
        onPress={() => onDelete(row)}
      />
    </View>
  )
}

type FinishedGroupProps = Pick<
  DownloadsLayoutProps,
  'onPlay' | 'onPlayGroup' | 'onDelete' | 'onDeleteGroup'
> & { group: ShownGroup }

/** A show's season, a movie, an album or a playlist: its picture, name and size, Play and Delete, then its files. */
export const FinishedGroupView = ({
  group,
  onPlay,
  onPlayGroup,
  onDelete,
  onDeleteGroup,
}: FinishedGroupProps) => {
  const styles = useStyles()
  const logoTint = useLogoTint()
  const anchor = useRef<ComponentRef<typeof View>>(null)
  const isMusic = group.kind === FINISHED_KINDS.music
  const openSheet = () =>
    openHeldSheet({
      title: group.title,
      anchor,
      playLabel: DOWNLOAD_COPY.playAll,
      deleteLabel: DOWNLOAD_COPY.deleteTitle(group.title),
      onPlay: () => onPlayGroup(group),
      onDelete: () => onDeleteGroup(group),
    })
  return (
    <View style={styles.group}>
      <View ref={anchor} style={styles.groupHead}>
        <Pressable
          accessibilityLabel={group.title}
          accessibilityRole="button"
          onLongPress={openSheet}
          onPress={() => onPlayGroup(group)}
          style={({ pressed }) => [pressed && styles.pressed]}
        >
          <GroupArt art={group.art} isMusic={isMusic} name={group.name} width={ART_WIDTH} />
        </Pressable>
        <View style={styles.groupText}>
          <Pressable
            accessibilityLabel={group.title}
            accessibilityRole="button"
            onLongPress={openSheet}
            onPress={() => onPlayGroup(group)}
            style={({ pressed }) => [styles.named, pressed && styles.pressed]}
          >
            <TitleArt
              height={LOGO_HEIGHTS.group}
              logo={group.logo}
              maxWidth={LOGO_MAX_WIDTH}
              name={group.name}
              textStyle={styles.groupTitle}
              tint={logoTint}
            />
            {group.season !== null && <Text style={styles.rowTitle}>{group.season}</Text>}
            <Text style={styles.muted}>{group.line}</Text>
          </Pressable>
          <View style={styles.groupButtons}>
            <IconPress
              icon="play"
              label={DOWNLOAD_COPY.playTitle(group.title)}
              onPress={() => onPlayGroup(group)}
            />
            <IconPress
              icon="trash"
              label={DOWNLOAD_COPY.deleteTitle(group.title)}
              onPress={() => onDeleteGroup(group)}
            />
          </View>
        </View>
      </View>
      {group.rows.length > 1 &&
        group.rows.map((row) => (
          <FinishedEntry
            key={row.key}
            group={group}
            onDelete={onDelete}
            onPlay={onPlay}
            row={row}
          />
        ))}
    </View>
  )
}

const useStyles = themedStyles((colours) =>
  StyleSheet.create({
    muted: { color: colours.muted, fontSize: SIZES.textSm, lineHeight: SIZES.textSm * LINE_RATIO },
    error: { color: colours.error, fontSize: SIZES.textSm, lineHeight: SIZES.textSm * LINE_RATIO },
    underway: {
      gap: SIZES.space1,
      padding: SIZES.space3,
      borderRadius: SIZES.radius,
      backgroundColor: colours.raised,
    },
    rowHead: { flexDirection: 'row', alignItems: 'center', gap: SIZES.space2 },
    grow: { flex: 1 },
    // The time left keeps the row's right edge, so the facts changing width never move it.
    facts: { flexDirection: 'row', alignItems: 'baseline', gap: SIZES.space2 },
    figures: { fontVariant: ['tabular-nums'] },
    entry: { paddingVertical: SIZES.space1 },
    rowTitle: {
      color: colours.text,
      fontSize: SIZES.text,
      fontWeight: '600',
      lineHeight: SIZES.text * LINE_RATIO,
    },
    rowName: { color: colours.text, fontSize: SIZES.textLg },
    named: { gap: SIZES.space1 },
    bar: {
      height: SIZES.space1,
      borderRadius: SIZES.radiusPill,
      backgroundColor: colours.track,
      overflow: 'hidden',
    },
    barFill: { height: '100%', backgroundColor: colours.accent },
    iconButton: {
      minWidth: SIZES.fieldHeight,
      minHeight: SIZES.fieldHeight,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: SIZES.radius,
    },
    group: {
      gap: SIZES.space2,
      paddingBottom: SIZES.space3,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colours.line,
    },
    groupHead: { flexDirection: 'row', gap: SIZES.space3 },
    groupText: { flex: 1, gap: SIZES.space1 },
    groupTitle: { color: colours.text, fontSize: SIZES.textLg, fontWeight: '600' },
    groupButtons: { flexDirection: 'row', gap: SIZES.space2 },
    art: {
      borderRadius: SIZES.radius,
      backgroundColor: colours.raised,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    artPicture: { width: '100%', height: '100%' },
    initial: { color: colours.muted, fontSize: SIZES.textXl },
    pressed: { opacity: OPACITIES.pressed },
  }),
)
