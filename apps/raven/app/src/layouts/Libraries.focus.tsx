import { Icon } from '@raven/native'
import { type ComponentRef, useRef } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { FocusBand } from '@/layouts/FocusBand'
import { HomePlate } from '@/layouts/HomePlate.focus'
import {
  useFocusOnMount,
  useOpenerFocus,
  useOpeningFocus,
  useScreenFocusScope,
} from '@/layouts/focus'
import { LibraryBackdrop, LibraryCardLines } from '@/layouts/libraryCardParts'
import type {
  LibrariesKit,
  LibrariesPageProps,
  LibraryCardAction,
  LibraryCardPin,
  LibraryCardProps,
} from '@/layouts/librariesKit'
import { Text, TEXT_VARIANTS } from '@/layouts/Text'
import { usePlateStyles } from '@/layouts/tvControls'
import { OPACITIES } from '@/theme/appTheme'
import { APP_ICONS } from '@/theme/icons'
import { TV_GUTTER, TV_SIZES } from '@/theme/tvSizes'
import { themedStyles, useTheme } from '@/theme/useTheme'

/**
 * The web's Libraries page on a TV: the Home plate, the title and counts, and the cards stacked
 * full width within the title-safe margin, the remote opening on the first card's name.
 */
const LibrariesPage = ({ title, line, notice, children }: LibrariesPageProps) => {
  useScreenFocusScope()
  const styles = useStyles()
  return (
    <ScrollView contentContainerStyle={styles.page} style={styles.ground}>
      <HomePlate />
      <View style={styles.heading}>
        <Text variant={TEXT_VARIANTS.display} accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
        {line !== null && <Text style={styles.summary}>{line}</Text>}
      </View>
      {notice !== null && <Text style={styles.notice}>{notice}</Text>}
      <View style={styles.list}>{children}</View>
    </ScrollView>
  )
}

type ActionPlateProps = { action: LibraryCardAction }

/** One of a card's buttons as a plate: the web's icon and its words, faint and passed by while it can do nothing. */
const ActionPlate = ({ action }: ActionPlateProps) => {
  const { settle } = useOpeningFocus()
  const styles = useStyles()
  const plateStyles = usePlateStyles()
  const text = useTheme((theme) => theme.palette.text)
  return (
    <Pressable
      accessibilityLabel={action.name}
      accessibilityRole="button"
      accessibilityState={{ disabled: action.isDisabled }}
      disabled={action.isDisabled}
      focusable={!action.isDisabled}
      onFocus={settle}
      onPress={action.onPress}
      style={({ focused }) => [
        plateStyles.plate,
        focused && plateStyles.focused,
        action.isDisabled && styles.off,
      ]}
    >
      {({ focused }) => (
        <>
          <Icon colour={text} isFocused={focused} name={action.icon} size={TV_SIZES.textLg} />
          <Text style={plateStyles.label}>{action.text}</Text>
        </>
      )}
    </Pressable>
  )
}

type PinPlateProps = { pin: LibraryCardPin }

/** Pin as a plate beside a card's name, the web's toggle: filled while the library is pinned, passed by while the account can pin no more. */
const PinPlate = ({ pin }: PinPlateProps) => {
  const { settle } = useOpeningFocus()
  const styles = useStyles()
  const plateStyles = usePlateStyles()
  const text = useTheme((theme) => theme.palette.text)
  return (
    <Pressable
      accessibilityLabel={pin.name}
      accessibilityRole="button"
      accessibilityState={{ selected: pin.isPinned, disabled: pin.isDisabled }}
      disabled={pin.isDisabled}
      focusable={!pin.isDisabled}
      onFocus={settle}
      onPress={pin.onPress}
      style={({ focused }) => [
        plateStyles.plate,
        pin.isPinned && styles.pinned,
        focused && plateStyles.focused,
        pin.isDisabled && styles.off,
      ]}
    >
      {({ focused }) => (
        <>
          <Icon colour={text} isFocused={focused} name={APP_ICONS.pin} size={TV_SIZES.textLg} />
          <Text style={plateStyles.label}>{pin.text}</Text>
        </>
      )}
    </Pressable>
  )
}

/**
 * A library's card on a TV: its name and counts beside its icon on one plate the remote presses
 * to open the library, which takes the focus back on the way out of it, and Pin and the chevron
 * beside it; open, how its work stands and a row of its buttons, a band of their own.
 */
