import { Inject, Injectable, Logger } from '@nestjs/common'
import {
  type TitleHolding,
  type TitleRequest,
  type TitleRequestAsk,
  type TitleRequests,
  isMatchItemType,
  isRequestStatus,
  ITEM_TYPES,
  type MatchItemType,
  REQUEST_STATUSES,
  type RequestBudget,
  type RequestStatus,
  requestKeyOf,
} from '@raven/core'
import { CLOCK, type Clock } from '@/clock'
import { SERVER_CONFIG, type ServerConfig } from '@/config'
import { DatabaseService } from '@/db/database'
import { errorMessage } from '@/errorMessage'
import type { AccountKey, ByAccount } from '@/media/viewingAccountKeys'
import { ARR_ERROR_KINDS, ArrClient, ArrError, type ArrTitle } from '@/requests/arrClient'
import { FreshReads } from '@/requests/freshReads'
import { letterFolderOf } from '@/requests/letterFolders'
import { statusOf } from '@/requests/requestStatus'

/** How far back an account's requests count against its budget. */
export const BUDGET_WINDOW_MS = 24 * 60 * 60 * 1000

/** How long a status read from an arr stands before a list asks the arr again. */
export const STATUS_FRESH_MS = 30_000

/** The only resolution a requested title may download at; a profile that allows any other is refused. */
const REQUEST_RESOLUTION = 1080

/** What a refusal says of a title its arr holds already: it downloads once it can, so nobody needs to ask. */
const HELD_ALREADY = 'The downloader holds this title already, so it downloads once a copy turns up'

/** A request the rules refuse: someone asked for the title already, its arr holds it, or the account's budget is spent. */
export class RequestRefusal extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RequestRefusal'
  }
}

/** A request's row, as SQLite hands it back. */
type RequestRow = {
  type: string
  tmdb_id: string
  account_id: string
  title: string
  requested_at: string
  arr_id: number | null
  command_id: number | null
  status: string
}

/** A row whose type and status the contract's guards have read. */
type KeptRequest = Omit<RequestRow, 'type' | 'status'> & {
  type: MatchItemType
  status: RequestStatus
}

const keptOf = (row: RequestRow): KeptRequest | null =>
  isMatchItemType(row.type) && isRequestStatus(row.status)
    ? { ...row, type: row.type, status: row.status }
    : null

type ListProps = { account: AccountKey }

type RequestProps = { account: AccountKey; ask: TitleRequestAsk }

type ViewOfProps = { row: KeptRequest; account: AccountKey }

type BudgetOfProps = { account: AccountKey; now: number }

type ReserveProps = RequestProps & { now: number }

type FinishProps = { ask: TitleRequestAsk; title: string; arrId: number; commandId: number }

type ReadStatusProps = { row: KeptRequest; arrId: number }

type KeepStatusProps = { row: KeptRequest; status: RequestStatus }

type AddToProps = { type: MatchItemType; found: ArrTitle }

/** The holding of a title its arr does not hold, or whose kind is off. */
const NOT_HELD = { status: null } as const satisfies TitleHolding

/** The statement parameters naming one request: its title's type and TMDB id. */
type TitleKeyParams = { type: string; tmdbId: string }

type StatusParams = TitleKeyParams & { status: string }

type SinceParams = ByAccount & { since: string }

type RequestedAtRow = { requested_at: string }

type TakenRow = { tmdb_id: string }

type InsertParams = ByAccount & TitleKeyParams & { at: string; status: string }

type FinishParams = TitleKeyParams & { title: string; arrId: number; commandId: number }

const viewOf = ({ row, account }: ViewOfProps): TitleRequest => ({
  type: row.type,
  tmdbId: row.tmdb_id,
  title: row.title,
  status: row.status,
  requestedAt: row.requested_at,
  isMine: row.account_id === account,
})

/**
 * Coming soon's requests. One request covers everyone, so a title is asked
 * for once; each account may ask for `dailyLimit` in any 24 hours. A request
 * goes to Sonarr for a show and Radarr for a movie, filed under the
 * library's letter folder, and where it stands is read back from that arr.
 */
