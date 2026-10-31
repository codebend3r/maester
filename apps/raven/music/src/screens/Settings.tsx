import { AUDIO_BITRATES, formatBytes } from '@raven/core'
import type { ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import packageJson from '#package'
import { BUTTON_TONES, FormButton } from '@/components/Form'
import { type SegmentKey, Segments } from '@/components/Segments'
import { TabPage } from '@/components/TabPage'
import { usedBytesOf, useDownloads } from '@/downloads/downloadStore'
import { SETTINGS_COPY } from '@/screens/copy'
import { useWrenAccount } from '@/session'
import { STORAGE_LIMITS_GB, useWrenPrefs } from '@/stores/wrenPrefs'
import { PALETTE, SIZES } from '@/theme/wrenTheme'
import { useWren } from '@/useWren'

type SectionProps = { title: string; children: ReactNode }

function Section({ title, children }: SectionProps) {
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.heading}>
        {title}
      </Text>
      {children}
    </View>
  )
}

const BITRATE_CHOICES = Object.values(AUDIO_BITRATES).map((kbps) => ({
  key: kbps,
  label: SETTINGS_COPY.kbps(kbps),
}))

/** A cellular stream at a transcode's bitrate, or the file itself. */
const CELLULAR_CHOICES = [{ key: null, label: SETTINGS_COPY.original }, ...BITRATE_CHOICES]

const STORAGE_CHOICES = STORAGE_LIMITS_GB.map((gigabytes) => ({
  key: gigabytes,
  label: gigabytes === null ? SETTINGS_COPY.noLimit : SETTINGS_COPY.gigabytes(gigabytes),
}))

type ChoiceRowProps<K extends SegmentKey> = {
  label: string
  choices: readonly { key: K; label: string }[]
  selected: K
  onSelect: (key: K) => void
}

/** A setting named over the values it may take, one of them picked. */
function ChoiceRow<K extends SegmentKey>({
  label,
  choices,
  selected,
  onSelect,
}: ChoiceRowProps<K>) {
  return (
    <View style={styles.choice}>
      <Text style={styles.line}>{label}</Text>
      <Segments onSelect={onSelect} segments={choices} selected={selected} />
    </View>
  )
}

const IGNORED = (): void => undefined

/** The quality downloads and the cellular stream take, how much downloads may use and do, and a way to remove them all. */
function DownloadSettings() {
  const downloadKbps = useWrenPrefs((state) => state.downloadKbps)
  const cellularKbps = useWrenPrefs((state) => state.cellularKbps)
  const storageLimitGb = useWrenPrefs((state) => state.storageLimitGb)
  const change = useWrenPrefs((state) => state.change)
  const used = useDownloads((state) => usedBytesOf(state.entries))
  const hasDownloads = useDownloads((state) => Object.keys(state.entries).length > 0)
  const removeAll = useDownloads((state) => state.removeAll)
  return (
    <Section title={SETTINGS_COPY.downloads}>
      <ChoiceRow
        choices={BITRATE_CHOICES}
        label={SETTINGS_COPY.downloadQuality}
        onSelect={(kbps) => change({ downloadKbps: kbps })}
        selected={downloadKbps}
      />
      <ChoiceRow
        choices={CELLULAR_CHOICES}
        label={SETTINGS_COPY.cellularQuality}
        onSelect={(kbps) => change({ cellularKbps: kbps })}
        selected={cellularKbps}
      />
      <ChoiceRow
        choices={STORAGE_CHOICES}
        label={SETTINGS_COPY.storageLimit}
        onSelect={(gigabytes) => change({ storageLimitGb: gigabytes })}
        selected={storageLimitGb}
      />
      <Text style={styles.muted}>{SETTINGS_COPY.used(formatBytes(used))}</Text>
      <FormButton
        isDisabled={!hasDownloads}
        label={SETTINGS_COPY.removeAll}
        onPress={() => {
          removeAll().catch(IGNORED)
        }}
        tone={BUTTON_TONES.quiet}
      />
    </Section>
  )
}

/** Who is signed in and to which server, the downloads, a way to sign out, and which Wren this is. */
export function Settings() {
  const email = useWrenAccount((state) => state.session?.email ?? null)
  const signOut = useWrenAccount((state) => state.signOut)
  const server = useWren()?.server ?? null
  return (
    <TabPage title={SETTINGS_COPY.title}>
      <Section title={SETTINGS_COPY.account}>
        {email !== null && <Text style={styles.line}>{SETTINGS_COPY.signedInAs(email)}</Text>}
        <FormButton label={SETTINGS_COPY.signOut} onPress={signOut} tone={BUTTON_TONES.quiet} />
      </Section>
      {server !== null && (
        <Section title={SETTINGS_COPY.server}>
          <Text style={styles.line}>{server.name}</Text>
          <Text style={styles.muted}>{server.origin}</Text>
        </Section>
      )}
      <DownloadSettings />
      <Section title={SETTINGS_COPY.about}>
        <Text style={styles.muted}>{SETTINGS_COPY.version(packageJson.version)}</Text>
      </Section>
    </TabPage>
  )
}

const styles = StyleSheet.create({
  section: {
    gap: SIZES.space2,
    padding: SIZES.space3,
    borderRadius: SIZES.radius,
    backgroundColor: PALETTE.raised,
  },
  choice: { gap: SIZES.space1 },
  heading: { color: PALETTE.muted, fontSize: SIZES.textSm, fontWeight: 'bold' },
  line: { color: PALETTE.text, fontSize: SIZES.text },
  muted: { color: PALETTE.muted, fontSize: SIZES.text },
})
