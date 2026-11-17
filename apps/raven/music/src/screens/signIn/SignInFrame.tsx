import type { ComponentType, ReactNode } from 'react'
import { KeyboardAvoidingView, ScrollView, Text, View, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { WrenLockup, WrenMark } from '@/components/WrenLockup'
import { SIGN_IN_COPY } from '@/screens/copy'
import { type WrenTheme, themedStyles } from '@/theme/wrenTheme'
import {
  BRAND,
  SIGN_IN_SIZES,
  SPACE,
  TYPE,
  FORM_FACTORS,
  type FormFactor,
} from '@/theme/wrenTokens'
import { StatusChip } from '@/ui/StatusChip'

/** The server sign-in names: its configured name, and whether the last try could not reach it. */
type SignInServer = { name: string; isDown: boolean }

type SignInFrameProps = { server: SignInServer; children: ReactNode }

const usePhoneStyles = themedStyles(({ colors }: WrenTheme) => ({
  ground: { flex: 1, backgroundColor: colors.bg },
  content: { flexGrow: 1, gap: SPACE.s8 },
  head: { alignItems: 'flex-start', gap: SPACE.s5 },
  titles: { gap: SPACE.s2 },
  title: { ...TYPE.tabletTitle, color: colors.text },
  note: { ...TYPE.body, color: colors.text2 },
  foot: { alignItems: 'center', flexGrow: 1, gap: SPACE.s2, justifyContent: 'flex-end' },
  family: { ...TYPE.small, color: colors.text3 },
}))

/** P01: the mark, the welcome and the form in one column, the server and Maester at its foot. */
function PhoneFrame({ server, children }: SignInFrameProps) {
  const styles = usePhoneStyles()
  const safe = useSafeAreaInsets()
  const edges = {
    paddingTop: safe.top + SIGN_IN_SIZES.inset,
    paddingBottom: safe.bottom + SPACE.s10,
    paddingLeft: Math.max(safe.left, SPACE.s6),
    paddingRight: Math.max(safe.right, SPACE.s6),
  }
  return (
    <KeyboardAvoidingView behavior="padding" style={styles.ground}>
      <ScrollView
        contentContainerStyle={[styles.content, edges]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.head}>
          <WrenMark size={SIGN_IN_SIZES.mark} />
          <View style={styles.titles}>
            <Text accessibilityRole="header" style={styles.title}>
              {SIGN_IN_COPY.welcome}
            </Text>
            <Text style={styles.note}>{SIGN_IN_COPY.note}</Text>
          </View>
        </View>
        {children}
        <View style={styles.foot}>
          {/* TODO(redesign): "Change" joins the chip once Wren can talk to a server other than raven. */}
          <View>
            <StatusChip isConnected={!server.isDown} name={server.name} />
          </View>
          <Text style={styles.family}>{SIGN_IN_COPY.family}</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const useTabletStyles = themedStyles(({ colors }: WrenTheme) => ({
  split: { flex: 1, flexDirection: 'row', backgroundColor: colors.bg },
  // Night in both themes: the brand's half of the screen never follows the appearance.
  brand: {
    backgroundColor: BRAND.night,
    flex: 1,
    justifyContent: 'space-between',
    padding: SIGN_IN_SIZES.inset,
  },
  hero: { alignItems: 'center' },
  tagline: { ...TYPE.lyric, color: BRAND.bark, maxWidth: SIGN_IN_SIZES.taglineWidth },
  side: { flex: 1 },
  sideContent: {
    alignItems: 'center',
    flexGrow: 1,
    justifyContent: 'center',
    padding: SPACE.s10,
  },
  column: { gap: SPACE.s4, maxWidth: SIGN_IN_SIZES.formWidth, width: '100%' },
  titles: { gap: SPACE.s2, paddingBottom: SPACE.s2 },
  title: { ...TYPE.tabletTitle, color: colors.text },
  note: { ...TYPE.body, color: colors.text2 },
  server: { alignSelf: 'flex-end' },
}))

/**
 * T01: the brand's Night half, with the lockup, the large mark and the tagline, beside the
 * themed form, which grows no wider than 400.
 */
function TabletFrame({ server, children }: SignInFrameProps) {
  const styles = useTabletStyles()
  const safe = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  // The mark keeps inside its half when the tablet is held upright.
  const heroSize = Math.min(SIGN_IN_SIZES.heroMark, width / 2 - 2 * SIGN_IN_SIZES.inset)
  const brandEdges = {
    paddingTop: safe.top + SIGN_IN_SIZES.inset,
    paddingBottom: safe.bottom + SIGN_IN_SIZES.inset,
    paddingLeft: safe.left + SIGN_IN_SIZES.inset,
  }
  const sideEdges = {
    paddingTop: safe.top + SPACE.s10,
    paddingBottom: safe.bottom + SPACE.s10,
    paddingRight: safe.right + SPACE.s10,
  }
  return (
    <View style={styles.split}>
      <View style={[styles.brand, brandEdges]}>
        <WrenLockup ink={BRAND.bark} size={SIGN_IN_SIZES.lockup} />
        <View style={styles.hero}>
          <WrenMark ink={BRAND.bark} size={heroSize} />
        </View>
        <Text style={styles.tagline}>{SIGN_IN_COPY.tagline}</Text>
      </View>
      <KeyboardAvoidingView behavior="padding" style={styles.side}>
        <ScrollView
          contentContainerStyle={[styles.sideContent, sideEdges]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.column}>
            <View style={styles.titles}>
              <Text accessibilityRole="header" style={styles.title}>
                {SIGN_IN_COPY.title}
              </Text>
              <Text style={styles.note}>{SIGN_IN_COPY.tabletNote}</Text>
            </View>
            {children}
            <View style={styles.server}>
              <StatusChip isConnected={!server.isDown} name={server.name} />
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  )
}

/** The frame each layout draws the step's form in. */
export const SIGN_IN_FRAMES = {
  [FORM_FACTORS.phone]: PhoneFrame,
  [FORM_FACTORS.tablet]: TabletFrame,
} as const satisfies Record<FormFactor, ComponentType<SignInFrameProps>>
