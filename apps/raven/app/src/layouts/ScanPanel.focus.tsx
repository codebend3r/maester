import { QrCode } from '@raven/native'
import {
  BUTTON_TONES,
  DEVICE_LINK_STATES,
  DEVICE_SCAN_COPY,
  type DeviceLink,
  type ScanPanelProps,
} from '@raven/native/headless'
import type { ComponentType } from 'react'
import { StyleSheet, View } from 'react-native'

import { FormButton } from '@/layouts/FormButton.focus'
import { Text, TEXT_VARIANTS } from '@/layouts/Text'
import { TV_SIZES } from '@/theme/tvSizes'
import { themedStyles } from '@/theme/useTheme'

/** The code's side: large enough for a phone to read from the sofa. */
const QR_SIDE = TV_SIZES.space8 * 5

/** How far apart the code's letters stand, so each reads alone across the room. */
const CODE_TRACKING = TV_SIZES.space1

const usePanelStyles = themedStyles((colours) =>
  StyleSheet.create({
    panel: {
      backgroundColor: colours.raised,
      borderColor: colours.line,
      borderRadius: TV_SIZES.radiusLg,
      borderWidth: 1,
      gap: TV_SIZES.space3,
      maxWidth: QR_SIDE + TV_SIZES.space6 * 2,
      padding: TV_SIZES.space5,
    },
    title: { color: colours.text, fontSize: TV_SIZES.textXl, textAlign: 'center' },
    note: { color: colours.muted, fontSize: TV_SIZES.textSm, textAlign: 'center' },
    qr: { alignSelf: 'center', borderRadius: TV_SIZES.radius, overflow: 'hidden' },
    code: {
      alignSelf: 'center',
      color: colours.text,
      fontSize: TV_SIZES.textXl,
      fontWeight: 'bold',
      letterSpacing: CODE_TRACKING,
    },
  }),
)

/** The code to scan, the address to type instead, and the code itself in letters. */
const ScanCode = ({ link }: ScanPanelProps) => {
  const panelStyles = usePanelStyles()
  return (
    link.kind === DEVICE_LINK_STATES.ready && (
      <View style={panelStyles.panel}>
        <Text variant={TEXT_VARIANTS.display} style={panelStyles.title}>
          {DEVICE_SCAN_COPY.title}
        </Text>
        <Text style={panelStyles.note}>{DEVICE_SCAN_COPY.note}</Text>
        <View style={panelStyles.qr}>
          <QrCode label={DEVICE_SCAN_COPY.qrLabel} size={QR_SIDE} value={link.url} />
        </View>
        <Text style={panelStyles.note}>{DEVICE_SCAN_COPY.orOpen(link.address)}</Text>
        <Text accessibilityLabel={DEVICE_SCAN_COPY.codeLabel(link.code)} style={panelStyles.code}>
          {link.code}
        </Text>
      </View>
    )
  )
}

/** A code that ran out on a screen left open, and the button for another. */
const ScanExpired = ({ onRenew }: ScanPanelProps) => {
  const panelStyles = usePanelStyles()
  return (
    <View style={panelStyles.panel}>
      <Text variant={TEXT_VARIANTS.display} style={panelStyles.title}>
        {DEVICE_SCAN_COPY.title}
      </Text>
      <Text accessibilityLiveRegion="polite" style={panelStyles.note}>
        {DEVICE_SCAN_COPY.expired}
      </Text>
      <FormButton label={DEVICE_SCAN_COPY.renew} onPress={onRenew} tone={BUTTON_TONES.quiet} />
    </View>
  )
}

const SCAN_VIEWS = {
  [DEVICE_LINK_STATES.ready]: ScanCode,
  [DEVICE_LINK_STATES.expired]: ScanExpired,
} as const satisfies Record<DeviceLink['kind'], ComponentType<ScanPanelProps>>

/**
 * Sign-in without the remote's keyboard: a QR code a phone scans to approve this TV on raven's
 * web app, where it is already signed in or signs in with its own keyboard and saved password.
 */
export const ScanPanel = ({ link, onRenew }: ScanPanelProps) => {
  const Panel = SCAN_VIEWS[link.kind]
  return <Panel link={link} onRenew={onRenew} />
}
