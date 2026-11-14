import { Icon } from '@raven/native'
import { type ComponentType, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { DOWNLOAD_COPY } from '@/downloads/copy'
import { FinishedGroupView, UnderwayEntry, underwayHeightOf } from '@/layouts/DownloadRows.touch'
import type {
  DownloadsKit,
  DownloadsLayoutProps,
  ShownGroup,
  ShownLibrarySection,
} from '@/layouts/downloadsKit'
import { touchPicker } from '@/layouts/Picker.touch'
import { SortableList } from '@/layouts/SortableList.touch'
import { Text, TEXT_VARIANTS } from '@/layouts/Text'
import { LINE_RATIO } from '@/layouts/textHeights'
import { TouchNav } from '@/layouts/TouchNav'
import { DOWNLOAD_GROUPINGS, type DownloadsGrouping } from '@/stores/appPrefs'
import { OPACITIES, SIZES } from '@/theme/appTheme'
import { themedStyles, useTheme } from '@/theme/useTheme'
import { CAN_DOWNLOAD } from '@/layouts/downloadKind'
import { APP_ICONS } from '@/theme/icons'

/** The two ways the finished downloads are shown, as the picker offers them. */
const GROUPING_OPTIONS = [
  { key: DOWNLOAD_GROUPINGS.all, label: DOWNLOAD_COPY.showAll },
  { key: DOWNLOAD_GROUPINGS.byLibrary, label: DOWNLOAD_COPY.showByLibrary },
] as const satisfies readonly { key: DownloadsGrouping; label: string }[]

type FinishedViewProps = Pick<
  DownloadsLayoutProps,
  'finished' | 'finishedByLibrary' | 'onPlay' | 'onPlayGroup' | 'onDelete' | 'onDeleteGroup'
>

type GroupListProps = Omit<FinishedViewProps, 'finished' | 'finishedByLibrary'> & {
  groups: readonly ShownGroup[]
}

const GroupList = ({ groups, onPlay, onPlayGroup, onDelete, onDeleteGroup }: GroupListProps) =>
  groups.map((group) => (
    <FinishedGroupView
      key={group.key}
      group={group}
      onDelete={onDelete}
      onDeleteGroup={onDeleteGroup}
      onPlay={onPlay}
      onPlayGroup={onPlayGroup}
    />
  ))

/** Every finished group in one list, newest first. */
const AllFinished = ({ finished, ...handlers }: FinishedViewProps) => (
  <GroupList groups={finished} {...handlers} />
)

type LibraryHeadingProps = Pick<ShownLibrarySection, 'name' | 'icon'>

/** A library's name with its icon, over its groups. */
const LibraryHeading = ({ name, icon }: LibraryHeadingProps) => {
  const styles = useStyles()
  const text = useTheme((theme) => theme.palette.text)
  return (
    <View style={styles.libraryHeading}>
      {icon !== null && <Icon colour={text} name={icon} size={SIZES.textLg} />}
      <Text accessibilityRole="header" numberOfLines={1} style={styles.libraryName}>
        {name}
      </Text>
    </View>
  )
}

/** The finished groups under each library's heading, the library-less last under Other. */
const LibraryFinished = ({ finishedByLibrary, ...handlers }: FinishedViewProps) => {
  const styles = useStyles()
  return finishedByLibrary.map((section) => (
    <View key={section.key} style={styles.section}>
      <LibraryHeading icon={section.icon} name={section.name} />
      <GroupList groups={section.groups} {...handlers} />
    </View>
  ))
}

const FINISHED_VIEWS = {
  [DOWNLOAD_GROUPINGS.all]: AllFinished,
  [DOWNLOAD_GROUPINGS.byLibrary]: LibraryFinished,
} as const satisfies Record<DownloadsGrouping, ComponentType<FinishedViewProps>>

/**
 * Downloads under the thumb: the space left on the device and what the downloads take, then
 * those on their way with their bars, bytes and speed, the queue dragged into another order by
 * its handles, then what is on the device by group, all in one list or under each library,
 * each with its picture, Play and Delete, and Delete all at the end.
 */
const DownloadsLayout = ({
  available,
  used,
  speed,
  underway,
  finished,
  finishedByLibrary,
  grouping,
  onGrouping,
  onCancel,
  onRetry,
  onMove,
  onPlay,
  onPlayGroup,
  onDelete,
  onDeleteGroup,
  onDeleteAll,
  onBack,
}: DownloadsLayoutProps) => {
  const insets = useSafeAreaInsets()
  const { fontScale } = useWindowDimensions()
  const styles = useStyles()
  const [isDragging, setDragging] = useState(false)
  const isEmpty = underway.length === 0 && finished.length === 0
  const rowHeight = underwayHeightOf(fontScale)
  // The one coming in stays first; only the queued rows after it move.
  const pinnedCount = underway.findIndex((row) => row.isQueued)
  const queuedCount = underway.filter((row) => row.isQueued).length
  const FinishedView = FINISHED_VIEWS[grouping]
  const { Picker } = touchPicker
  return (
    <ScrollView
      scrollEnabled={!isDragging}
      contentContainerStyle={[
        styles.page,
        {
          paddingTop: insets.top + SIZES.space3,
          paddingBottom: insets.bottom + SIZES.space8,
          paddingLeft: insets.left + SIZES.space4,
          paddingRight: insets.right + SIZES.space4,
        },
      ]}
      style={styles.ground}
    >
      <TouchNav onBack={onBack} />
      <View style={styles.section}>
        <Text accessibilityRole="header" variant={TEXT_VARIANTS.display} style={styles.title}>
          {DOWNLOAD_COPY.title}
        </Text>
        <Text style={styles.space}>
          {[available, used].filter((part) => part !== null).join(DOWNLOAD_COPY.separator)}
        </Text>
      </View>
      {isEmpty && <Text style={styles.muted}>{DOWNLOAD_COPY.none}</Text>}
      {underway.length > 0 && (
        <View style={styles.section}>
          <View style={styles.headingRow}>
            <Text accessibilityRole="header" style={styles.heading}>
              {DOWNLOAD_COPY.underway}
            </Text>
            {speed !== null && <Text style={styles.speed}>{speed}</Text>}
          </View>
          <SortableList
            gap={SIZES.space3}
            keyOf={(row) => row.key}
            movableCount={queuedCount}
            onDragChange={setDragging}
            onMove={onMove}
            pinnedCount={pinnedCount === -1 ? underway.length : pinnedCount}
            renderRow={(row) => (
              <UnderwayEntry height={rowHeight} onCancel={onCancel} onRetry={onRetry} row={row} />
            )}
            rowHeight={rowHeight}
            rows={underway}
          />
        </View>
      )}
      {finished.length > 0 && (
        <View style={styles.section}>
          <View style={styles.headingRow}>
            <Text accessibilityRole="header" style={styles.heading}>
              {DOWNLOAD_COPY.finished}
            </Text>
            <Picker
              icon={APP_ICONS.libraries}
              isIconOnly
              label={DOWNLOAD_COPY.show}
              onChoose={onGrouping}
              options={GROUPING_OPTIONS}
              value={grouping}
            />
          </View>
          <FinishedView
            finished={finished}
            finishedByLibrary={finishedByLibrary}
            onDelete={onDelete}
            onDeleteGroup={onDeleteGroup}
            onPlay={onPlay}
            onPlayGroup={onPlayGroup}
          />
        </View>
      )}
      {!isEmpty && (
        <Pressable
          accessibilityRole="button"
          onPress={onDeleteAll}
          style={({ pressed }) => [styles.deleteAll, pressed && styles.pressed]}
        >
          <Text style={styles.deleteAllLabel}>{DOWNLOAD_COPY.deleteAll}</Text>
        </Pressable>
      )}
    </ScrollView>
  )
}

const useStyles = themedStyles((colours) =>
  StyleSheet.create({
    ground: { flex: 1, backgroundColor: colours.ground },
    page: { gap: SIZES.space5 },
    section: { gap: SIZES.space3 },
    title: { color: colours.text, fontSize: SIZES.textXl },
    space: { color: colours.muted, fontSize: SIZES.text },
    headingRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
    heading: { color: colours.text, fontSize: SIZES.textLg, fontWeight: '600' },
    speed: { color: colours.accent, fontSize: SIZES.text, fontWeight: '600' },
    muted: { color: colours.muted, fontSize: SIZES.textSm, lineHeight: SIZES.textSm * LINE_RATIO },
    libraryHeading: { flexDirection: 'row', alignItems: 'center', gap: SIZES.space2 },
    libraryName: { flex: 1, color: colours.text, fontSize: SIZES.text, fontWeight: '600' },
    deleteAll: {
      alignSelf: 'flex-start',
      minHeight: SIZES.fieldHeight,
      justifyContent: 'center',
      paddingHorizontal: SIZES.space3,
      borderRadius: SIZES.radius,
      borderWidth: 1,
      borderColor: colours.line,
    },
    deleteAllLabel: { color: colours.error, fontSize: SIZES.text, fontWeight: '600' },
    pressed: { opacity: OPACITIES.pressed },
  }),
)

export const touchDownloads: DownloadsKit = { DownloadsLayout, canDownload: CAN_DOWNLOAD.touch }
