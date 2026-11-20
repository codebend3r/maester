import { type ReactNode, useRef } from 'react'
import {
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { footSheetPanelOf } from '@/layouts/footSheet'
import { CANCEL } from '@/layouts/gridKit'
import { SCRIM_OPACITY } from '@/layouts/slide'
import { Text, TEXT_VARIANTS } from '@/layouts/Text'
import {
  type ChoiceSheet,
  DRAWN_SHEETS,
  type PromptSheet,
  useDrawnSheet,
} from '@/stores/drawnSheet'
import { useReduceMotion } from '@/stores/reduceMotion'
import { OPACITIES, SIZES } from '@/theme/appTheme'
import { themedStyles } from '@/theme/useTheme'

/** What the scrim behind a sheet is called by the screen reader, which shuts the sheet. */
const DRAWN_SHEET_COPY = { close: 'Close' } as const

type SheetFrameProps = {
  title: string
  message: string | null
  isOverPicture: boolean
  onClose: () => void
  children: ReactNode
}

/**
 * A sheet up from the foot over a dimmed scrim that shuts it, with its title and message over
 * what it holds. Back, the scrim and Cancel shut it. It slides only when motion is allowed.
 */
const SheetFrame = ({ title, message, isOverPicture, onClose, children }: SheetFrameProps) => {
  const isReduced = useReduceMotion((motion) => motion.isReduced)
  const insets = useSafeAreaInsets()
  const styles = useStyles({ isOverPicture })
  const scrimStyles = useStyles({ isOverPicture: true })
  return (
    <Modal
      animationType={isReduced ? 'none' : 'slide'}
      navigationBarTranslucent
      onRequestClose={onClose}
      statusBarTranslucent
      transparent
      visible
    >
      <KeyboardAvoidingView behavior="padding" style={styles.frame}>
        <Pressable
          accessibilityLabel={DRAWN_SHEET_COPY.close}
          accessibilityRole="button"
          onPress={onClose}
          style={[StyleSheet.absoluteFill, scrimStyles.scrim]}
        />
        <View
          accessibilityViewIsModal
          style={[
            styles.sheet,
            {
              paddingBottom: insets.bottom + SIZES.space3,
              paddingLeft: insets.left + SIZES.space3,
              paddingRight: insets.right + SIZES.space3,
            },
          ]}
        >
          <Text accessibilityRole="header" style={styles.title} variant={TEXT_VARIANTS.display}>
            {title}
          </Text>
          {message !== null && <Text style={styles.message}>{message}</Text>}
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

type SheetRowProps = {
  label: string
  isDestructive: boolean
  isOverPicture: boolean
  onPress: () => void
}

/** One line of a sheet, a finger tall, the destructive one in the error colour. */
const SheetRow = ({ label, isDestructive, isOverPicture, onPress }: SheetRowProps) => {
  const styles = useStyles({ isOverPicture })
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <Text style={[styles.rowText, isDestructive && styles.destructive]}>{label}</Text>
    </Pressable>
  )
}

type ChoiceSheetViewProps = { choice: ChoiceSheet; onClose: () => void }

/** A choice sheet's lines, then Cancel. A line shuts the sheet before it acts. */
const ChoiceSheetView = ({ choice, onClose }: ChoiceSheetViewProps) => {
  const styles = useStyles({ isOverPicture: choice.isOverPicture })
  return (
    <SheetFrame
      isOverPicture={choice.isOverPicture}
      message={choice.message}
      onClose={onClose}
      title={choice.title}
    >
      <ScrollView contentContainerStyle={styles.rows} style={styles.scroll}>
        {choice.options.map((option) => (
          <SheetRow
            key={option.key}
            isDestructive={option.isDestructive}
            isOverPicture={choice.isOverPicture}
            label={option.label}
            onPress={() => {
              onClose()
              option.onPress()
            }}
          />
        ))}
      </ScrollView>
      <SheetRow
        isDestructive={false}
        isOverPicture={choice.isOverPicture}
        label={CANCEL}
        onPress={onClose}
      />
    </SheetFrame>
  )
}

type PromptSheetViewProps = { prompt: PromptSheet; onClose: () => void }

/** A prompt's field, opening on its name with the keyboard up, then Cancel and its button. */
const PromptSheetView = ({ prompt, onClose }: PromptSheetViewProps) => {
  const styles = useStyles()
  // A ref, not state: the field is uncontrolled, so nothing draws what is typed but the field.
  const value = useRef(prompt.initial)
  const submit = () => {
    onClose()
    prompt.onSubmit(value.current)
  }
  return (
    <SheetFrame isOverPicture={false} message={null} onClose={onClose} title={prompt.title}>
      <TextInput
        accessibilityLabel={prompt.title}
        autoFocus
        // Uncontrolled: on Android a controlled field re-selects its text as it re-renders, so each key replaced the last.
        defaultValue={prompt.initial}
        onChangeText={(text) => {
          value.current = text
        }}
        onSubmitEditing={submit}
        returnKeyType="done"
        style={styles.field}
      />
      <View style={styles.buttons}>
        <View style={styles.button}>
          <SheetRow isDestructive={false} isOverPicture={false} label={CANCEL} onPress={onClose} />
        </View>
        <View style={styles.button}>
          <SheetRow
            isDestructive={false}
            isOverPicture={false}
            label={prompt.submit}
            onPress={submit}
          />
        </View>
      </View>
    </SheetFrame>
  )
}

/**
 * The sheets raven draws where the system has none (Android): the choice or prompt open in
 * `useDrawnSheet`, one at a time. Mounted once above the routes; an iPhone or iPad never opens one.
 */
export const DrawnSheetHost = () => {
  const sheet = useDrawnSheet((state) => state.sheet)
  const close = useDrawnSheet((state) => state.close)
  return (
    <>
      {sheet?.kind === DRAWN_SHEETS.choice && <ChoiceSheetView choice={sheet} onClose={close} />}
      {sheet?.kind === DRAWN_SHEETS.prompt && <PromptSheetView onClose={close} prompt={sheet} />}
    </>
  )
}

const useStyles = themedStyles((colours) =>
  StyleSheet.create({
    frame: { flex: 1, justifyContent: 'flex-end' },
    scrim: { backgroundColor: colours.ground, opacity: SCRIM_OPACITY },
    sheet: { ...footSheetPanelOf(colours), paddingTop: SIZES.space3 },
    title: { color: colours.text, fontSize: SIZES.textLg },
    message: { color: colours.muted, fontSize: SIZES.textSm },
    scroll: { flexGrow: 0, flexShrink: 1 },
    rows: { gap: SIZES.space1 },
    row: {
      justifyContent: 'center',
      minHeight: SIZES.fieldHeight,
      paddingHorizontal: SIZES.space3,
      borderRadius: SIZES.radius,
      backgroundColor: colours.raised,
    },
    rowText: { color: colours.text, fontSize: SIZES.text },
    destructive: { color: colours.error },
    pressed: { opacity: OPACITIES.pressed },
    field: {
      minHeight: SIZES.fieldHeight,
      paddingHorizontal: SIZES.space3,
      borderRadius: SIZES.radius,
      borderWidth: 1,
      borderColor: colours.line,
      backgroundColor: colours.raised,
      color: colours.text,
      fontSize: SIZES.text,
    },
    buttons: { flexDirection: 'row', gap: SIZES.space2 },
    button: { flex: 1 },
  }),
)
