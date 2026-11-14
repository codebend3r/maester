import { Icon } from '@raven/native'
import type { IconName } from '@raven/ui/iconDrawings'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import {
  Animated,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { PINNED_HEADING, SETTINGS_ENTRY } from '@/layouts/shelfKit'
import { SCRIM_OPACITY, SWIPE_START, slide } from '@/layouts/slide'
import { Text, TEXT_VARIANTS } from '@/layouts/Text'
import { TOUCH_NAV_COPY, isDroppedBy } from '@/layouts/touchMenuKit'
import { MORE_COLUMNS, TOUCH_TABS_COPY } from '@/layouts/touchTabsKit'
import { useMenuGo } from '@/layouts/useMenuGo'
import { pinnedLibrariesOf } from '@/queries/pinnedLibraries'
import type { AppQueries } from '@/queries/useAppQueries'
import { APP_ROUTES, type Href, ROUTE_TARGETS, hrefOf, searchHrefOf } from '@/routes'
import { useReduceMotion } from '@/stores/reduceMotion'
import { OPACITIES, SIZES } from '@/theme/appTheme'
import { themedStyles, useTheme } from '@/theme/useTheme'
import { APP_ICONS } from '@/theme/icons'

/** The sheet's tallest, as a share of the room above the bar. */
const SHEET_MAX_SHARE = '85%'

/** The drag handle's size at the sheet's top. */
const HANDLE = { width: 36, height: 4 } as const

type MoreTileProps = { icon: IconName; label: string; width: number; onPress: () => void }

/** One tile of the More sheet: its icon over its name. */
const MoreTile = ({ icon, label, width, onPress }: MoreTileProps) => {
  const styles = useStyles()
  const text = useTheme((theme) => theme.palette.text)
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="link"
      onPress={onPress}
      style={({ pressed }) => [styles.tile, { width }, pressed && styles.pressed]}
    >
      <Icon colour={text} name={icon} size={SIZES.textXl} />
      <Text numberOfLines={2} style={styles.tileLabel}>
        {label}
      </Text>
    </Pressable>
  )
}

type TouchMoreSheetProps = {
  session: AppQueries
  isOpen: boolean
  /** How tall the bar under the sheet stands, which the sheet and its scrim keep clear of. */
  barHeight: number
  onClose: () => void
}

/**
 * The More sheet, up from the bar over a dimmed scrim that shuts it when pressed: a handle,
 * its heading, Search, Binge, Downloads and Settings, then the pinned libraries. A swipe down, an entry or the
 * accessibility escape shuts it too. It is drawn only while up or sliding.
 */
