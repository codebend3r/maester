import {
  AUTH_REFUSALS,
  DOWNLOAD_STATUS_KINDS,
  type Infer,
  isBoolean,
  isNumber,
  isString,
  listOf,
  object,
  oneOf,
  union,
} from '@raven/core'
import {
  DOWNLOADING,
  DOWNLOADS_VERSION,
  EMPTY_DOWNLOADS,
  ENTRY_FIELDS,
  type EntryStatus,
  FAIL_REASONS,
  isDownloadsState,
  isOwed,
  isPending,
  OWED_FIELDS,
  PAUSED,
  type Pending,
  PENDING_FIELDS,
  QUEUED,
  READY,
  type DownloadsState,
} from '@/main/downloads/downloadState'
import { JSON_READ_KINDS, readJsonFile, type JsonStore, type StateFs } from '@/main/stateStore'

/** What version 1 kept pending, before a play belonged to an account. */
const isPendingV1 = object(PENDING_FIELDS)

/** The reasons versions 1 and 2 failed a download for: `unauthorized` was read but never written. */
const V2_FAIL_REASONS = {
  noSpace: 'noSpace',
  changed: 'changed',
  unauthorized: 'unauthorized',
  unreachable: 'unreachable',
  gone: 'gone',
  other: 'other',
} as const

/** A status as versions 1 and 2 kept it: every failure carried a message, empty but for `other`. */
const isEntryStatusV2 = union(
  QUEUED,
  DOWNLOADING,
  PAUSED,
  object({
    kind: oneOf([DOWNLOAD_STATUS_KINDS.failed]),
    bytes: isNumber,
    reason: oneOf(Object.values(V2_FAIL_REASONS)),
    message: isString,
  }),
  READY,
)

const isDownloadsV2 = object({
  version: oneOf([2]),
  entries: listOf(object({ ...ENTRY_FIELDS, status: isEntryStatusV2, pending: isPending })),
  autoDeleteDefault: isBoolean,
  owed: listOf(isOwed),
})

const isDownloadsV1 = object({
  version: oneOf([1]),
  entries: listOf(object({ ...ENTRY_FIELDS, status: isEntryStatusV2, pending: isPendingV1 })),
  autoDeleteDefault: isBoolean,
  owed: listOf(object({ ...OWED_FIELDS, pending: isPendingV1 })),
})

/**
 * What `downloads.json` may hold: this version, the one before a failure kept only what its
 * reason needs, or the one before plays belonged to an account.
 */
const isStoredDownloads = union(isDownloadsV1, isDownloadsV2, isDownloadsState)

/** Version 1 noted no account, so what it kept pending goes to whoever is signed in, as it did. */
const sharedPending = ({ play, position, furthest, at }: Infer<typeof isPendingV1>): Pending => ({
  play,
  position,
  furthest,
  at,
  accountId: null,
})

type StatusV2 = Infer<typeof isEntryStatusV2>

/**
 * A version 2 status as this version keeps it: a failure keeps only what its reason needs. The
 * `unauthorized` no version wrote is the account signed out; an `other` keeps its words.
 */
const statusFromV2 = (status: StatusV2): EntryStatus => {
  if (status.kind !== DOWNLOAD_STATUS_KINDS.failed) return status
  const { bytes, reason, message } = status
  const failed = DOWNLOAD_STATUS_KINDS.failed
  switch (reason) {
    case V2_FAIL_REASONS.unauthorized:
      return { kind: failed, bytes, reason: FAIL_REASONS.account, refusal: AUTH_REFUSALS.signedOut }
    case V2_FAIL_REASONS.other:
      return { kind: failed, bytes, reason: FAIL_REASONS.other, message }
    case V2_FAIL_REASONS.noSpace:
    case V2_FAIL_REASONS.changed:
    case V2_FAIL_REASONS.unreachable:
    case V2_FAIL_REASONS.gone:
      return { kind: failed, bytes, reason }
    default: {
      const unreachable: never = reason
      return unreachable
    }
  }
}

type V2Downloads = Infer<typeof isDownloadsV2>

const fromV2 = (stored: V2Downloads): DownloadsState => ({
  ...stored,
  version: DOWNLOADS_VERSION,
  entries: stored.entries.map((entry) => ({ ...entry, status: statusFromV2(entry.status) })),
})

const upgradeDownloads = (stored: Infer<typeof isStoredDownloads>): DownloadsState => {
  switch (stored.version) {
    case 1:
      return fromV2({
        version: 2,
        entries: stored.entries.map((entry) => ({
          ...entry,
          pending: sharedPending(entry.pending),
        })),
        autoDeleteDefault: stored.autoDeleteDefault,
        owed: stored.owed.map((item) => ({ ...item, pending: sharedPending(item.pending) })),
      })
    case 2:
      return fromV2(stored)
    case DOWNLOADS_VERSION:
      return stored
    default: {
      const unreachable: never = stored
      return unreachable
    }
  }
}

export type DownloadsStore = JsonStore<DownloadsState>

export const DOWNLOADS_DEBOUNCE_MS = 1000

/** The downloads, and whether an unreadable `downloads.json` was set aside to load them empty. */
export type LoadedDownloads = { state: DownloadsState; wasSetAside: boolean }

type LoadDownloadsProps = {
  fs: StateFs
  file: string
  now: () => number
}

export const loadDownloads = async ({
  fs,
  file,
  now,
}: LoadDownloadsProps): Promise<LoadedDownloads> => {
  const read = await readJsonFile({ fs, file, now, guard: isStoredDownloads })
  switch (read.kind) {
    case JSON_READ_KINDS.read:
      return { state: upgradeDownloads(read.value), wasSetAside: false }
    case JSON_READ_KINDS.missing:
      return { state: EMPTY_DOWNLOADS, wasSetAside: false }
    case JSON_READ_KINDS.setAside:
      return { state: EMPTY_DOWNLOADS, wasSetAside: true }
    default: {
      const unreachable: never = read
      return unreachable
    }
  }
}