const LibraryCard = ({
  place,
  name,
  icon,
  line,
  picture,
  isFirst,
  isOpen,
  toggle,
  pin,
  onOpen,
  lines,
  actions,
}: LibraryCardProps) => {
  const view = useRef<ComponentRef<typeof Pressable>>(null)
  const { remember } = useOpenerFocus({ place, view })
  const { isOpening, settle } = useOpeningFocus()
  // On Android TV `hasTVPreferredFocus` alone asks before the plate is in the window.
  useFocusOnMount({ view, isAsked: isFirst && isOpening })
  const styles = useStyles()
  const plateStyles = usePlateStyles()
  const { raised, text } = useTheme((theme) => theme.palette)
  return (
    <View style={styles.card}>
      {picture !== null && <LibraryBackdrop ground={raised} picture={picture} />}
      <View style={styles.details}>
        <FocusBand>
          <View style={styles.head}>
            <Pressable
              ref={view}
              accessibilityLabel={name}
              accessibilityRole="button"
              hasTVPreferredFocus={isFirst && isOpening}
              onFocus={settle}
              onPress={() => {
                remember()
                onOpen()
              }}
              style={({ focused }) => [styles.opener, focused && plateStyles.focused]}
            >
              {({ focused }) => (
                <>
                  <View style={styles.well}>
                    <Icon colour={text} isFocused={focused} name={icon} size={TV_SIZES.textXl} />
                  </View>
                  <View style={styles.words}>
                    <Text variant={TEXT_VARIANTS.display} style={styles.name}>
                      {name}
                    </Text>
                    <Text style={styles.line}>{line}</Text>
                  </View>
                </>
              )}
            </Pressable>
            {pin !== null && <PinPlate pin={pin} />}
            {toggle !== null && (
              <Pressable
                accessibilityLabel={toggle.name}
                accessibilityRole="button"
                accessibilityState={{ expanded: isOpen }}
                onFocus={settle}
                onPress={toggle.onPress}
                style={({ focused }) => [plateStyles.plate, focused && plateStyles.focused]}
              >
                {({ focused }) => (
                  <View style={isOpen && styles.turned}>
                    <Icon
                      colour={text}
                      isFocused={focused}
                      name={APP_ICONS.expand}
                      size={TV_SIZES.textXl}
                    />
                  </View>
                )}
              </Pressable>
            )}
          </View>
        </FocusBand>
        {isOpen && (
          <View style={styles.more}>
            <LibraryCardLines lines={lines} style={styles.line} />
            {actions.length > 0 && (
              <FocusBand>
                <View style={styles.actions}>
                  {actions.map((action) => (
                    <ActionPlate key={action.key} action={action} />
                  ))}
                </View>
              </FocusBand>
            )}
          </View>
        )}
      </View>
    </View>
  )
}

/** Libraries on a TV: cards the remote moves down through, each a plate and its buttons. */
export const focusLibraries: LibrariesKit = { LibrariesPage, LibraryCard }

const useStyles = themedStyles((colours) =>
  StyleSheet.create({
    ground: { flex: 1, backgroundColor: colours.ground },
    page: {
      gap: TV_SIZES.space5,
      paddingVertical: TV_SIZES.space6,
      paddingHorizontal: TV_GUTTER,
    },
    heading: { gap: TV_SIZES.space1 },
    title: { color: colours.text, fontSize: TV_SIZES.textXl },
    summary: { color: colours.muted, fontSize: TV_SIZES.text },
    notice: { color: colours.muted, fontSize: TV_SIZES.text },
    list: { gap: TV_SIZES.space3 },
    card: {
      overflow: 'hidden',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colours.line,
      borderRadius: TV_SIZES.radiusLg,
      backgroundColor: colours.raised,
    },
    details: { gap: TV_SIZES.space3, padding: TV_SIZES.space4 },
    head: { flexDirection: 'row', alignItems: 'center', gap: TV_SIZES.space3 },
    opener: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: TV_SIZES.space3,
      padding: TV_SIZES.space2,
      borderWidth: TV_SIZES.tvFocusRing,
      borderColor: 'transparent',
      borderRadius: TV_SIZES.radiusLg,
    },
    well: {
      width: TV_SIZES.controlLarge,
      height: TV_SIZES.controlLarge,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: TV_SIZES.radiusLg,
      backgroundColor: colours.quiet,
    },
    words: { flexShrink: 1, gap: TV_SIZES.space0 },
    name: { color: colours.text, fontSize: TV_SIZES.textXl },
    line: { color: colours.muted, fontSize: TV_SIZES.text },
    turned: { transform: [{ rotate: '180deg' }] },
    more: { gap: TV_SIZES.space2 },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: TV_SIZES.space2 },
    off: { opacity: OPACITIES.disabled },
    pinned: { backgroundColor: colours.quiet },
  }),
)