export const TouchMoreSheet = ({
  session: { queries },
  isOpen,
  barHeight,
  onClose,
}: TouchMoreSheetProps) => {
  const window = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const isReduced = useReduceMotion((motion) => motion.isReduced)
  const libraries = useQuery(queries.librariesQuery)
  const go = useMenuGo()
  const [progress] = useState(() => new Animated.Value(0))
  const [isDrawn, setDrawn] = useState(false)
  const scrimStyles = useStyles({ isOverPicture: true })
  const styles = useStyles()
  const pinned = pinnedLibrariesOf(libraries.data ?? [])

  // Opening draws the sheet in this render, so the slide has it to move.
  if (isOpen && !isDrawn) setDrawn(true)

  useEffect(() => {
    // Open, but not drawn yet: the slide starts once the sheet is there to move.
    if (isOpen && !isDrawn) return
    slide({ progress, to: isOpen ? 1 : 0, isReduced, onShut: () => setDrawn(false) })
  }, [isOpen, isDrawn, isReduced, progress])

  const swipeDown = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, { dx, dy }) =>
          dy > SWIPE_START && Math.abs(dy) > Math.abs(dx),
        onPanResponderRelease: (_, { dy, vy }) => {
          if (isDroppedBy({ dy, vy })) onClose()
        },
      }),
    [onClose],
  )

  const room = window.width - insets.left - insets.right - SIZES.space3 * 2
  const tileWidth = Math.floor((room - SIZES.space2 * (MORE_COLUMNS - 1)) / MORE_COLUMNS)
  const choose = (href: Href) => {
    onClose()
    go(href)
  }

  return (
    isDrawn && (
      <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { bottom: barHeight }]}>
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            scrimStyles.scrim,
            {
              opacity: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [0, SCRIM_OPACITY],
              }),
            },
          ]}
        >
          <Pressable
            accessibilityLabel={TOUCH_TABS_COPY.closeMore}
            accessibilityRole="button"
            onPress={onClose}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
        <Animated.View
          {...swipeDown.panHandlers}
          accessibilityLabel={TOUCH_TABS_COPY.moreSheet}
          accessibilityViewIsModal
          onAccessibilityEscape={onClose}
          style={[
            styles.sheet,
            {
              paddingLeft: insets.left + SIZES.space3,
              paddingRight: insets.right + SIZES.space3,
              transform: [
                {
                  translateY: progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [window.height, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <View accessibilityElementsHidden importantForAccessibility="no" style={styles.handle} />
          <Text variant={TEXT_VARIANTS.display} accessibilityRole="header" style={styles.title}>
            {TOUCH_TABS_COPY.more}
          </Text>
          <ScrollView contentContainerStyle={styles.sheetContent} style={styles.sheetScroll}>
            <View style={styles.tiles}>
              <MoreTile
                icon={APP_ICONS.search}
                label={TOUCH_TABS_COPY.search}
                width={tileWidth}
                onPress={() => choose(searchHrefOf(''))}
              />
              <MoreTile
                icon={APP_ICONS.popcorn}
                label={TOUCH_NAV_COPY.binge}
                onPress={() => choose({ pathname: APP_ROUTES.binge, params: {} })}
                width={tileWidth}
              />
              <MoreTile
                icon={APP_ICONS.download}
                label={TOUCH_NAV_COPY.downloads}
                onPress={() => choose({ pathname: APP_ROUTES.downloads, params: {} })}
                width={tileWidth}
              />
              <MoreTile
                icon={APP_ICONS.settings}
                label={SETTINGS_ENTRY.label}
                width={tileWidth}
                onPress={() => choose({ pathname: APP_ROUTES.settings, params: {} })}
              />
            </View>
            {pinned.length > 0 && (
              <>
                <Text accessibilityRole="header" style={styles.heading}>
                  {PINNED_HEADING}
                </Text>
                <View style={styles.tiles}>
                  {pinned.map((library) => (
                    <MoreTile
                      key={library.id}
                      icon={library.icon}
                      label={library.name}
                      width={tileWidth}
                      onPress={() =>
                        choose(
                          hrefOf({ kind: ROUTE_TARGETS.library, libraryId: library.id, query: '' }),
                        )
                      }
                    />
                  ))}
                </View>
              </>
            )}
          </ScrollView>
        </Animated.View>
      </View>
    )
  )
}

const useStyles = themedStyles((colours) =>
  StyleSheet.create({
    scrim: { backgroundColor: colours.ground },
    sheet: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      maxHeight: SHEET_MAX_SHARE,
      gap: SIZES.space2,
      paddingTop: SIZES.space2,
      backgroundColor: colours.ground,
      borderTopLeftRadius: SIZES.radiusLg,
      borderTopRightRadius: SIZES.radiusLg,
      borderTopWidth: 1,
      borderTopColor: colours.line,
    },
    handle: {
      alignSelf: 'center',
      width: HANDLE.width,
      height: HANDLE.height,
      borderRadius: SIZES.radiusPill,
      backgroundColor: colours.line,
    },
    title: { color: colours.text, fontSize: SIZES.textXl },
    sheetScroll: { flexGrow: 0, flexShrink: 1 },
    sheetContent: { gap: SIZES.space2, paddingBottom: SIZES.space4 },
    tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: SIZES.space2 },
    tile: {
      alignItems: 'center',
      justifyContent: 'center',
      gap: SIZES.space1,
      minHeight: SIZES.fieldHeight * 2,
      padding: SIZES.space2,
      borderRadius: SIZES.radius,
      backgroundColor: colours.raised,
    },
    tileLabel: {
      color: colours.text,
      fontSize: SIZES.textSm,
      fontWeight: '600',
      textAlign: 'center',
    },
    heading: {
      color: colours.muted,
      fontSize: SIZES.textSm,
      fontWeight: '600',
      paddingTop: SIZES.space2,
    },
    pressed: { opacity: OPACITIES.pressed },
  }),
)
