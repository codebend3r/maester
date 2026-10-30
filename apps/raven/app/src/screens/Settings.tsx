import { MAX_HEIGHTS, type MaxHeight, isMaxHeight } from '@raven/core'
import { useRouter } from 'expo-router'

import { useAccountSession } from '@/account/accountSession'
import {
  SettingsButton,
  SettingsChoice,
  SettingsPage,
  SettingsSection,
  SettingsToggle,
} from '@/layouts'
import { useAppPrefs } from '@/stores/appPrefs'
import { SETTINGS_COPY } from '@/screens/copy'
import { THEME_PICKER } from '@/theme/themeOptions'

/** What the away cap is called, as the web's server settings name the same heights. */
const AWAY_LABELS = {
  [MAX_HEIGHTS.uhd]: SETTINGS_COPY.heights.uhd,
  [MAX_HEIGHTS.fullHd]: SETTINGS_COPY.heights.fullHd,
  [MAX_HEIGHTS.hd]: SETTINGS_COPY.heights.hd,
} as const satisfies Record<MaxHeight, string>

/** A height as the picker keys it, which takes only strings. */
const awayKeyOf = (height: MaxHeight) => `${height}` as const

const AWAY_OPTIONS = Object.values(MAX_HEIGHTS).map((height) => ({
  key: awayKeyOf(height),
  label: AWAY_LABELS[height],
}))

/**
 * `/settings`: the signed-in account, its theme and how it plays, all kept on the device; nothing
 * here asks a server anything. Signing out sends the viewer back to sign-in.
 */
export const Settings = () => {
  const router = useRouter()
  const email = useAccountSession((state) => state.session?.email ?? null)
  const signOut = useAccountSession((state) => state.signOut)
  const theme = useAppPrefs((state) => state.theme)
  const shouldPreferDirectPlay = useAppPrefs((state) => state.shouldPreferDirectPlay)
  const isTranscodeAllowed = useAppPrefs((state) => state.isTranscodeAllowed)
  const awayMaxHeight = useAppPrefs((state) => state.awayMaxHeight)
  const change = useAppPrefs((state) => state.change)

  return (
    <SettingsPage onBack={() => router.back()} title={SETTINGS_COPY.title}>
      <SettingsSection
        note={email === null ? null : SETTINGS_COPY.signedInAs(email)}
        title={SETTINGS_COPY.account}
      >
        <SettingsButton isDisabled={false} onPress={signOut} text={SETTINGS_COPY.signOut} />
      </SettingsSection>
      <SettingsSection note={SETTINGS_COPY.themeNote} title={THEME_PICKER.label}>
        <SettingsChoice
          label={THEME_PICKER.label}
          onChoose={(picked) => change({ theme: picked })}
          options={THEME_PICKER.options}
          value={theme}
        />
      </SettingsSection>
      <SettingsSection note={SETTINGS_COPY.awayNote} title={SETTINGS_COPY.playback}>
        <SettingsToggle
          hint={SETTINGS_COPY.preferDirectHint}
          isOn={shouldPreferDirectPlay}
          label={SETTINGS_COPY.preferDirect}
          onToggle={(isOn) => change({ shouldPreferDirectPlay: isOn })}
        />
        <SettingsToggle
          hint={SETTINGS_COPY.allowTranscodeHint}
          isOn={isTranscodeAllowed}
          label={SETTINGS_COPY.allowTranscode}
          onToggle={(isOn) => change({ isTranscodeAllowed: isOn })}
        />
        <SettingsChoice
          label={SETTINGS_COPY.away}
          onChoose={(key) => {
            const height = Number(key)
            if (isMaxHeight(height)) change({ awayMaxHeight: height })
          }}
          options={AWAY_OPTIONS}
          value={awayKeyOf(awayMaxHeight)}
        />
      </SettingsSection>
    </SettingsPage>
  )
}
