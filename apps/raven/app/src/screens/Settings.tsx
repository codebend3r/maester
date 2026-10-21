import { NAME_MAX, SERVERS_CAP, THEMES } from '@raven/core'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { Alert, Text } from 'react-native'

import {
  BUTTON_TONES,
  Field,
  Form,
  FormButton,
  ServerRow,
  SettingsButton,
  SettingsChoice,
  SettingsPage,
  SettingsSection,
  SettingsSheet,
  SettingsToggle,
  useFormStyles,
} from '@/layouts'
import type { SettingsAction } from '@/layouts/settingsKit'
import { APP_ROUTES } from '@/routes'
import type { AppServer } from '@/servers/serverList'
import { useActiveServer } from '@/stores/activeServer'
import {
  AWAY_MAX_HEIGHTS,
  type AwayMaxHeight,
  isAwayMaxHeight,
  useAppPrefs,
} from '@/stores/appPrefs'

const COPY = {
  title: 'Settings',
  servers: 'Servers',
  inUse: 'In use',
  add: 'Add a server',
  full: `This device keeps ${SERVERS_CAP} servers at most.`,
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
  name: 'Name',
  save: 'Save',
  cancel: 'Cancel',
  badName: `Give the server a name, up to ${NAME_MAX} characters.`,
  removeNote: 'Its sign-in on this device goes with it.',
} as const

/** What each of a server's buttons does. */
const SERVER_ACTIONS = { use: 'use', rename: 'rename', remove: 'remove' } as const

/** Each button's words and what it is called aloud, for the server named `name`. */
const ACTION_WORDS = {
  [SERVER_ACTIONS.use]: { text: 'Use', label: (name: string) => `Use ${name}` },
  [SERVER_ACTIONS.rename]: { text: 'Rename', label: (name: string) => `Rename ${name}` },
  [SERVER_ACTIONS.remove]: { text: 'Remove', label: (name: string) => `Remove ${name}` },
} as const satisfies Record<keyof typeof SERVER_ACTIONS, unknown>

/** What the away cap is called, as the web's server settings name the same heights. */
const AWAY_LABELS: Record<AwayMaxHeight, string> = {
  [AWAY_MAX_HEIGHTS.uhd]: '4K',
  [AWAY_MAX_HEIGHTS.fullHd]: '1080p',
  [AWAY_MAX_HEIGHTS.hd]: '720p',
}

/** A height as the picker keys it, which takes only strings. */
const awayKeyOf = (height: AwayMaxHeight) => `${height}` as const

const AWAY_OPTIONS = Object.values(AWAY_MAX_HEIGHTS).map((height) => ({
  key: awayKeyOf(height),
  label: AWAY_LABELS[height],
}))

const THEME_OPTIONS = THEMES.map((theme) => ({ key: theme.id, label: theme.name }))

/** Asks before a server goes, since its PIN's unlock goes with it, and removes it on a yes. */
const confirmRemove = ({ server, remove }: { server: AppServer; remove: () => void }) =>
  Alert.alert(`Remove ${server.name}?`, COPY.removeNote, [
    { text: COPY.cancel, style: 'cancel' },
    { text: ACTION_WORDS.remove.text, style: 'destructive', onPress: remove },
  ])

/** A server's new name, typed in the platform's form: the field opens with the name it has. */
const Rename = ({ server, onDone }: { server: AppServer; onDone: () => void }) => {
  const rename = useActiveServer((state) => state.rename)
  const formStyles = useFormStyles()
  const [name, setName] = useState(server.name)
  const [isRefused, setRefused] = useState(false)
  const save = ({ text }: { text: string }) => {
    if (!rename({ id: server.id, name: text })) {
      setRefused(true)
      return
    }
    onDone()
  }
  return (
    <Form title={ACTION_WORDS.rename.label(server.name)}>
      <Field isFirst label={COPY.name} onChangeText={setName} onSubmit={save} value={name} />
      {isRefused && (
        <Text accessibilityLiveRegion="polite" style={formStyles.error}>
          {COPY.badName}
        </Text>
      )}
      <FormButton
        label={COPY.save}
        onPress={() => save({ text: name })}
        tone={BUTTON_TONES.primary}
      />
      <FormButton label={COPY.cancel} onPress={onDone} tone={BUTTON_TONES.ghost} />
    </Form>
  )
}

