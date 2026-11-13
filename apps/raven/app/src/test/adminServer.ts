import {
  type Account,
  HTTP_METHODS,
  APP_CLIENT_CALLS,
  type ApiClient,
  DEFAULT_DISPLAY_SETTINGS,
  DEFAULT_PLAYBACK_SETTINGS,
  DEFAULT_REMOTE_ACCESS_SETTINGS,
  ENCODER_KINDS,
  MEMBER_STATUSES,
  type PlaybackSettingsState,
  REMOTE_ACCESS_STATES,
  type RemoteAccessState,
  createApiClient,
  isPlaybackSettingsChange,
} from '@raven/core'
import type { AppServer } from '@raven/native/headless'
import {
  type HeardRequest,
  NOT_FOUND,
  STATUSES,
  pathWithId,
  responseOf,
} from '@raven/native/testing'

import { FILMS, NAS, SERIES } from '@/test/homeServer'

/** The account signed in on the device in these tests. */
export const SIGNED_IN = {
  accessToken: 'access',
  refreshToken: 'refresh',
  expiresAt: Date.now() + 3_600_000,
  userId: '6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f',
  email: 'owner@raven.test',
}

/** The owner, as `GET /api/me` names the signed-in account. */
export const OWNER: Account = {
  id: SIGNED_IN.userId,
  email: SIGNED_IN.email,
  status: MEMBER_STATUSES.approved,
  isOwner: true,
}

/** A member waiting for the owner's approval. */
export const WAITING: Account = {
  id: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
  email: 'friend@raven.test',
  status: MEMBER_STATUSES.pending,
  isOwner: false,
}

/** The server's playback settings as a fresh install has them. */
export const PLAYBACK: PlaybackSettingsState = {
  settings: DEFAULT_PLAYBACK_SETTINGS,
  effective: { encoder: ENCODER_KINDS.software, tonemapAvailable: true },
}

const REMOTE_ACCESS: RemoteAccessState = {
  settings: DEFAULT_REMOTE_ACCESS_SETTINGS,
  privateAddress: '192.168.1.20',
  publicOrigin: null,
  status: { state: REMOTE_ACCESS_STATES.disabled },
}

const { get, put, post } = HTTP_METHODS

/** What the test server holds, read at each request, so a test can change it as it goes. */
export type AdminServerState = {
  /** Who `GET /api/me` says is signed in. */
  account: Account
  playback: PlaybackSettingsState
  /** Every request the server heard, in order. */
  heard: HeardRequest[]
}

const bodyOf = (body: string | undefined): unknown =>
  body === undefined ? undefined : JSON.parse(body)

/**
 * A client for `NAS` as its owner's settings answer: the account, the server's playback and
 * display settings, Remote Access, the two libraries and the members, with a playback change
 * answered as the server would.
 */
export const adminApi =
  (state: AdminServerState) =>
  (server: AppServer = NAS): ApiClient =>
    createApiClient({
      baseUrl: server.origin,
      fetch: async (url, init = {}) => {
        const method = init.method ?? get
        const path = url.replace(server.origin, '')
        const body = bodyOf(init.body)
        state.heard.push({ method, path, body })
        const isPlaybackSave = method === put && path === APP_CLIENT_CALLS.setPlaybackSettings.path
        if (isPlaybackSave && isPlaybackSettingsChange(body))
          state.playback = {
            ...state.playback,
            settings: { ...state.playback.settings, ...body },
          }
        const answers: Record<string, unknown> = {
          [`${get} ${APP_CLIENT_CALLS.getMe.path}`]: state.account,
          [`${get} ${APP_CLIENT_CALLS.getPlaybackSettings.path}`]: state.playback,
          [`${put} ${APP_CLIENT_CALLS.setPlaybackSettings.path}`]: state.playback,
          [`${get} ${APP_CLIENT_CALLS.getDisplaySettings.path}`]: DEFAULT_DISPLAY_SETTINGS,
          [`${get} ${APP_CLIENT_CALLS.getRemoteAccess.path}`]: REMOTE_ACCESS,
          [`${get} ${APP_CLIENT_CALLS.listLibraries.path}`]: [FILMS, SERIES],
          [`${post} ${pathWithId({ path: APP_CLIENT_CALLS.quickScanLibrary.path, id: FILMS.id })}`]:
            FILMS,
          [`${get} ${APP_CLIENT_CALLS.listMembers.path}?pageSize=100&pageOffset=0`]: [
            OWNER,
            WAITING,
          ],
        }
        const answer = answers[`${method} ${path}`]
        return responseOf(answer === undefined ? NOT_FOUND : { status: STATUSES.ok, body: answer })
      },
    })
