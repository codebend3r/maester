import { type Chapter, formatDuration, chapterAt } from '@raven/core'
import { type ComponentRef, useRef } from 'react'
import { Pressable, ScrollView, StyleSheet } from 'react-native'

import { Icon } from '@raven/native'
import { FocusBand } from '@/layouts/FocusBand'
import { useFocusOnMount } from '@/layouts/focus'
import { PLAYER_COPY } from '@/layouts/playerKit'
import { Text, TEXT_VARIANTS } from '@/layouts/Text'
import { LINE_RATIO } from '@/layouts/textHeights'
import { TV_SIZES, tvSize } from '@/theme/tvSizes'
import { pictureStyles, useTheme } from '@/theme/useTheme'
import { APP_ICONS } from '@/theme/icons'

/** How wide a chapter's tile stands in the row. */
const TILE_WIDTH = tvSize(320)

type ChapterNameOfProps = { chapter: Chapter; place: number }

/** What a chapter is called: its own title, else its place, "Chapter 3". */
const chapterNameOf = ({ chapter, place }: ChapterNameOfProps): string =>
  chapter.title ?? PLAYER_COPY.chapter(place + 1)

type ChapterTileProps = {
  chapter: Chapter
  place: number
  isCurrent: boolean
  onChoose: (start: number) => void
}

/** One chapter: its place, its name and where it starts; the one playing takes the focus as the row opens. */
const ChapterTile = ({ chapter, place, isCurrent, onChoose }: ChapterTileProps) => {
  const tile = useRef<ComponentRef<typeof Pressable>>(null)
  useFocusOnMount({ view: tile, isAsked: isCurrent })
  const styles = usePictureStyles()
  const name = chapterNameOf({ chapter, place })
  const at = formatDuration(chapter.start)
  return (
    <Pressable
      ref={tile}
      accessibilityLabel={PLAYER_COPY.chapterLabel({ name, at })}
      accessibilityRole="button"
      accessibilityState={{ selected: isCurrent }}
      onPress={() => onChoose(chapter.start)}
      style={({ focused }) => [styles.tile, isCurrent && styles.current, focused && styles.focused]}
    >
      <Text style={styles.place}>{String(place + 1)}</Text>
      <Text variant={TEXT_VARIANTS.display} numberOfLines={2} style={styles.name}>
        {name}
      </Text>
      <Text style={styles.at}>{at}</Text>
    </Pressable>
  )
}

type ChaptersBandProps = {
  chapters: readonly Chapter[]
  /** Where the video is, so the chapter playing is marked and takes the focus as the row opens. */
  position: number
  isOpen: boolean
  onOpen: () => void
  onChoose: (start: number) => void
}

/**
 * The chapters below the player's buttons on a TV. Folded, a slim Chapters strip, which Down from
 * the buttons reaches through the focus engine; reached, it opens into the row of chapters with
 * the remote on the one playing, left and right to move along them and select to jump there.
 * Nothing is drawn for a file without chapters.
 */
export const ChaptersBand = ({
  chapters,
  position,
  isOpen,
  onOpen,
  onChoose,
}: ChaptersBandProps) => {
  const styles = usePictureStyles()
  const text = useTheme((theme) => theme.overPicture.muted)
  const current = chapterAt({ chapters, at: position })
  return (
    chapters.length > 0 && (
      <FocusBand>
        {isOpen && (
          <ScrollView
            accessibilityLabel={PLAYER_COPY.chapters}
            contentContainerStyle={styles.row}
            horizontal
            showsHorizontalScrollIndicator={false}
          >
            {chapters.map((chapter, place) => (
              <ChapterTile
                key={`${chapter.start}`}
                chapter={chapter}
                isCurrent={place === (current ?? 0)}
                onChoose={onChoose}
                place={place}
              />
            ))}
          </ScrollView>
        )}
        {!isOpen && (
          <Pressable
            accessibilityLabel={PLAYER_COPY.chapters}
            accessibilityRole="button"
            onFocus={onOpen}
            onPress={onOpen}
            style={styles.strip}
          >
            <Icon colour={text} name={APP_ICONS.down} size={TV_SIZES.text} />
            <Text style={styles.stripLabel}>{PLAYER_COPY.chapters}</Text>
          </Pressable>
        )}
      </FocusBand>
    )
  )
}

const usePictureStyles = pictureStyles((colours) =>
  StyleSheet.create({
    row: { gap: TV_SIZES.space3, paddingVertical: TV_SIZES.space1 },
    tile: {
      width: TILE_WIDTH,
      gap: TV_SIZES.space1,
      padding: TV_SIZES.space3,
      borderRadius: TV_SIZES.radius,
      borderWidth: TV_SIZES.tvFocusRing,
      borderColor: 'transparent',
      backgroundColor: colours.raised,
    },
    current: { backgroundColor: colours.quiet },
    focused: { borderColor: colours.text },
    place: { color: colours.muted, fontSize: TV_SIZES.textSm, fontVariant: ['tabular-nums'] },
    name: {
      color: colours.text,
      fontSize: TV_SIZES.text,
      lineHeight: TV_SIZES.text * LINE_RATIO,
    },
    at: { color: colours.muted, fontSize: TV_SIZES.textSm, fontVariant: ['tabular-nums'] },
    strip: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'center',
      gap: TV_SIZES.space2,
      paddingHorizontal: TV_SIZES.space3,
      paddingVertical: TV_SIZES.space1,
      borderRadius: TV_SIZES.radiusPill,
    },
    stripLabel: { color: colours.muted, fontSize: TV_SIZES.textSm },
  }),
)
