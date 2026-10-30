import type { ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import packageJson from '#package'
import { BUTTON_TONES, FormButton } from '@/components/Form'
import { TabPage } from '@/components/TabPage'
import { useWrenAccount } from '@/session'
import { PALETTE, SIZES } from '@/theme/wrenTheme'
import { useWren } from '@/useWren'

const COPY = {
  title: 'Settings',
  account: 'Account',
  signedInAs: (email: string) => `Signed in as ${email}`,
  signOut: 'Sign out',
  server: 'Server',
  about: 'About',
  version: (version: string) => `Wren ${version}`,
} as const

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

/** Who is signed in and to which server, a way to sign out, and which Wren this is. */
export function Settings() {
  const email = useWrenAccount((state) => state.session?.email ?? null)
  const signOut = useWrenAccount((state) => state.signOut)
  const server = useWren()?.server ?? null
  return (
    <TabPage title={COPY.title}>
      <Section title={COPY.account}>
        {email !== null && <Text style={styles.line}>{COPY.signedInAs(email)}</Text>}
        <FormButton label={COPY.signOut} onPress={signOut} tone={BUTTON_TONES.quiet} />
      </Section>
      {server !== null && (
        <Section title={COPY.server}>
          <Text style={styles.line}>{server.name}</Text>
          <Text style={styles.muted}>{server.origin}</Text>
        </Section>
      )}
      <Section title={COPY.about}>
        <Text style={styles.muted}>{COPY.version(packageJson.version)}</Text>
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
  heading: { color: PALETTE.muted, fontSize: SIZES.textSm, fontWeight: 'bold' },
  line: { color: PALETTE.text, fontSize: SIZES.text },
  muted: { color: PALETTE.muted, fontSize: SIZES.text },
})
