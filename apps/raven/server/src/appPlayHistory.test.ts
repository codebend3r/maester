import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PLAY_HISTORY_SHOWS, createApiClient } from '@raven/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AUTH_TEST_IDS, authFixture } from '@/test/auth'
import { type MusicIds, addMusic, createEnforcedApp } from '@/test/enforced'
import { injectFetch } from '@/test/server'

let root: string
let fixture: Awaited<ReturnType<typeof authFixture>>
let enforced: Awaited<ReturnType<typeof createEnforcedApp>>
let music: MusicIds

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'raven-play-history-'))
  fixture = await authFixture()
  enforced = await createEnforcedApp({ root, fixture })
  music = await addMusic({ root, enforced })
})

afterAll(async () => {
  await enforced.app.close()
  await rm(root, { recursive: true, force: true, maxRetries: 5 })
})

type ClientForProps = { id: string }

const clientFor = async ({ id }: ClientForProps) => {
  const token = await fixture.mint({ id })
  return createApiClient({ fetch: injectFetch({ app: enforced.app }), accessToken: () => token })
}

const PAGE = { before: null, show: PLAY_HISTORY_SHOWS.all } as const

describe('the play history under accounts', () => {
  it("keeps each account's history to itself, and everyone's for the owner", async () => {
    const member = await clientFor({ id: AUTH_TEST_IDS.friend })
    const guest = await clientFor({ id: AUTH_TEST_IDS.guest })
    const owner = await clientFor({ id: AUTH_TEST_IDS.owner })
    const track = music.tracks[0] ?? 0
    const listen = await guest.startListen({ mediaId: track, position: 0 })
    await guest.reportListen({ id: listen, position: 3 })
    await member.recordPlay(enforced.ids.video)

    const guestOwn = await guest.listPlayHistory(PAGE)
    const memberOwn = await member.listPlayHistory(PAGE)
    expect(guestOwn.entries.map(({ accountId }) => accountId)).toEqual([AUTH_TEST_IDS.guest])
    expect(guestOwn.entries[0]).toMatchObject({ id: listen, mediaId: track, furthest: 3 })
    expect(memberOwn.entries.map(({ accountId, mediaId }) => [accountId, mediaId])).toEqual([
      [AUTH_TEST_IDS.friend, enforced.ids.video],
    ])

    await expect(guest.listEveryonesHistory({ ...PAGE, accountId: null })).rejects.toMatchObject({
      status: 403,
    })
    await expect(
      member.listEveryonesHistory({ ...PAGE, accountId: AUTH_TEST_IDS.guest }),
    ).rejects.toMatchObject({ status: 403 })
    const everyone = await owner.listEveryonesHistory({ ...PAGE, accountId: null })
    expect(everyone.entries.map(({ accountId }) => accountId)).toEqual([
      AUTH_TEST_IDS.friend,
      AUTH_TEST_IDS.guest,
    ])
    const guestsAlone = await owner.listEveryonesHistory({
      ...PAGE,
      accountId: AUTH_TEST_IDS.guest,
    })
    expect(guestsAlone.entries).toEqual(guestOwn.entries)
  })

  it("moves on no other account's listen, and starts none on a video", async () => {
    const guest = await clientFor({ id: AUTH_TEST_IDS.guest })
    // The owner has started no listen of its own, so the guest's number names none of the owner's.
    const stranger = await clientFor({ id: AUTH_TEST_IDS.owner })
    const listen = await guest.startListen({ mediaId: music.tracks[1] ?? 0, position: 0 })

    await expect(stranger.reportListen({ id: listen, position: 150 })).rejects.toMatchObject({
      status: 404,
    })
    await expect(
      guest.startListen({ mediaId: enforced.ids.video, position: 0 }),
    ).rejects.toMatchObject({ status: 404 })
    expect((await guest.listPlayHistory(PAGE)).entries[0]).toMatchObject({
      id: listen,
      furthest: 0,
    })
  })

  it('refuses a cursor that is no entry id', async () => {
    const guest = await clientFor({ id: AUTH_TEST_IDS.guest })
    await expect(guest.listPlayHistory({ ...PAGE, before: 0 })).rejects.toMatchObject({
      status: 400,
    })
  })
})
