import { Icon } from '@raven/native'
import { Pressable, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Chip } from '@/layouts/Chip.touch'
import { LibraryBackdrop, LibraryCardLines } from '@/layouts/libraryCardParts'
import type { LibrariesKit, LibrariesPageProps, LibraryCardProps } from '@/layouts/librariesKit'
import { HomeScrollView } from '@/layouts/ScrollHome.touch'
import { Text, TEXT_VARIANTS } from '@/layouts/Text'
import { TouchNav } from '@/layouts/TouchNav'
import { OPACITIES, SIZES } from '@/theme/appTheme'
import { APP_ICONS } from '@/theme/icons'
import { themedStyles, useTheme } from '@/theme/useTheme'

/** The web's Libraries page under the thumb: its title and counts over the cards, stacked full width. */
const LibrariesPage = ({ title, line, notice, onBack, children }: LibrariesPageProps) => {
  const insets = useSafeAreaInsets()
  const styles = useStyles()
  return (
    <HomeScrollView
      contentContainerStyle={[
        styles.page,
        {
          paddingTop: insets.top + SIZES.space2,
          paddingBottom: insets.bottom + SIZES.space5,
          paddingLeft: insets.left + SIZES.space3,
          paddingRight: insets.right + SIZES.space3,
        },
      ]}
      style={styles.ground}
    >
      <TouchNav onBack={onBack} />
      <View style={styles.heading}>
        <Text variant={TEXT_VARIANTS.display} accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
        {line !== null && <Text style={styles.summary}>{line}</Text>}
      </View>
      {notice !== null && <Text style={styles.notice}>{notice}</Text>}
      <View style={styles.list}>{children}</View>
    </HomeScrollView>
  )
}

/**
 * A library's card, the web's: its icon in a well beside its name and counts, pressed to open
 * the library, the chevron at its right, and once opened how its work stands and its buttons,
 * each an icon with its words. Its newest video's picture fades in at its right.
 */
const LibraryCard = ({
  name,
  icon,
  line,
  picture,
  isOpen,
  toggle,
  onOpen,
  lines,
  actions,
}: LibraryCardProps) => {
  const styles = useStyles()
  const { raised, text } = useTheme((theme) => theme.palette)
  return (
    <View style={styles.card}>
      {picture !== null && <LibraryBackdrop ground={raised} picture={picture} />}
      <View style={styles.details}>
        <View style={styles.head}>
          <Pressable
            accessibilityLabel={name}
            accessibilityRole="button"
            onPress={onOpen}
            style={({ pressed }) => [styles.opener, pressed && styles.pressed]}
          >
            <View style={styles.well}>
              <Icon colour={text} name={icon} size={SIZES.textXl} />
            </View>
            <View style={styles.words}>
              <Text variant={TEXT_VARIANTS.display} style={styles.name}>
                {name}
              </Text>
              <Text style={styles.line}>{line}</Text>
            </View>
          </Pressable>
          {toggle !== null && (
            <Pressable
              accessibilityLabel={toggle.name}
              accessibilityRole="button"
              accessibilityState={{ expanded: isOpen }}
              onPress={toggle.onPress}
              style={({ pressed }) => [styles.toggle, pressed && styles.pressed]}
            >
              <View style={isOpen && styles.turned}>
                <Icon colour={text} name={APP_ICONS.expand} size={SIZES.text} />
              </View>
            </Pressable>
          )}
        </View>
        {isOpen && (
          <View style={styles.more}>
            <LibraryCardLines lines={lines} style={styles.line} />
            {actions.length > 0 && (
              <View style={styles.actions}>
                {actions.map((action) => (
                  <Chip
                    key={action.key}
                    icon={action.icon}
                    isDisabled={action.isDisabled}
                    label={action.name}
                    onPress={action.onPress}
                    text={action.text}
                  />
                ))}
              </View>
            )}
          </View>
        )}
      </View>
    </View>
  )
}

/** Libraries on a phone or tablet: one page under the thumb, the cards stacked full width. */
export const touchLibraries: LibrariesKit = { LibrariesPage, LibraryCard }

const useStyles = themedStyles((colours) =>
  StyleSheet.create({
    ground: { flex: 1, backgroundColor: colours.ground },
    page: { gap: SIZES.space4 },
    heading: { gap: SIZES.space1 },
    title: { color: colours.text, fontSize: SIZES.textXl },
    summary: { color: colours.muted, fontSize: SIZES.text },
    notice: { color: colours.muted, fontSize: SIZES.text },
    list: { gap: SIZES.space2 },
    card: {
      overflow: 'hidden',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colours.line,
      borderRadius: SIZES.radiusLg,
      backgroundColor: colours.raised,
    },
    details: { gap: SIZES.space2, padding: SIZES.space4 },
    head: { flexDirection: 'row', alignItems: 'center', gap: SIZES.space3 },
    opener: { flexDirection: 'row', alignItems: 'center', gap: SIZES.space3, flex: 1 },
    well: {
      width: SIZES.controlLarge,
      height: SIZES.controlLarge,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: SIZES.radiusLg,
      backgroundColor: colours.quiet,
    },
    words: { flexShrink: 1, gap: SIZES.space0 },
    name: { color: colours.text, fontSize: SIZES.textXl },
    line: { color: colours.muted, fontSize: SIZES.textSm },
    toggle: {
      width: SIZES.fieldHeight,
      height: SIZES.fieldHeight,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: SIZES.radius,
    },
    turned: { transform: [{ rotate: '180deg' }] },
    more: { gap: SIZES.space2, paddingTop: SIZES.space2 },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: SIZES.space2 },
    pressed: { opacity: OPACITIES.pressed },
  }),
)
