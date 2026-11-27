import { Modal, Text, View } from 'react-native'

import { KIT_COPY, type WrenIconName } from '@raven/wren'
import { type WrenTheme, themedStyles, useWrenTheme } from '@/theme/wrenTheme'
import { RADIUS, SIZE, SPACE, TYPE } from '@/theme/wrenTokens'
import { BUTTON_VARIANTS, Button } from '@/ui/Button'
import { WrenIcon } from '@/ui/WrenIcon'

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  scrim: {
    backgroundColor: colors.scrim,
    flex: 1,
    justifyContent: 'center',
    padding: SIZE.dialogInset,
  },
  card: {
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderRadius: RADIUS.xl,
    gap: SPACE.s4,
    maxWidth: SIZE.dialog,
    padding: SPACE.s6,
    width: '100%',
  },
  tile: {
    alignItems: 'center',
    backgroundColor: colors.accentSoft,
    borderRadius: RADIUS.md,
    height: SIZE.dialogIcon,
    justifyContent: 'center',
    width: SIZE.dialogIcon,
  },
  text: { gap: SPACE.s2 },
  title: { ...TYPE.dialogTitle, color: colors.text },
  body: { ...TYPE.body, color: colors.text2 },
  buttons: { flexDirection: 'row', gap: SPACE.s3 },
}))

type AlertDialogProps = {
  isOpen: boolean
  icon: WrenIconName
  title: string
  /** What happens, and how to undo it: "You can still stream it whenever raven is reachable." */
  body: string
  /** The destructive action's name: Remove. */
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}

/** A centred card asking before something that cannot be undone: Cancel, or the action. */
export function AlertDialog({
  isOpen,
  icon,
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
}: AlertDialogProps) {
  const styles = useStyles()
  const { colors } = useWrenTheme()
  return (
    <Modal onRequestClose={onCancel} statusBarTranslucent transparent visible={isOpen}>
      <View style={styles.scrim}>
        <View accessibilityRole="alert" accessibilityViewIsModal style={styles.card}>
          <View style={styles.tile}>
            <WrenIcon color={colors.accentText} name={icon} size={SIZE.icon} />
          </View>
          <View style={styles.text}>
            <Text accessibilityRole="header" style={styles.title}>
              {title}
            </Text>
            <Text style={styles.body}>{body}</Text>
          </View>
          <View style={styles.buttons}>
            <Button
              isStretched
              label={KIT_COPY.cancel}
              onPress={onCancel}
              variant={BUTTON_VARIANTS.secondary}
            />
            <Button isStretched label={confirmLabel} onPress={onConfirm} />
          </View>
        </View>
      </View>
    </Modal>
  )
}
