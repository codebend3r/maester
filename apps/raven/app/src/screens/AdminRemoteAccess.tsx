import {
  type ApiClient,
  REMOTE_ACCESS_STATES,
  REMOTE_LIMITS,
  type RemoteAccessChange,
  type RemoteAccessSettings,
  type RemoteAccessState,
  type RemoteAccessStatus,
  type RemoteLimit,
  STREAM_QUALITIES,
  checkFactsOf,
  formatBitrate,
  isRemoteLimit,
  remoteQualityFor,
  remoteStreamsAt,
} from '@raven/core'
import { queryKeys } from '@raven/ui/headless'
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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

/** Remote Access for the owner: the settings, the addresses and what the outside check found. */
const remoteAccessQueryFor = (api: ApiClient) =>
  queryOptions({ queryKey: queryKeys.remoteAccess, queryFn: () => api.getRemoteAccess() })

/** A limit's words: Original, or a size with the bitrate it is held under. */
const limitLabel = (limit: RemoteLimit): string =>
  limit === REMOTE_LIMITS.original
    ? REMOTE_ACCESS_COPY.original
    : `${STREAM_QUALITIES[limit].label}, ${formatBitrate(STREAM_QUALITIES[limit].bitrate) ?? ''}`

const LIMIT_OPTIONS = isRemoteLimit.values.map((limit) => ({
  key: limit,
  label: limitLabel(limit),
}))

/** What a field holds as the text it shows: '' for none. */
const textOf = (value: number | string | null): string => (value === null ? '' : String(value))

/** A field's number, or null when it is blank. */
const numberOf = (text: string): number | null => (text.trim() === '' ? null : Number(text))

type AddressProps = { address: string | null; port: number | null }

/** `address:port`, saying which of the two is not known yet. */
const addressLine = ({ address, port }: AddressProps): string =>
  `${address ?? REMOTE_ACCESS_COPY.unknownAddress}:${port ?? REMOTE_ACCESS_COPY.noPort}`

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
} as const satisfies Partial<Record<keyof RemoteAccessSettings, TextFieldSpec>>

type TextFieldName = keyof typeof TEXT_FIELDS

const isTextFieldName = (name: string): name is TextFieldName => name in TEXT_FIELDS

const TEXT_FIELD_NAMES = Object.keys(TEXT_FIELDS).filter(isTextFieldName)

/** The form's draft: the settings, each text field as the text it shows. */
type Draft = Omit<RemoteAccessSettings, TextFieldName> & Record<TextFieldName, string>

const draftOf = (settings: RemoteAccessSettings): Draft => ({
  isEnabled: settings.isEnabled,
  hostname: textOf(settings.hostname),
  publicPort: textOf(settings.publicPort),
  privatePort: textOf(settings.privatePort),
  uploadMbps: textOf(settings.uploadMbps),
  remoteLimit: settings.remoteLimit,
})

/** The change Apply sends: every field, a blank one as none and the hostname as a certificate names it. */
const changeOf = (draft: Draft): RemoteAccessChange => {
  const hostname = draft.hostname.trim().toLowerCase()
  return {
    isEnabled: draft.isEnabled,
    hostname: hostname === '' ? null : hostname,
    publicPort: numberOf(draft.publicPort),
    privatePort: numberOf(draft.privatePort),
    uploadMbps: numberOf(draft.uploadMbps),
    remoteLimit: draft.remoteLimit,
  }
}

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
const RouteLines = ({ state: { settings, status, privateAddress } }: RouteLinesProps) => {
  const publicAddress = checkFactsOf(status)?.publicAddress ?? null
  return (
    <>
      <SettingsLine
        text={REMOTE_ACCESS_COPY.hop({
          label: REMOTE_ACCESS_COPY.privateLabel,
          address: addressLine({
            address: privateAddress,
            port: settings.privatePort ?? settings.publicPort,
          }),
        })}
      />
      <SettingsLine
        text={REMOTE_ACCESS_COPY.hop({
          label: REMOTE_ACCESS_COPY.publicLabel,
          address: addressLine({
            address: publicAddress ?? settings.hostname,
            port: settings.publicPort,
          }),
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
  const [draft, setDraft] = useState(() => draftOf(settings))
  const change = (next: Partial<Draft>) => setDraft((current) => ({ ...current, ...next }))
  const upload = numberOf(draft.uploadMbps)
  const cap = remoteQualityFor({ remoteLimit: draft.remoteLimit, uploadMbps: upload })
  return (
    <>
      <SettingsToggle
        hint={REMOTE_ACCESS_COPY.enableHint}
        isOn={draft.isEnabled}
        label={REMOTE_ACCESS_COPY.enable}
        onToggle={(isEnabled) => change({ isEnabled })}
      />
      {TEXT_FIELD_NAMES.map((name) => {
        const field: TextFieldSpec = TEXT_FIELDS[name]
        return (
          <Field
            key={name}
            isNumber={field.isNumber}
            label={field.label}
            onChangeText={(text) => change({ [name]: text })}
            onSubmit={({ text }) => onApply(changeOf({ ...draft, [name]: text }))}
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
        onPress={() => onApply(changeOf(draft))}
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

/** When the outside check last looked, in the viewer's time; null before any check. */
const checkedTimeOf = (status: RemoteAccessStatus): string | null => {
  const facts = checkFactsOf(status)
  return facts === null ? null : new Date(facts.checkedAt).toLocaleTimeString()
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
  const queryClient = useQueryClient()
  const query = remoteAccessQueryFor(api)
  const state = useQuery(query)
  const save = useMutation({
    mutationFn: (change: RemoteAccessChange) => api.setRemoteAccess(change),
    onSuccess: (next) => queryClient.setQueryData(query.queryKey, next),
  })
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
