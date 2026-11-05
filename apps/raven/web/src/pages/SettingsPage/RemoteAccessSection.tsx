import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  MAX_UPLOAD_MBPS,
  PORT_RANGE,
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
import { Button } from '@raven/ui'
import { type FormEvent, type InputHTMLAttributes, type ReactNode, useId, useState } from 'react'
import { api } from '@/lib/api'
import { remoteAccessQuery } from '@/lib/queries'
import { SettingsSection, SettingsSkeleton } from '@/pages/SettingsPage/Setting'
import {
  REACHABILITY_PROBLEM_COPY,
  REMOTE_ACCESS_COPY,
  REMOTE_ACCESS_STATUS_COPY,
} from '@/pages/SettingsPage/remoteAccessCopy'
import pageStyles from '@/pages/SettingsPage/SettingsPage.module.scss'
import styles from '@/pages/SettingsPage/RemoteAccessSection.module.scss'

/** How the status line reads: good once reachable, a problem once not, plain otherwise. */
const STATUS_TONES = {
  [REMOTE_ACCESS_STATES.disabled]: styles.plain,
  [REMOTE_ACCESS_STATES.unconfigured]: styles.plain,
  [REMOTE_ACCESS_STATES.unchecked]: styles.plain,
  [REMOTE_ACCESS_STATES.reachable]: styles.good,
  [REMOTE_ACCESS_STATES.unreachable]: styles.bad,
} as const satisfies Record<RemoteAccessStatus['state'], string | undefined>

const SINGLE_SPACE = ' '

/** A limit's words: Original, or a size with the bitrate it is held under. */
const limitLabel = (limit: RemoteLimit): string =>
  limit === REMOTE_LIMITS.original
    ? REMOTE_ACCESS_COPY.original
    : `${STREAM_QUALITIES[limit].label}, ${formatBitrate(STREAM_QUALITIES[limit].bitrate) ?? ''}`

const HOSTNAME_INPUT = { type: 'text', inputMode: 'url' } as const

const PORT_INPUT = {
  type: 'number',
  inputMode: 'numeric',
  min: PORT_RANGE.min,
  max: PORT_RANGE.max,
  step: 1,
} as const

const UPLOAD_INPUT = {
  type: 'number',
  inputMode: 'decimal',
  min: 0.1,
  max: MAX_UPLOAD_MBPS,
  step: 'any',
} as const

/** What a field holds as the text its input shows: '' for none. */
const textOf = (value: number | string | null): string => (value === null ? '' : String(value))

/** A field's number, or null when it is blank. */
const numberOf = (text: string): number | null => (text.trim() === '' ? null : Number(text))

type AddressProps = { address: string | null; port: number | null }

/** `address:port`, saying which of the two is not known yet. */
const addressLine = ({ address, port }: AddressProps): string =>
  `${address ?? REMOTE_ACCESS_COPY.unknownAddress}:${port ?? REMOTE_ACCESS_COPY.noPort}`

type StatusProps = { status: RemoteAccessStatus }

/** The status line, as Plex's: whether raven is reachable from outside, and what to do when not. */
const RemoteAccessStatusLine = ({ status }: StatusProps) => (
  <div className={styles.status} aria-live="polite">
    <p className={[styles.headline, STATUS_TONES[status.state]].join(SINGLE_SPACE)}>
      {REMOTE_ACCESS_STATUS_COPY[status.state]}
    </p>
    {status.state === REMOTE_ACCESS_STATES.unreachable && (
      <p className={pageStyles.hint}>{REACHABILITY_PROBLEM_COPY[status.problem]}</p>
    )}
    {status.state === REMOTE_ACCESS_STATES.reachable && !status.isClientAddressForwarded && (
      <p className={pageStyles.hint}>{REMOTE_ACCESS_COPY.notForwarded}</p>
    )}
  </div>
)

type RouteProps = { state: RemoteAccessState }