/**
 * `/settings`: the servers this device knows, its theme and how it plays, all kept on the device;
 * nothing here asks a server anything. A switch or a removal of the server in use changes the
 * active server, which empties the query cache, so every screen reads the new one. Adding goes
 * through sign-in. Removing forgets the server's cookies; the last one gone, sign-in follows.
 */
export const Settings = () => {
  const router = useRouter()
  const servers = useActiveServer((state) => state.servers)
  const activeId = useActiveServer((state) => state.activeId)
  const activate = useActiveServer((state) => state.activate)
  const remove = useActiveServer((state) => state.remove)
  const theme = useAppPrefs((state) => state.theme)
  const shouldPreferDirectPlay = useAppPrefs((state) => state.shouldPreferDirectPlay)
  const isTranscodeAllowed = useAppPrefs((state) => state.isTranscodeAllowed)
  const awayMaxHeight = useAppPrefs((state) => state.awayMaxHeight)
  const change = useAppPrefs((state) => state.change)
  const [renaming, setRenaming] = useState<AppServer | null>(null)
  // The server whose rename last closed, whose Rename the remote comes back to on a TV.
  const [renamedId, setRenamedId] = useState<string | null>(null)

  if (renaming !== null) {
    const closeRename = () => {
      setRenamedId(renaming.id)
      setRenaming(null)
    }
    return (
      <SettingsSheet onClose={closeRename}>
        <Rename onDone={closeRename} server={renaming} />
      </SettingsSheet>
    )
  }

  const actionsFor = (server: AppServer): SettingsAction[] => {
    const words = (key: keyof typeof SERVER_ACTIONS) => ({
      key,
      text: ACTION_WORDS[key].text,
      label: ACTION_WORDS[key].label(server.name),
    })
    const use = { ...words(SERVER_ACTIONS.use), onPress: () => activate(server.id) }
    return [
      ...(server.id === activeId ? [] : [use]),
      { ...words(SERVER_ACTIONS.rename), onPress: () => setRenaming(server) },
      {
        ...words(SERVER_ACTIONS.remove),
        onPress: () =>
          confirmRemove({
            server,
            // The store forgets the cookies whatever the keychain says; a failure is the jar's.
            remove: () => {
              remove(server.id).catch(() => undefined)
            },
          }),
      },
    ]
  }

  const openingActionOf = ({ server, index }: { server: AppServer; index: number }) => {
    if (renamedId !== null) return server.id === renamedId ? SERVER_ACTIONS.rename : null
    return index === 0 ? (actionsFor(server)[0]?.key ?? null) : null
  }

  const isFull = servers.length >= SERVERS_CAP

  return (
    <SettingsPage onBack={() => router.back()} title={COPY.title}>
      <SettingsSection note={isFull ? COPY.full : null} title={COPY.servers}>
        {servers.map((server, index) => (
          <ServerRow
            key={server.id}
            actions={actionsFor(server)}
            badge={server.id === activeId ? COPY.inUse : null}
            line={server.origin}
            name={server.name}
            openingAction={openingActionOf({ server, index })}
          />
        ))}
        <SettingsButton
          isDisabled={isFull}
          onPress={() => router.push(APP_ROUTES.signIn)}
          text={COPY.add}
        />
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
            if (isAwayMaxHeight(height)) change({ awayMaxHeight: height })
          }}
          options={AWAY_OPTIONS}
          value={awayKeyOf(awayMaxHeight)}
        />
      </SettingsSection>
    </SettingsPage>
  )
}
