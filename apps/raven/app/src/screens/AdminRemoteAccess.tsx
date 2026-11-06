import {
  REMOTE_ACCESS_STATES,
  REMOTE_ACCESS_TEXT_FIELDS,
  type RemoteAccessChange,
  type RemoteAccessDraft,
  type RemoteAccessSettings,
  type RemoteAccessState,
  type RemoteAccessStatus,
  type RemoteAccessTextField,
  type RemoteLimit,
  addressLineOf,
  checkedTimeOf,
  draftNumberOf,
  isRemoteLimit,
  remoteAccessChangeOf,
  remoteAccessDraftOf,
  remoteAccessHopsOf,
  remoteLimitLabelOf,
  remoteQualityFor,
  remoteStreamsAt,
} from '@raven/core'
import { useServerRemoteAccess } from '@raven/ui/headless'
import { useState } from 'react'

import {
  Field,
  SettingsButton,
  SettingsChoice,
  SettingsLine,
  SettingsSection,
  SettingsToggle,
} from '@/layouts'
import type { AppQueries } from '@/queries/useAppQueries'
import {
  ADMIN_COPY,
  REACHABILITY_PROBLEM_COPY,
  REMOTE_ACCESS_COPY,
  REMOTE_ACCESS_STATUS_COPY,
} from '@/screens/adminCopy'

/** A limit's words: Original, or a size with the bitrate it is held under. */
const limitLabel = (limit: RemoteLimit): string =>
  remoteLimitLabelOf({ limit, copy: REMOTE_ACCESS_COPY })

const LIMIT_OPTIONS = isRemoteLimit.values.map((limit) => ({
  key: limit,
  label: limitLabel(limit),
}))

type TextFieldSpec = { label: string; isNumber: boolean; placeholder?: string }

/** The settings the form edits as text, in the web's order. */
const TEXT_FIELDS = {
  hostname: { label: REMOTE_ACCESS_COPY.hostname, isNumber: false },
  publicPort: { label: REMOTE_ACCESS_COPY.publicPort, isNumber: true },
  privatePort: {
    label: REMOTE_ACCESS_COPY.privatePort,
    isNumber: true,
    placeholder: REMOTE_ACCESS_COPY.privatePortPlaceholder,
  },
  uploadMbps: { label: REMOTE_ACCESS_COPY.uploadMbps, isNumber: true },
} as const satisfies Record<RemoteAccessTextField, TextFieldSpec>

type StatusLinesProps = { status: RemoteAccessStatus }

/** Whether raven is reachable from outside, and what to do when not. */
const StatusLines = ({ status }: StatusLinesProps) => (
  <>
    <SettingsLine text={REMOTE_ACCESS_STATUS_COPY[status.state]} />
    {status.state === REMOTE_ACCESS_STATES.unreachable && (
      <SettingsLine text={REACHABILITY_PROBLEM_COPY[status.problem]} />
    )}
    {status.state === REMOTE_ACCESS_STATES.reachable && !status.isClientAddressForwarded && (
      <SettingsLine text={REMOTE_ACCESS_COPY.notForwarded} />
    )}
  </>
)

type RouteLinesProps = { state: RemoteAccessState }

/** The private address, then the public one, as Plex draws the way in. */
const RouteLines = ({ state }: RouteLinesProps) => {
  const { privateHop, publicHop } = remoteAccessHopsOf(state)
  return (
    <>
      <SettingsLine
        text={REMOTE_ACCESS_COPY.hop({
          label: REMOTE_ACCESS_COPY.privateLabel,
          address: addressLineOf({ ...privateHop, copy: REMOTE_ACCESS_COPY }),
        })}
      />
      <SettingsLine
        text={REMOTE_ACCESS_COPY.hop({
          label: REMOTE_ACCESS_COPY.publicLabel,
          address: addressLineOf({ ...publicHop, copy: REMOTE_ACCESS_COPY }),
        })}
      />
    </>
  )
}

type FormProps = {
  settings: RemoteAccessSettings
  isBusy: boolean
  onApply: (change: RemoteAccessChange) => void
}