/** Private, then public, then the internet, as Plex draws the way in. */
const RemoteAccessRoute = ({ state }: RouteProps) => {
  const { settings, status, privateAddress } = state
  const publicAddress = checkFactsOf(status)?.publicAddress ?? null
  return (
    <ol className={styles.route} aria-label={REMOTE_ACCESS_COPY.route}>
      <li className={styles.hop}>
        <span className={styles.hopLabel}>{REMOTE_ACCESS_COPY.privateLabel}</span>
        <span className={styles.hopValue}>
          {addressLine({
            address: privateAddress,
            port: settings.privatePort ?? settings.publicPort,
          })}
        </span>
      </li>
      <li className={styles.hop}>
        <span className={styles.hopLabel}>{REMOTE_ACCESS_COPY.publicLabel}</span>
        <span className={styles.hopValue}>
          {addressLine({
            address: publicAddress ?? settings.hostname,
            port: settings.publicPort,
          })}
        </span>
      </li>
      <li className={styles.hop}>
        <span className={styles.hopLabel}>{REMOTE_ACCESS_COPY.internet}</span>
      </li>
    </ol>
  )
}

type FieldControlProps = { id: string; hintId: string }

type FieldProps = {
  label: string
  hint: string
  /** The control, given the ids its label and its hint name. */
  children: (control: FieldControlProps) => ReactNode
}

/** One labelled control with what it means under it. */
const Field = ({ label, hint, children }: FieldProps) => {
  const id = useId()
  const hintId = useId()
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.fieldLabel}>
        {label}
      </label>
      {children({ id, hintId })}
      <span id={hintId} className={styles.fieldHint}>
        {hint}
      </span>
    </div>
  )
}

type TextFieldSpec = {
  label: string
  hint: string
  /** What the input takes, so the browser checks it before Apply. */
  input: Pick<InputHTMLAttributes<HTMLInputElement>, 'type' | 'inputMode' | 'min' | 'max' | 'step'>
  placeholder?: string
}

/** The settings the form edits as text, in the order it shows them. */
const TEXT_FIELDS = {
  hostname: {
    label: REMOTE_ACCESS_COPY.hostname,
    hint: REMOTE_ACCESS_COPY.hostnameHint,
    input: HOSTNAME_INPUT,
  },
  publicPort: {
    label: REMOTE_ACCESS_COPY.publicPort,
    hint: REMOTE_ACCESS_COPY.publicPortHint,
    input: PORT_INPUT,
  },
  privatePort: {
    label: REMOTE_ACCESS_COPY.privatePort,
    hint: REMOTE_ACCESS_COPY.privatePortHint,
    input: PORT_INPUT,
    placeholder: REMOTE_ACCESS_COPY.privatePortPlaceholder,
  },
  uploadMbps: {
    label: REMOTE_ACCESS_COPY.uploadMbps,
    hint: REMOTE_ACCESS_COPY.uploadHint,
    input: UPLOAD_INPUT,
  },
} as const satisfies Partial<Record<keyof RemoteAccessSettings, TextFieldSpec>>

type TextFieldName = keyof typeof TEXT_FIELDS

const isTextFieldName = (name: string): name is TextFieldName => name in TEXT_FIELDS

const TEXT_FIELD_NAMES = Object.keys(TEXT_FIELDS).filter(isTextFieldName)

/** The form's draft: the settings, each text field as the text its input shows. */
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

type FormProps = {
  settings: RemoteAccessSettings
  onApply: (change: RemoteAccessChange) => void
}

