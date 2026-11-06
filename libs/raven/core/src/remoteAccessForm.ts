import {
  REMOTE_LIMITS,
  type RemoteAccessChange,
  type RemoteAccessSettings,
  type RemoteAccessState,
  type RemoteAccessStatus,
  type RemoteLimit,
  STREAM_QUALITIES,
} from '@/contract'
import { formatBitrate } from '@/format'
import { checkFactsOf } from '@/remoteAccess'

/** The Remote Access settings a form edits as text, in the order every client shows them. */
export const REMOTE_ACCESS_TEXT_FIELDS = [
  'hostname',
  'publicPort',
  'privatePort',
  'uploadMbps',
] as const satisfies ReadonlyArray<keyof RemoteAccessSettings>

export type RemoteAccessTextField = (typeof REMOTE_ACCESS_TEXT_FIELDS)[number]

/** A Remote Access form's draft: the settings, each text field as the text it shows. */
export type RemoteAccessDraft = Omit<RemoteAccessSettings, RemoteAccessTextField> &
  Record<RemoteAccessTextField, string>

/** What a field holds as the text it shows: '' for none. */
const textOf = (value: number | string | null): string => (value === null ? '' : String(value))

/** A field's number, or null when it is blank. */
export const draftNumberOf = (text: string): number | null =>
  text.trim() === '' ? null : Number(text)

/** The draft a form starts from: the settings as they stand. */
export const remoteAccessDraftOf = (settings: RemoteAccessSettings): RemoteAccessDraft => ({
  isEnabled: settings.isEnabled,
  hostname: textOf(settings.hostname),
  publicPort: textOf(settings.publicPort),
  privatePort: textOf(settings.privatePort),
  uploadMbps: textOf(settings.uploadMbps),
  remoteLimit: settings.remoteLimit,
})

/** The change Apply sends: every field, a blank one as none and the hostname as a certificate names it. */
export const remoteAccessChangeOf = (draft: RemoteAccessDraft): RemoteAccessChange => {
  const hostname = draft.hostname.trim().toLowerCase()
  return {
    isEnabled: draft.isEnabled,
    hostname: hostname === '' ? null : hostname,
    publicPort: draftNumberOf(draft.publicPort),
    privatePort: draftNumberOf(draft.privatePort),
    uploadMbps: draftNumberOf(draft.uploadMbps),
    remoteLimit: draft.remoteLimit,
  }
}

type LimitCopy = { original: string }

type RemoteLimitLabelProps = { limit: RemoteLimit; copy: LimitCopy }

/** A limit's words: the client's Original, or a size with the bitrate it is held under. */
export const remoteLimitLabelOf = ({ limit, copy }: RemoteLimitLabelProps): string =>
  limit === REMOTE_LIMITS.original
    ? copy.original
    : `${STREAM_QUALITIES[limit].label}, ${formatBitrate(STREAM_QUALITIES[limit].bitrate) ?? ''}`

/** One hop on the way in: an address and its port, either not known yet. */
type AddressHop = { address: string | null; port: number | null }

type RemoteAccessHops = { privateHop: AddressHop; publicHop: AddressHop }

/** The private hop, then the public one, as Plex draws the way in. */
export const remoteAccessHopsOf = ({
  settings,
  status,
  privateAddress,
}: RemoteAccessState): RemoteAccessHops => ({
  privateHop: { address: privateAddress, port: settings.privatePort ?? settings.publicPort },
  publicHop: {
    address: checkFactsOf(status)?.publicAddress ?? settings.hostname,
    port: settings.publicPort,
  },
})

type AddressCopy = { unknownAddress: string; noPort: string }

type AddressLineProps = AddressHop & { copy: AddressCopy }

/** `address:port`, in the client's words for whichever of the two is not known yet. */
export const addressLineOf = ({ address, port, copy }: AddressLineProps): string =>
  `${address ?? copy.unknownAddress}:${port ?? copy.noPort}`

/** When the outside check last looked, in the viewer's time; null before any check. */
export const checkedTimeOf = (status: RemoteAccessStatus): string | null => {
  const facts = checkFactsOf(status)
  return facts === null ? null : new Date(facts.checkedAt).toLocaleTimeString()
}