@Injectable()
export class DownloadRequests {
  private readonly log = new Logger(DownloadRequests.name)
  /** Each request's status read from its arr, at most once every `STATUS_FRESH_MS`. */
  private readonly statusReads: FreshReads<void>
  /** Each title's holding as its arr answered it, at most once every `STATUS_FRESH_MS`. */
  private readonly holdingReads: FreshReads<TitleHolding>

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ArrClient) private readonly arrs: ArrClient,
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {
    this.statusReads = new FreshReads({ clock, freshMs: STATUS_FRESH_MS })
    this.holdingReads = new FreshReads({ clock, freshMs: STATUS_FRESH_MS })
  }

  private get db() {
    return this.database.db
  }

  private rows(): KeptRequest[] {
    return this.db
      .prepare<[], RequestRow>('SELECT * FROM download_requests ORDER BY requested_at DESC')
      .all()
      .map(keptOf)
      .filter((row): row is KeptRequest => row !== null)
  }

  private budgetOf({ account, now }: BudgetOfProps): RequestBudget {
    const since = new Date(now - BUDGET_WINDOW_MS).toISOString()
    const times = this.db
      .prepare<SinceParams, RequestedAtRow>(
        `SELECT requested_at FROM download_requests
          WHERE account_id = @account AND requested_at > @since
          ORDER BY requested_at`,
      )
      .all({ account, since })
      .map((row) => row.requested_at)
    const limit = this.config.requests.dailyLimit
    const left = Math.max(0, limit - times.length)
    const oldest = times[0]
    const nextAt =
      left > 0 || oldest === undefined
        ? null
        : new Date(Date.parse(oldest) + BUDGET_WINDOW_MS).toISOString()
    return { limit, left, nextAt }
  }

  /** Every request with its status read again where it is stale, the caller's budget, and which kinds are on. */
  async list({ account }: ListProps): Promise<TitleRequests> {
    await Promise.all(this.rows().map((row) => this.refresh(row)))
    return {
      requests: this.rows().map((row) => viewOf({ row, account })),
      budget: this.budgetOf({ account, now: this.clock.now() }),
      kinds: {
        [ITEM_TYPES.movie]: this.arrs.isOn(ITEM_TYPES.movie),
        [ITEM_TYPES.show]: this.arrs.isOn(ITEM_TYPES.show),
      },
    }
  }

  /** Reads a request's status from its arr unless it was read in the last `STATUS_FRESH_MS`; an arr that fails keeps the last one. */
  private refresh(row: KeptRequest): Promise<void> {
    if (row.arr_id === null || !this.arrs.isOn(row.type)) return Promise.resolve()
    const arrId = row.arr_id
    return this.statusReads.read({
      key: requestKeyOf({ type: row.type, tmdbId: row.tmdb_id }),
      read: () =>
        this.readStatus({ row, arrId })
          .then((status) => this.keepStatus({ row, status }))
          .catch((error: unknown) => {
            this.log.warn(`Kept the last status of a request: ${errorMessage(error)}`)
          }),
    })
  }

  private keepStatus({ row, status }: KeepStatusProps): void {
    this.db
      .prepare<StatusParams>(
        'UPDATE download_requests SET status = @status WHERE type = @type AND tmdb_id = @tmdbId',
      )
      .run({ type: row.type, tmdbId: row.tmdb_id, status })
  }

  private async readStatus({ row, arrId }: ReadStatusProps): Promise<RequestStatus> {
    const [progress, isSearching] = await Promise.all([
      this.arrs.progress({ type: row.type, arrId }),
      row.command_id === null
        ? Promise.resolve(false)
        : this.arrs.isCommandRunning({ type: row.type, commandId: row.command_id }),
    ])
    return statusOf({ progress, isSearching })
  }

  /** Whether the title's arr holds it already, and where it stands there; read at most once every `STATUS_FRESH_MS`. */
  holding(ask: TitleRequestAsk): Promise<TitleHolding> {
    if (!this.arrs.isOn(ask.type)) return Promise.resolve(NOT_HELD)
    return this.holdingReads.read({ key: requestKeyOf(ask), read: () => this.readHolding(ask) })
  }

  private async readHolding(ask: TitleRequestAsk): Promise<TitleHolding> {
    const arrId = await this.arrs.heldId(ask)
    if (arrId === null) return NOT_HELD
    const progress = await this.arrs.progress({ type: ask.type, arrId })
    return { status: statusOf({ progress, isSearching: false }) }
  }

  /**
   * Asks the title's arr to download it for everyone. The budget and the one
   * request per title are settled in one transaction before the arr is
   * called, so two members asking at once get one request; if the arr then
   * fails, the request is taken back and spends nothing.
   */
  async request({ account, ask }: RequestProps): Promise<TitleRequest> {
    if (!this.arrs.isOn(ask.type)) {
      throw new ArrError({
        kind: ARR_ERROR_KINDS.off,
        message: `Requests for a ${ask.type} are off`,
      })
    }
    this.reserve({ account, ask, now: this.clock.now() })
    try {
      const found = await this.arrs.lookUp(ask)
      if (found === null) {
        throw new ArrError({
          kind: ARR_ERROR_KINDS.failed,
          message: `The ${ask.type} downloader does not know this title`,
        })
      }
      if (found.existingId !== null) throw new RequestRefusal(HELD_ALREADY)
      const arrId = await this.addTo({ type: ask.type, found })
      const commandId = await this.arrs.search({ type: ask.type, arrId })
      this.finish({ ask, title: found.title, arrId, commandId })
    } catch (error) {
      this.release(ask)
      throw error
    }
    const row = this.rows().find((kept) => kept.type === ask.type && kept.tmdb_id === ask.tmdbId)
    if (row === undefined) throw new Error('A request vanished as it was made')
    return viewOf({ row, account })
  }

  /** Adds the title under its letter folder, through a profile that allows `REQUEST_RESOLUTION` and nothing else; answers the arr's id. */
  private async addTo({ type, found }: AddToProps): Promise<number> {
    const profileId = await this.profileIdOf(type)
    const rootFolder = letterFolderOf({
      base: this.config.requests.folders[type],
      title: found.title,
    })
    const folders = await this.arrs.rootFolders(type)
    if (!folders.includes(rootFolder)) {
      throw new ArrError({
        kind: ARR_ERROR_KINDS.failed,
        message: `The ${type} downloader has no root folder ${rootFolder}`,
      })
    }
    return this.arrs.add({ type, title: found, rootFolder, qualityProfileId: profileId })
  }

  /** The id of the configured quality profile, once it is known to allow only `REQUEST_RESOLUTION`. */
  private async profileIdOf(type: MatchItemType): Promise<number> {
    const name = this.config.requests.qualityProfile
    const profile = await this.arrs.qualityProfile({ type, name })
    if (profile === null) {
      throw new ArrError({
        kind: ARR_ERROR_KINDS.failed,
        message: `The ${type} downloader has no quality profile ${name}`,
      })
    }
    const isOnlyResolution =
      profile.resolutions.length > 0 &&
      profile.resolutions.every((resolution) => resolution === REQUEST_RESOLUTION)
    if (!isOnlyResolution) {
      throw new ArrError({
        kind: ARR_ERROR_KINDS.failed,
        message: `The ${type} downloader's ${name} profile allows more than ${REQUEST_RESOLUTION}p`,
      })
    }
    return profile.id
  }

  private reserve({ account, ask, now }: ReserveProps): void {
    this.db.transaction(() => {
      const taken = this.db
        .prepare<TitleKeyParams, TakenRow>(
          'SELECT tmdb_id FROM download_requests WHERE type = @type AND tmdb_id = @tmdbId',
        )
        .get({ type: ask.type, tmdbId: ask.tmdbId })
      if (taken !== undefined) {
        throw new RequestRefusal('Someone has requested this already')
      }
      const budget = this.budgetOf({ account, now })
      if (budget.left === 0) {
        throw new RequestRefusal(`Every one of the ${budget.limit} requests a day is spent`)
      }
      this.db
        .prepare<InsertParams>(
          `INSERT INTO download_requests (type, tmdb_id, account_id, title, requested_at, status)
           VALUES (@type, @tmdbId, @account, '', @at, @status)`,
        )
        .run({
          type: ask.type,
          tmdbId: ask.tmdbId,
          account,
          at: new Date(now).toISOString(),
          status: REQUEST_STATUSES.searching,
        })
    })()
  }

  private finish({ ask, title, arrId, commandId }: FinishProps): void {
    this.db
      .prepare<FinishParams>(
        `UPDATE download_requests SET title = @title, arr_id = @arrId, command_id = @commandId
          WHERE type = @type AND tmdb_id = @tmdbId`,
      )
      .run({ type: ask.type, tmdbId: ask.tmdbId, title, arrId, commandId })
    this.statusReads.mark({ key: requestKeyOf(ask), answer: undefined })
  }

  private release(ask: TitleRequestAsk): void {
    this.db
      .prepare<TitleKeyParams>(
        'DELETE FROM download_requests WHERE type = @type AND tmdb_id = @tmdbId',
      )
      .run({ type: ask.type, tmdbId: ask.tmdbId })
  }
}