/** The settings as a form: nothing is saved until Apply, which checks again from outside. */
const RemoteAccessForm = ({ settings, onApply }: FormProps) => {
  const [draft, setDraft] = useState(() => draftOf(settings))
  const edit = (change: Partial<Draft>) => setDraft((current) => ({ ...current, ...change }))
  const upload = numberOf(draft.uploadMbps)
  const cap = remoteQualityFor({ remoteLimit: draft.remoteLimit, uploadMbps: upload })

  const apply = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    onApply(changeOf(draft))
  }

  return (
    <form className={styles.form} onSubmit={apply}>
      <label className={pageStyles.choice}>
        <input
          type="checkbox"
          checked={draft.isEnabled}
          onChange={(event) => edit({ isEnabled: event.target.checked })}
        />
        <span className={pageStyles.choiceLabel}>{REMOTE_ACCESS_COPY.enable}</span>
        <span className={pageStyles.choiceHint}>{REMOTE_ACCESS_COPY.enableHint}</span>
      </label>
      {TEXT_FIELD_NAMES.map((name) => {
        const field: TextFieldSpec = TEXT_FIELDS[name]
        return (
          <Field key={name} label={field.label} hint={field.hint}>
            {({ id, hintId }) => (
              <input
                id={id}
                className={styles.input}
                value={draft[name]}
                {...field.input}
                placeholder={field.placeholder}
                aria-describedby={hintId}
                onChange={(event) => edit({ [name]: event.target.value })}
              />
            )}
          </Field>
        )
      })}
      <Field label={REMOTE_ACCESS_COPY.remoteLimit} hint={REMOTE_ACCESS_COPY.remoteLimitHint}>
        {({ id, hintId }) => (
          <select
            id={id}
            className={styles.input}
            value={draft.remoteLimit}
            aria-describedby={hintId}
            onChange={(event) => {
              const picked = event.target.value
              if (isRemoteLimit(picked)) edit({ remoteLimit: picked })
            }}
          >
            {isRemoteLimit.values.map((limit) => (
              <option key={limit} value={limit}>
                {limitLabel(limit)}
              </option>
            ))}
          </select>
        )}
      </Field>
      {cap !== null && upload !== null && (
        <p className={pageStyles.hint}>
          {REMOTE_ACCESS_COPY.streamsHint({
            quality: limitLabel(cap),
            streams: remoteStreamsAt({ quality: cap, uploadMbps: upload }),
          })}
        </p>
      )}
      <div className={styles.actions}>
        <Button type="submit" tone="primary">
          {REMOTE_ACCESS_COPY.apply}
        </Button>
        <Button type="button" onClick={() => onApply({})}>
          {REMOTE_ACCESS_COPY.checkAgain}
        </Button>
      </div>
    </form>
  )
}

/** When the outside check last looked, in the viewer's time; null before any check. */
const checkedTimeOf = (status: RemoteAccessStatus): string | null => {
  const facts = checkFactsOf(status)
  return facts === null ? null : new Date(facts.checkedAt).toLocaleTimeString()
}

/**
 * Admin's Remote Access, modelled on Plex's: whether raven is reachable from
 * outside the home network, the private and public address and port, the
 * public port to forward, the upload speed and the limit on remote streams.
 */
export const RemoteAccessSection = () => {
  const queryClient = useQueryClient()
  const state = useQuery(remoteAccessQuery)
  const save = useMutation({
    mutationFn: (change: RemoteAccessChange) => api.setRemoteAccess(change),
    onSuccess: (next) => queryClient.setQueryData(remoteAccessQuery.queryKey, next),
  })
  return (
    <SettingsSection
      icon="globe"
      title={REMOTE_ACCESS_COPY.heading}
      hint={REMOTE_ACCESS_COPY.help}
      isResetting={save.isPending}
      query={state}
      shape={<SettingsSkeleton count={3} />}
      saveError={save.error}
    >
      {(data) => {
        const checkedAt = checkedTimeOf(data.status)
        return (
          <>
            <RemoteAccessStatusLine status={data.status} />
            <RemoteAccessRoute state={data} />
            <p className={pageStyles.hint} aria-live="polite">
              {save.isPending && REMOTE_ACCESS_COPY.checking}
              {!save.isPending &&
                checkedAt !== null &&
                REMOTE_ACCESS_COPY.checkedAt({ at: checkedAt })}
            </p>
            {/* Keyed by the read, so whatever reads Remote Access again starts the draft again. */}
            <RemoteAccessForm
              key={state.dataUpdatedAt}
              settings={data.settings}
              onApply={(change) => save.mutate(change)}
            />
          </>
        )
      }}
    </SettingsSection>
  )
}
