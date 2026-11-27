import { AUDIO_BITRATES, type AudioBitrate, formatBytes } from '@raven/core'
import { IGNORED } from '@raven/native/headless'
import { useState } from 'react'
import { Text, View } from 'react-native'

import { KIT_COPY, SETTINGS_COPY, WREN_ICONS } from '@raven/wren'
import { usedBytesOf, useDownloads } from '@/downloads/downloadStore'
import { ChoiceRow } from '@/screens/settings/rows'
import { StorageLimitSheet, storageLimitLabelOf } from '@/screens/settings/StorageLimitSheet'
import { useStorageMeter } from '@/downloads/storageMeter'
import { useWrenPrefs } from '@/stores/wrenPrefs'
import { type WrenTheme, themedStyles } from '@/theme/wrenTheme'
import { SPACE, TYPE } from '@/theme/wrenTokens'
import { AlertDialog } from '@/ui/AlertDialog'
import { BUTTON_SIZES, BUTTON_VARIANTS, Button } from '@/ui/Button'
import { Card } from '@/ui/Card'
import { GroupedList } from '@/ui/GroupedList'
import { MeterBar } from '@/ui/MeterBar'
import { NAVIGATION_ROW_VARIANTS, NavigationRow } from '@/ui/NavigationRow'

/** The cellular choice that streams the file itself, which the prefs keep as null. */
const CELLULAR_ORIGINAL = { key: 'original' } as const

type CellularKey = AudioBitrate | typeof CELLULAR_ORIGINAL.key

const BITRATE_CHOICES = Object.values(AUDIO_BITRATES).map((kbps) => ({
  key: kbps,
  label: String(kbps),
}))

const CELLULAR_CHOICES = [
  { key: CELLULAR_ORIGINAL.key, label: SETTINGS_COPY.original },
  ...BITRATE_CHOICES,
]

const cellularKeyOf = (kbps: AudioBitrate | null): CellularKey => kbps ?? CELLULAR_ORIGINAL.key

const cellularKbpsOf = (key: CellularKey): AudioBitrate | null =>
  key === CELLULAR_ORIGINAL.key ? null : key

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  meter: { gap: SPACE.s2, paddingBottom: SPACE.s4, paddingTop: SPACE.s3 },
  meterLine: { flexDirection: 'row', gap: SPACE.s3, justifyContent: 'space-between' },
  meterText: { ...TYPE.meta, color: colors.text2 },
  meterValue: { ...TYPE.meta, color: colors.text2, fontVariant: ['tabular-nums'] },
}))

/** How much the downloads take, against the storage limit or the room on the device. */
function UsageMeter() {
  const styles = useStyles()
  const { value, fraction } = useStorageMeter()
  return (
    <View
      accessibilityLabel={KIT_COPY.labelled({ label: SETTINGS_COPY.usedByDownloads, value })}
      accessible
      style={styles.meter}
    >
      <View style={styles.meterLine}>
        <Text style={styles.meterText}>{SETTINGS_COPY.usedByDownloads}</Text>
        <Text style={styles.meterValue}>{value}</Text>
      </View>
      {fraction !== null && <MeterBar fraction={fraction} />}
    </View>
  )
}

/** The quality downloads and the cellular stream take, and how much downloads may use and do. */
export function DownloadsGroup() {
  const [isPickingLimit, setIsPickingLimit] = useState(false)
  const downloadKbps = useWrenPrefs((state) => state.downloadKbps)
  const cellularKbps = useWrenPrefs((state) => state.cellularKbps)
  const storageLimitGb = useWrenPrefs((state) => state.storageLimitGb)
  const change = useWrenPrefs((state) => state.change)
  return (
    <>
      <GroupedList heading={SETTINGS_COPY.downloads}>
        <ChoiceRow
          accessibilityLabel={SETTINGS_COPY.inKbps(SETTINGS_COPY.downloadQuality)}
          choices={BITRATE_CHOICES}
          icon={WREN_ICONS.download}
          label={SETTINGS_COPY.downloadQuality}
          onSelect={(kbps) => change({ downloadKbps: kbps })}
          selected={downloadKbps}
          unit={SETTINGS_COPY.kbps}
        />
        <ChoiceRow
          accessibilityLabel={SETTINGS_COPY.inKbps(SETTINGS_COPY.cellularQuality)}
          choices={CELLULAR_CHOICES}
          icon={WREN_ICONS.quality}
          label={SETTINGS_COPY.cellularQuality}
          onSelect={(key) => change({ cellularKbps: cellularKbpsOf(key) })}
          selected={cellularKeyOf(cellularKbps)}
          unit={SETTINGS_COPY.kbps}
        />
        <NavigationRow
          icon={WREN_ICONS.storage}
          label={SETTINGS_COPY.storageLimit}
          onPress={() => setIsPickingLimit(true)}
          value={storageLimitLabelOf(storageLimitGb)}
          variant={NAVIGATION_ROW_VARIANTS.settings}
        />
        <UsageMeter />
      </GroupedList>
      <StorageLimitSheet isOpen={isPickingLimit} onClose={() => setIsPickingLimit(false)} />
    </>
  )
}

type RemoveAllDownloadsProps = {
  /** The server's configured name, which the dialog says the music still streams from. */
  serverName: string | null
}

/** Remove all downloads, asking first in a dialog that says how much goes. */
export function RemoveAllDownloads({ serverName }: RemoveAllDownloadsProps) {
  const [isAsking, setIsAsking] = useState(false)
  const usedBytes = useDownloads((state) => usedBytesOf(state.entries))
  const hasDownloads = useDownloads((state) => Object.keys(state.entries).length > 0)
  const removeAll = useDownloads((state) => state.removeAll)
  return (
    <Card>
      <Button
        icon={WREN_ICONS.trash}
        isDisabled={!hasDownloads}
        label={SETTINGS_COPY.removeAll}
        onPress={() => setIsAsking(true)}
        size={BUTTON_SIZES.large}
        variant={BUTTON_VARIANTS.danger}
      />
      <AlertDialog
        body={SETTINGS_COPY.removeAllBody({
          size: formatBytes(usedBytes),
          server: serverName ?? SETTINGS_COPY.theServer,
        })}
        confirmLabel={SETTINGS_COPY.remove}
        icon={WREN_ICONS.trash}
        isOpen={isAsking}
        onCancel={() => setIsAsking(false)}
        onConfirm={() => {
          setIsAsking(false)
          removeAll().catch(IGNORED)
        }}
        title={SETTINGS_COPY.removeAllTitle}
      />
    </Card>
  )
}
