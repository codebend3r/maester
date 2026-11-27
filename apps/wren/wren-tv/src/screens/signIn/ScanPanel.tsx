import { QrCode } from '@raven/native'
import {
  DEVICE_LINK_STATES,
  DEVICE_SCAN_COPY,
  type DeviceLink,
  type ScanPanelProps,
} from '@raven/native/headless'
import type { ComponentType } from 'react'
import { Text, View } from 'react-native'

import { RADIUS, SIZE, SPACE, TYPE } from '@/theme/tvTokens'
import { themedStyles } from '@/theme/wrenTheme'
import { FocusButton } from '@/ui/FocusButton'

const useStyles = themedStyles(({ colors }) => ({
  panel: {
    alignItems: 'center',
    backgroundColor: colors.surface2,
    borderRadius: RADIUS.card,
    flexDirection: 'row',
    gap: SPACE.s4,
    padding: SPACE.s4,
  },
  qr: { borderRadius: RADIUS.item, overflow: 'hidden' },
  words: { alignItems: 'flex-start', flex: 1, gap: SPACE.s2 },
  title: { ...TYPE.section, color: colors.text },
  note: { ...TYPE.meta, color: colors.text2 },
  code: { ...TYPE.cardTitle, color: colors.text, letterSpacing: SIZE.codeTracking },
}))

/** The code to scan, with the address to type instead and the code itself in letters. */
function ScanCode({ link }: ScanPanelProps) {
  const styles = useStyles()
  return (
    link.kind === DEVICE_LINK_STATES.ready && (
      <View style={styles.panel}>
        <View style={styles.qr}>
          <QrCode label={DEVICE_SCAN_COPY.qrLabel} size={SIZE.qr} value={link.url} />
        </View>
        <View style={styles.words}>
          <Text style={styles.title}>{DEVICE_SCAN_COPY.title}</Text>
          <Text style={styles.note}>{DEVICE_SCAN_COPY.note}</Text>
          <Text style={styles.note}>{DEVICE_SCAN_COPY.orOpen(link.address)}</Text>
          <Text accessibilityLabel={DEVICE_SCAN_COPY.codeLabel(link.code)} style={styles.code}>
            {link.code}
          </Text>
        </View>
      </View>
    )
  )
}

/** A code that ran out on a screen left open, and the button for another. */
function ScanExpired({ onRenew }: ScanPanelProps) {
  const styles = useStyles()
  return (
    <View style={styles.panel}>
      <View style={styles.words}>
        <Text style={styles.title}>{DEVICE_SCAN_COPY.title}</Text>
        <Text accessibilityLiveRegion="polite" style={styles.note}>
          {DEVICE_SCAN_COPY.expired}
        </Text>
        <FocusButton
          label={DEVICE_SCAN_COPY.renew}
          onPress={onRenew}
          text={DEVICE_SCAN_COPY.renew}
        />
      </View>
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
export function ScanPanel({ link, onRenew }: ScanPanelProps) {
  const Panel = SCAN_VIEWS[link.kind]
  return <Panel link={link} onRenew={onRenew} />
}
