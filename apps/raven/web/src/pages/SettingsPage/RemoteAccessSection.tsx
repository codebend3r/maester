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
  formatBitrate,
  isRemoteLimit,
  remoteQualityFor,
  remoteStreamsAt,
} from '@raven/core'
import { Button } from '@raven/ui'
import { type FormEvent, type InputHTMLAttributes, useId, useState } from 'react'
import { Loading } from '@/components/Skeleton/Skeleton'
import { api } from '@/lib/api'
import { Section } from '@/pages/SettingsPage/Section'
import { SettingsSkeleton } from '@/pages/SettingsPage/Setting'
import {
  REACHABILITY_PROBLEM_COPY,
  REMOTE_ACCESS_COPY,
  REMOTE_ACCESS_STATUS_COPY,
} from '@/pages/SettingsPage/remoteAccessCopy'
import pageStyles from '@/pages/SettingsPage/SettingsPage.module.scss'
import styles from '@/pages/SettingsPage/RemoteAccessSection.module.scss'

/** The query key Remote Access is kept under; only this section reads it. */
const REMOTE_ACCESS_QUERY_KEY = ['remoteAccess'] as const

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
  const publicAddress = 'publicAddress' in status ? status.publicAddress : null
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

type FieldProps = {
  label: string
  hint: string
  value: string
  onChange: (value: string) => void
  /** What the input takes, so the browser checks it before Apply. */
  input: Pick<InputHTMLAttributes<HTMLInputElement>, 'type' | 'inputMode' | 'min' | 'max' | 'step'>
  placeholder?: string
}

/** One labelled text field with what it means under it. */
const Field = ({ label, hint, value, onChange, input, placeholder }: FieldProps) => {
  const id = useId()
  const hintId = useId()
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.fieldLabel}>
        {label}
      </label>
      <input
        id={id}
        className={styles.input}
        value={value}
        {...input}
        placeholder={placeholder}
        aria-describedby={hintId}
        onChange={(event) => onChange(event.target.value)}
      />
      <span id={hintId} className={styles.fieldHint}>
        {hint}
      </span>
    </div>
  )
}

type FormProps = {
  settings: RemoteAccessSettings
  isSaving: boolean
  onApply: (change: RemoteAccessChange) => void
}

