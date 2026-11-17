import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'

import { LIBRARY_PAGE_COPY } from '@/screens/copy'
import { LIST_SORT_LABELS, LIST_SORT_ORDER, type ListSort } from '@/screens/library/sorts'
import { type WrenTheme, themedStyles, useFormFactor, useWrenTheme } from '@/theme/wrenTheme'
import { FORM_FACTORS, RADIUS, SIZE, SPACE, TYPE } from '@/theme/wrenTokens'
import { BottomSheet } from '@/ui/BottomSheet'
import { pressedStyleOf } from '@/ui/press'
import { ICONS, WrenIcon } from '@/ui/WrenIcon'

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  button: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACE.s2,
    minHeight: SIZE.touchTarget,
  },
  options: { paddingVertical: SPACE.s2 },
  option: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACE.s3,
    minHeight: SIZE.navRow,
    paddingHorizontal: SPACE.s3,
  },
  optionLabel: { ...TYPE.rowTitle, color: colors.text, flex: 1 },
  chosen: { color: colors.accentText },
}))

type SortButtonProps = { sort: ListSort; onSort: (sort: ListSort) => void }

// A red link on a phone; an outlined button on a tablet.
const useButtonStyles = themedStyles(({ colors }: WrenTheme) => ({
  [FORM_FACTORS.phone]: {},
  [FORM_FACTORS.tablet]: {
    borderColor: colors.line2,
    borderRadius: RADIUS.md,
    borderWidth: SIZE.hairline,
    paddingHorizontal: SPACE.s4,
  },
}))

const useLabelStyles = themedStyles(({ colors }: WrenTheme) => ({
  [FORM_FACTORS.phone]: { ...TYPE.rowTitle, color: colors.accentText },
  [FORM_FACTORS.tablet]: { ...TYPE.rowTitle, color: colors.text },
}))

/**
 * The sort a list is in, as a red link on a phone and an outlined button on a tablet. A press
 * opens a sheet of the sorts, the one in use checked.
 */
export function SortButton({ sort, onSort }: SortButtonProps) {
  const styles = useStyles()
  const buttonStyles = useButtonStyles()
  const labelStyles = useLabelStyles()
  const formFactor = useFormFactor()
  const { colors } = useWrenTheme()
  const [isOpen, setIsOpen] = useState(false)
  const label = LIST_SORT_LABELS[sort]
  const labelStyle = labelStyles[formFactor]
  const choose = (next: ListSort) => {
    onSort(next)
    setIsOpen(false)
  }
  return (
    <>
      <Pressable
        accessibilityLabel={LIBRARY_PAGE_COPY.sortLabel(label)}
        accessibilityRole="button"
        hitSlop={SPACE.s2}
        onPress={() => setIsOpen(true)}
        style={pressedStyleOf({ style: [styles.button, buttonStyles[formFactor]] })}
      >
        <WrenIcon color={labelStyle.color} name={ICONS.sort} size={SIZE.smallIcon} />
        <Text style={labelStyle}>{label}</Text>
      </Pressable>
      <BottomSheet
        head={{ title: LIBRARY_PAGE_COPY.sortBy }}
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
      >
        <View style={styles.options}>
          {LIST_SORT_ORDER.map((option) => (
            <Pressable
              accessibilityLabel={LIST_SORT_LABELS[option]}
              accessibilityRole="radio"
              accessibilityState={{ checked: option === sort }}
              key={option}
              onPress={() => choose(option)}
              style={pressedStyleOf({ style: styles.option })}
            >
              <Text style={[styles.optionLabel, option === sort && styles.chosen]}>
                {LIST_SORT_LABELS[option]}
              </Text>
              {option === sort && (
                <WrenIcon color={colors.accentText} name={ICONS.check} size={SIZE.smallIcon} />
              )}
            </Pressable>
          ))}
        </View>
      </BottomSheet>
    </>
  )
}
