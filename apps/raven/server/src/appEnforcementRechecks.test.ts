import { mkdtemp, rm, truncate } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MEMBER_STATUSES, PLAYBACK_MODES, type MemberStatusChange } from '@raven/core'
import { CONTENT_TYPES, HEADERS } from '@shared/server'
import { decodeJwt } from 'jose'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ServerEvents } from '@/events/serverEvents'
import { MetadataService } from '@/metadata/metadataService'
import { RANGE_UNITS } from '@/media/range'
import { ScannerService } from '@/scanner/scannerService'
import { ThumbnailService } from '@/thumbnails/thumbnailService'
import { AUTH_TEST_IDS, authFixture, bearerHeaders } from '@/test/auth'
import {
  CALLER_KINDS,
  ROUTES,
  TOKEN_CARRIERS,
  createEnforcedApp,
  headersFor,
  mintedTicket,
  pathOf,
  pinMoves,
  withTicket,
} from '@/test/enforced'
import { encodeClip } from '@/test/clips'

describe('open responses once access goes', () => {
  const RECHECK_MS = 100
  const PIN = '8008'
  /** Several rechecks long, and the bound a test holds the server to. */
  const CUT_WITHIN_MS = 1_000
  /** Larger than every buffer between the server and a body left unread, so the response stays open. */
  const LARGE_FILE_BYTES = 64 * 1024 * 1024
  const SHORT_TOKEN_SECONDS = 2
  const RESUMED_BYTES = 100
  const LONG_CLIP = 'Long Stream (2026).mp4'
  const LONG_CLIP_SIZE = '1280x720'
  /** Approved accounts of their own, so no other test's token counts as fresher. */
  const QUIET_IDS = {
    cut: '20000000-0000-4000-8000-000000000011',
    kept: '20000000-0000-4000-8000-000000000012',
  } as const

  let live: Awaited<ReturnType<typeof authFixture>>
  let open: Awaited<ReturnType<typeof createEnforcedApp>>
  let liveRoot: string
  let base: string
  let longVideo: number
  let pin: ReturnType<typeof pinMoves>

  beforeAll(async () => {
    liveRoot = await mkdtemp(join(tmpdir(), 'raven-enforcement-open-'))
    live = await authFixture()
    Object.values(QUIET_IDS).forEach((id) => {
      live.accounts[id] = {
        id,
        email: `${id}@maester.test`,
        status: MEMBER_STATUSES.approved,
        isOwner: false,
      }
    })
    open = await createEnforcedApp({
      root: liveRoot,
      fixture: live,
      libraryPin: PIN,
      accessRecheckMs: RECHECK_MS,
    })
    pin = pinMoves({ enforced: open, fixture: live, pin: PIN })
    // Its remux is larger than every buffer to an unread body, so ffmpeg is still writing at the cut.
    await encodeClip({ path: join(open.mediaDir, LONG_CLIP), seconds: 30, size: LONG_CLIP_SIZE })
    await open.ownerApi.scanLibrary(open.ids.library)
    await open.app.get(ScannerService).whenIdle(open.ids.library)
    await open.app.get(MetadataService).whenIdle()
    await open.app.get(ThumbnailService).whenIdle()
    const media = await open.ownerApi.listMedia({ libraryId: open.ids.library })
    longVideo = media.find(({ id }) => id !== open.ids.video)?.id ?? 0
    const { path } = await open.ownerApi.getMediaLocation(open.ids.video)
    await truncate(path, LARGE_FILE_BYTES)
    await open.app.listen({ port: 0, host: '127.0.0.1' })
    base = await open.app.getUrl()
  })

  afterAll(async () => {
    // A body read to its end can leave its keep-alive socket not yet idle
    // when the server closes, which would then wait out the keep-alive timeout.
    open.app.getHttpAdapter().getInstance().server.closeAllConnections()
    await open.app.close()
    await rm(liveRoot, { recursive: true, force: true, maxRetries: 5 })
  })

  type Reader = ReadableStreamDefaultReader<Uint8Array>
  type Drained = { received: number; isCut: boolean }

  const pause = ({ ms }: { ms: number }) =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, Math.max(0, ms))
    })

  const readerOf = ({ response }: { response: Response }): Reader => {
    if (response.body === null) throw new Error('no body to read')
    return response.body.getReader()
  }

  /** Reads to the end; `isCut` when a read fails, as it does on a response destroyed mid-body. */
  const drain = async ({
    reader,
    received,
  }: {
    reader: Reader
    received: number
  }): Promise<Drained> => {
    const chunk = await reader.read().catch(() => null)
    if (chunk === null) return { received, isCut: true }
    if (chunk.done) return { received, isCut: false }
    return drain({ reader, received: received + chunk.value.byteLength })
  }

  /** Whether `text` arrives before the body ends. */
  const readUntil = async ({
    reader,
    text,
    read = '',
  }: {
    reader: Reader
    text: string
    read?: string
  }): Promise<boolean> => {
    if (read.includes(text)) return true
    const chunk = await reader.read()
    if (chunk.done) return false
    return readUntil({ reader, text, read: read + new TextDecoder().decode(chunk.value) })
  }

  /** What `drain` found within `ms`, or null when the body was still open then. */
  const drainWithin = ({ reader, ms }: { reader: Reader; ms: number }): Promise<Drained | null> =>
    Promise.race([drain({ reader, received: 0 }), pause({ ms }).then(() => null)])

  /** Opens `path` and reads its first chunk, then leaves the rest unread, as a slow player does. */
  const openBody = async ({
    path,
    headers = {},
    signal,
  }: {
    path: string
    headers?: Record<string, string>
    signal: AbortSignal
  }): Promise<{ reader: Reader; received: number }> => {
    const response = await fetch(`${base}${path}`, { headers, signal })
    expect(response.status).toBe(200)
    const reader = readerOf({ response })
    const first = await reader.read()
    return { reader, received: first.value?.byteLength ?? 0 }
  }

  const member = () =>
    headersFor({ fixture: live, caller: CALLER_KINDS.member, via: TOKEN_CARRIERS.bearer })

  const setFriend = ({ status }: MemberStatusChange) =>
    open.ownerApi.setMemberStatus({ id: AUTH_TEST_IDS.friend, change: { status } })

  const ticketFor = ({ headers }: { headers: Record<string, string> }): Promise<string> =>
    mintedTicket({ app: open.app, id: open.ids.video, headers })

  /** A ticket minted from a token of `SHORT_TOKEN_SECONDS`, and when that token expires. */
  const shortTicket = async ({ id }: { id: string }) => {
    const token = await live.mint({ id, expiresIn: SHORT_TOKEN_SECONDS })
    return {
      ticket: await ticketFor({ headers: bearerHeaders({ token }) }),
      expiresAt: (decodeJwt(token).exp ?? 0) * 1000,
    }
  }

  const fileWith = ({ ticket }: { ticket: string }) =>
    withTicket({ route: ROUTES.file, params: { id: open.ids.video }, ticket })

  it('refuses the event stream to anyone without an account', async () => {
    const response = await fetch(`${base}${ROUTES.events.path}`)
    expect(response.status).toBe(401)
    await response.text()
  })

  it("streams a member's events, and ends the stream soon after the account is removed", async () => {
    const aborter = new AbortController()
    try {
      const response = await fetch(`${base}${ROUTES.events.path}`, {
        headers: await member(),
        signal: aborter.signal,
      })
      expect(response.status).toBe(200)
      expect(response.headers.get(HEADERS.contentType)).toContain(CONTENT_TYPES.eventStream)
      const reader = readerOf({ response })
      open.app.get(ServerEvents).libraryChanged(open.ids.library)
      expect(await readUntil({ reader, text: `"libraryId":${open.ids.library}` })).toBe(true)
      await setFriend({ status: MEMBER_STATUSES.revoked })
      expect(await drainWithin({ reader, ms: CUT_WITHIN_MS })).toMatchObject({ isCut: false })
    } finally {
      aborter.abort()
      await setFriend({ status: MEMBER_STATUSES.approved })
    }
  })

  it("cuts a member's file read slowly soon after the account is removed", async () => {
    const aborter = new AbortController()
    try {
      const { reader, received } = await openBody({
        path: pathOf({ route: ROUTES.file, params: { id: open.ids.video } }),
        headers: await member(),
        signal: aborter.signal,
      })
      await setFriend({ status: MEMBER_STATUSES.revoked })
      await pause({ ms: CUT_WITHIN_MS })
      expect(await drain({ reader, received })).toMatchObject({ isCut: true })
    } finally {
      aborter.abort()
      await setFriend({ status: MEMBER_STATUSES.approved })
    }
  })

  it("cuts a member's converted stream read slowly soon after the account is removed", async () => {
    const aborter = new AbortController()
    try {
      const opened = await openBody({
        path: open.ownerApi.streamUrl({
          id: longVideo,
          mode: PLAYBACK_MODES.remux,
          start: 0,
          audio: null,
        }),
        headers: await member(),
        signal: aborter.signal,
      })
      await setFriend({ status: MEMBER_STATUSES.revoked })
      await pause({ ms: CUT_WITHIN_MS })
      expect(await drain(opened)).toMatchObject({ isCut: true })
    } finally {
      aborter.abort()
      await setFriend({ status: MEMBER_STATUSES.approved })
    }
  })

  it('ends a file opened with a ticket at its token expiry, and a new ticket resumes from the cut', async () => {
    const { ticket, expiresAt } = await shortTicket({ id: QUIET_IDS.cut })
    const aborter = new AbortController()
    try {
      const opened = await openBody({ path: fileWith({ ticket }), signal: aborter.signal })
      await pause({ ms: expiresAt + CUT_WITHIN_MS - Date.now() })
      const cut = await drain(opened)
      expect(cut.isCut).toBe(true)
      expect(cut.received).toBeLessThan(LARGE_FILE_BYTES)
      const renewed = await ticketFor({
        headers: bearerHeaders({ token: await live.mint({ id: QUIET_IDS.cut }) }),
      })
      const last = cut.received + RESUMED_BYTES - 1
      const resumed = await open.app.inject({
        url: fileWith({ ticket: renewed }),
        headers: { [HEADERS.range]: `${RANGE_UNITS.bytes}=${cut.received}-${last}` },
      })
      expect(resumed.statusCode).toBe(206)
      expect(resumed.headers[HEADERS.contentRange]).toBe(
        `${RANGE_UNITS.bytes} ${cut.received}-${last}/${LARGE_FILE_BYTES}`,
      )
    } finally {
      aborter.abort()
    }
  })

  it('keeps that file open past the expiry while the account sends fresher tokens', async () => {
    const { ticket, expiresAt } = await shortTicket({ id: QUIET_IDS.kept })
    const aborter = new AbortController()
    try {
      const opened = await openBody({ path: fileWith({ ticket }), signal: aborter.signal })
      const progress = await open.app.inject({
        method: ROUTES.progress.method,
        url: pathOf({ route: ROUTES.progress, params: { id: open.ids.video } }),
        headers: bearerHeaders({ token: await live.mint({ id: QUIET_IDS.kept }) }),
        payload: { position: 1 },
      })
      expect(progress.statusCode).toBe(204)
      await pause({ ms: expiresAt + CUT_WITHIN_MS - Date.now() })
      expect(await drain(opened)).toEqual({ received: LARGE_FILE_BYTES, isCut: false })
    } finally {
      aborter.abort()
    }
  })

  it("cuts a file opened past the owner's PIN on a locked library soon after the PIN locks again", async () => {
    await pin.setLocked({ isLocked: true })
    const aborter = new AbortController()
    try {
      const owner = await headersFor({
        fixture: live,
        caller: CALLER_KINDS.owner,
        via: TOKEN_CARRIERS.bearer,
      })
      const { headers } = await pin.unlock({ headers: owner })
      const opened = await openBody({
        path: fileWith({ ticket: await ticketFor({ headers }) }),
        signal: aborter.signal,
      })
      await pin.relock({ headers })
      expect(await drainWithin({ reader: opened.reader, ms: CUT_WITHIN_MS })).toMatchObject({
        isCut: true,
      })
    } finally {
      aborter.abort()
      await pin.setLocked({ isLocked: false })
    }
  })
})
