import { MAX_HEIGHTS, type MaxHeight, THEMES, isMaxHeight } from '@raven/core'
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

const COPY = {
  title: 'Settings',
  account: 'Account',
  signedInAs: (email: string) => `Signed in as ${email}.`,
  signOut: 'Sign out',
  theme: 'Theme',
  themeNote: 'How raven looks on this device.',
  playback: 'Playback',
  preferDirect: 'Prefer direct play',
  preferDirectHint:
    'Plays a file this device may refuse as it is first, and has the server convert it only if that fails.',
  allowTranscode: 'Allow transcoding',
  allowTranscodeHint:
    "Lets the server re-encode what this device can't play. Off, such a file doesn't play here.",
  away: 'Away from home',
  awayNote: 'The largest picture a transcode is sent at when raven is reached over the internet.',
} as const

/** What the away cap is called, as the web's server settings name the same heights. */
const AWAY_LABELS: Record<MaxHeight, string> = {
  [MAX_HEIGHTS.uhd]: '4K',
  [MAX_HEIGHTS.fullHd]: '1080p',
  [MAX_HEIGHTS.hd]: '720p',
}

/** A height as the picker keys it, which takes only strings. */
const awayKeyOf = (height: MaxHeight) => `${height}` as const

const AWAY_OPTIONS = Object.values(MAX_HEIGHTS).map((height) => ({
  key: awayKeyOf(height),
  label: AWAY_LABELS[height],
}))

const THEME_OPTIONS = THEMES.map((theme) => ({ key: theme.id, label: theme.name }))

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
    <SettingsPage onBack={() => router.back()} title={COPY.title}>
      <SettingsSection note={email === null ? null : COPY.signedInAs(email)} title={COPY.account}>
        <SettingsButton isDisabled={false} onPress={signOut} text={COPY.signOut} />
      </SettingsSection>
      <SettingsSection note={COPY.themeNote} title={COPY.theme}>
        <SettingsChoice
          label={COPY.theme}
          onChoose={(picked) => change({ theme: picked })}
          options={THEME_OPTIONS}
          value={theme}
        />
      </SettingsSection>
      <SettingsSection note={COPY.awayNote} title={COPY.playback}>
        <SettingsToggle
          hint={COPY.preferDirectHint}
          isOn={shouldPreferDirectPlay}
          label={COPY.preferDirect}
          onToggle={(isOn) => change({ shouldPreferDirectPlay: isOn })}
        />
        <SettingsToggle
          hint={COPY.allowTranscodeHint}
          isOn={isTranscodeAllowed}
          label={COPY.allowTranscode}
          onToggle={(isOn) => change({ isTranscodeAllowed: isOn })}
        />
        <SettingsChoice
          label={COPY.away}
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