/** The settings as a form: nothing is saved until Apply, which checks again from outside. */
const RemoteAccessForm = ({ settings, isSaving, onApply }: FormProps) => {
  const limitId = useId()
  const [isEnabled, setEnabled] = useState(settings.isEnabled)
  const [hostname, setHostname] = useState(textOf(settings.hostname))
  const [publicPort, setPublicPort] = useState(textOf(settings.publicPort))
  const [privatePort, setPrivatePort] = useState(textOf(settings.privatePort))
  const [uploadMbps, setUploadMbps] = useState(textOf(settings.uploadMbps))
  const [remoteLimit, setRemoteLimit] = useState<RemoteLimit>(settings.remoteLimit)
  const upload = numberOf(uploadMbps)
  const cap = remoteQualityFor({ remoteLimit, uploadMbps: upload })

  const apply = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = hostname.trim().toLowerCase()
    onApply({
      isEnabled,
      hostname: name === '' ? null : name,
      publicPort: numberOf(publicPort),
      privatePort: numberOf(privatePort),
      uploadMbps: upload,
      remoteLimit,
    })
  }

  return (
    <form className={styles.form} onSubmit={apply}>
      {/* The section names these already, so the fieldset is no group of its own to a screen reader. */}
      <fieldset role="none" className={pageStyles.settings} disabled={isSaving}>
        <label className={pageStyles.choice}>
          <input
            type="checkbox"
            checked={isEnabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          <span className={pageStyles.choiceLabel}>{REMOTE_ACCESS_COPY.enable}</span>
          <span className={pageStyles.choiceHint}>{REMOTE_ACCESS_COPY.enableHint}</span>
        </label>
        <Field
          label={REMOTE_ACCESS_COPY.hostname}
          hint={REMOTE_ACCESS_COPY.hostnameHint}
          value={hostname}
          onChange={setHostname}
          input={HOSTNAME_INPUT}
        />
        <Field
          label={REMOTE_ACCESS_COPY.publicPort}
          hint={REMOTE_ACCESS_COPY.publicPortHint}
          value={publicPort}
          onChange={setPublicPort}
          input={PORT_INPUT}
        />
        <Field
          label={REMOTE_ACCESS_COPY.privatePort}
          hint={REMOTE_ACCESS_COPY.privatePortHint}
          value={privatePort}
          onChange={setPrivatePort}
          input={PORT_INPUT}
          placeholder={REMOTE_ACCESS_COPY.privatePortPlaceholder}
        />
        <Field
          label={REMOTE_ACCESS_COPY.uploadMbps}
          hint={REMOTE_ACCESS_COPY.uploadHint}
          value={uploadMbps}
          onChange={setUploadMbps}
          input={UPLOAD_INPUT}
        />
        <div className={styles.field}>
          <label htmlFor={limitId} className={styles.fieldLabel}>
            {REMOTE_ACCESS_COPY.remoteLimit}
          </label>
          <select
            id={limitId}
            className={styles.input}
            value={remoteLimit}
            onChange={(event) => {
              const picked = event.target.value
              if (isRemoteLimit(picked)) setRemoteLimit(picked)
            }}
          >
            {isRemoteLimit.values.map((limit) => (
              <option key={limit} value={limit}>
                {limitLabel(limit)}
              </option>
            ))}
          </select>
          <span className={styles.fieldHint}>{REMOTE_ACCESS_COPY.remoteLimitHint}</span>
        </div>
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
      </fieldset>
    </form>
  )
}

/**
 * Admin's Remote Access, modelled on Plex's: whether raven is reachable from
 * outside the home network, the private and public address and port, the
 * public port to forward, the upload speed and the limit on remote streams.
 */
export const RemoteAccessSection = () => {
  const queryClient = useQueryClient()
  const state = useQuery({
    queryKey: REMOTE_ACCESS_QUERY_KEY,
    queryFn: () => api.getRemoteAccess(),
  })
  const save = useMutation({
    mutationFn: (change: RemoteAccessChange) => api.setRemoteAccess(change),
    onSuccess: (next) => queryClient.setQueryData(REMOTE_ACCESS_QUERY_KEY, next),
  })
  const checkedAt =
    state.data !== undefined && 'checkedAt' in state.data.status
      ? new Date(state.data.status.checkedAt).toLocaleTimeString()
      : null
  return (
    <Section icon="globe" title={REMOTE_ACCESS_COPY.heading} help={REMOTE_ACCESS_COPY.help}>
      {state.isError && (
        <p className={pageStyles.error} role="alert">
          {state.error.message}
        </p>
      )}
      {save.isError && (
        <p className={pageStyles.error} role="alert">
          {REMOTE_ACCESS_COPY.saveFailed}
          {save.error.message}
        </p>
      )}
      {state.data !== undefined && (
        <>
          <RemoteAccessStatusLine status={state.data.status} />
          <RemoteAccessRoute state={state.data} />
          <p className={pageStyles.hint} aria-live="polite">
            {save.isPending && REMOTE_ACCESS_COPY.checking}
            {!save.isPending &&
              checkedAt !== null &&
              REMOTE_ACCESS_COPY.checkedAt({ at: checkedAt })}
          </p>
          <RemoteAccessForm
            settings={state.data.settings}
            isSaving={save.isPending}
            onApply={(change) => save.mutate(change)}
          />
        </>
      )}
      {state.isPending && (
        <Loading label={REMOTE_ACCESS_COPY.reading}>
          <SettingsSkeleton count={3} />
        </Loading>
      )}
    </Section>
  )
}
