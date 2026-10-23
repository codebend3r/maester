import {
  APP_CALL_METHODS,
  APP_CLIENT_CALLS,
  type AppClientCall,
  type FetchLike,
  WATCH_TARGET_KINDS,
  appClientCallOf,
  createApiClient,
} from '@raven/core'
import { describe, expect, it } from 'vitest'
import { AUDIENCES } from '@/admin/adminGuard'
import { ACCOUNT_REQUIREMENTS } from '@/auth/accountGuard'
import { CONTROLLERS } from '@/appModule'
import { routeMarks } from '@/routeMarks'

const routes = routeMarks(CONTROLLERS)

const calls = Object.entries(APP_CLIENT_CALLS)

const routeOf = ({ method, path }: AppClientCall) =>
  routes.find((route) => route.method === method && route.path === path)

/** The spec's writes (progress, plays, watched, the favourites, the PIN), and the admin lock's unlock, ruled in by Task 17. */
const WRITES = [
  APP_CLIENT_CALLS.saveProgress,
  APP_CLIENT_CALLS.recordPlay,
  APP_CLIENT_CALLS.setWatched,
  APP_CLIENT_CALLS.setFavourite,
  APP_CLIENT_CALLS.setItemFavourite,
  APP_CLIENT_CALLS.unlock,
  APP_CLIENT_CALLS.unlockAdmin,
]

/** A server that answers every request with an empty body, writing down which listed call each one was. */
const recordingFetch = (heard: (AppClientCall | null)[]): FetchLike => {
  const answer = async (url: string, init: { method?: string } = {}) => {
    const name = appClientCallOf({ method: init.method ?? APP_CALL_METHODS.get, url })
    heard.push(name === null ? null : APP_CLIENT_CALLS[name])
    return {
      ok: true,
      status: 204,
      statusText: 'No Content',
      json: async () => ({}),
      text: async () => '',
    }
  }
  return answer
}

describe('the calls raven’s app may make', () => {
  it('names only routes the server declares, with their methods', () => {
    expect(calls.filter(([, call]) => routeOf(call) === undefined).map(([name]) => name)).toEqual(
      [],
    )
  })

  it('names no route for the owner alone: none marked AdminOnly, none the account gate keeps for the owner', () => {
    const isOwners = (call: AppClientCall): boolean => {
      const route = routeOf(call)
      return (
        (route?.audience ?? null) === AUDIENCES.admin ||
        (route?.account ?? null) === ACCOUNT_REQUIREMENTS.owner
      )
    }
    expect(calls.filter(([, call]) => isOwners(call)).map(([name]) => name)).toEqual([])
  })

  it('writes only what the spec lets it write', () => {
    expect(
      calls.flatMap(([, call]) => (call.method === APP_CALL_METHODS.get ? [] : [call])),
    ).toEqual(expect.arrayContaining(WRITES))
    expect(
      calls.filter(([, call]) => call.method !== APP_CALL_METHODS.get).map(([, call]) => call),
    ).toHaveLength(WRITES.length)
  })

  it('reaches every route on the media plane, where the native players fetch', () => {
    expect(
      routes
        .filter((route) => route.mediaPlane)
        .filter(
          (route) =>
            !calls.some(([, call]) => call.method === route.method && call.path === route.path),
        )
        .map((route) => `${route.method} ${route.path}`),
    ).toEqual([])
  })

  it('names each write after the client method that sends it', async () => {
    const heard: (AppClientCall | null)[] = []
    const api = createApiClient({ fetch: recordingFetch(heard) })
    await Promise.allSettled([
      api.saveProgress({ id: 7, position: 12, audio: null }),
      api.recordPlay(7),
      api.setWatched({ watched: true, targets: [{ kind: WATCH_TARGET_KINDS.media, id: 7 }] }),
      api.setFavourite({ id: 7, favourite: true }),
      api.setItemFavourite({ id: 3, favourite: true }),
      api.unlock('1234'),
      api.unlockAdmin('password'),
    ])
    expect(heard).toEqual(WRITES)
  })
})