/** The settings as a form: nothing is saved until Apply, which checks again from outside. */
const RemoteAccessForm = ({ settings, isBusy, onApply }: FormProps) => {
  const [draft, setDraft] = useState(() => remoteAccessDraftOf(settings))
  const change = (next: Partial<RemoteAccessDraft>) =>
    setDraft((current) => ({ ...current, ...next }))
  const upload = draftNumberOf(draft.uploadMbps)
  const cap = remoteQualityFor({ remoteLimit: draft.remoteLimit, uploadMbps: upload })
  return (
    <>
      <SettingsToggle
        hint={REMOTE_ACCESS_COPY.enableHint}
        isOn={draft.isEnabled}
        label={REMOTE_ACCESS_COPY.enable}
        onToggle={(isEnabled) => change({ isEnabled })}
      />
      {REMOTE_ACCESS_TEXT_FIELDS.map((name) => {
        const field: TextFieldSpec = TEXT_FIELDS[name]
        return (
          <Field
            key={name}
            isNumber={field.isNumber}
            label={field.label}
            onChangeText={(text) => change({ [name]: text })}
            onSubmit={({ text }) => onApply(remoteAccessChangeOf({ ...draft, [name]: text }))}
            placeholder={field.placeholder}
            value={draft[name]}
          />
        )
      })}
      <SettingsChoice
        label={REMOTE_ACCESS_COPY.remoteLimit}
        onChoose={(remoteLimit) => change({ remoteLimit })}
        options={LIMIT_OPTIONS}
        value={draft.remoteLimit}
      />
      {cap !== null && upload !== null && (
        <SettingsLine
          text={REMOTE_ACCESS_COPY.streamsHint({
            quality: limitLabel(cap),
            streams: remoteStreamsAt({ quality: cap, uploadMbps: upload }),
          })}
        />
      )}
      <SettingsButton
        isDisabled={isBusy}
        onPress={() => onApply(remoteAccessChangeOf(draft))}
        text={REMOTE_ACCESS_COPY.apply}
      />
      <SettingsButton
        isDisabled={isBusy}
        onPress={() => onApply({})}
        text={REMOTE_ACCESS_COPY.checkAgain}
      />
    </>
  )
}

type CheckTextOfProps = { isChecking: boolean; status: RemoteAccessStatus }

/** What the line under the route says: a check running, when the last one looked, or nothing. */
const checkTextOf = ({ isChecking, status }: CheckTextOfProps): string | null => {
  if (isChecking) return REMOTE_ACCESS_COPY.checking
  const checkedAt = checkedTimeOf(status)
  return checkedAt === null ? null : REMOTE_ACCESS_COPY.checkedAt(checkedAt)
}

type AdminRemoteAccessProps = { session: AppQueries }

/**
 * Admin's Remote Access, as the web's: whether raven is reachable from outside the home
 * network, the private and public address and port, the upload speed and the remote limit.
 */
export const AdminRemoteAccess = ({ session: { api } }: AdminRemoteAccessProps) => {
  const { state, save } = useServerRemoteAccess({ api })
  const checkText =
    state.data === undefined
      ? null
      : checkTextOf({ isChecking: save.isPending, status: state.data.status })
  return (
    <SettingsSection note={REMOTE_ACCESS_COPY.help} title={REMOTE_ACCESS_COPY.heading}>
      {state.isPending && <SettingsLine text={ADMIN_COPY.reading} />}
      {state.error !== null && <SettingsLine isAlert text={state.error.message} />}
      {state.data !== undefined && (
        <>
          <StatusLines status={state.data.status} />
          <RouteLines state={state.data} />
          {checkText !== null && <SettingsLine text={checkText} />}
          {/* Keyed by the read, so whatever reads Remote Access again starts the draft again. */}
          <RemoteAccessForm
            key={state.dataUpdatedAt}
            isBusy={save.isPending}
            onApply={(change) => save.mutate(change)}
            settings={state.data.settings}
          />
        </>
      )}
      {save.error !== null && (
        <SettingsLine isAlert text={`${ADMIN_COPY.saveFailed}${save.error.message}`} />
      )}
    </SettingsSection>
  )
}
