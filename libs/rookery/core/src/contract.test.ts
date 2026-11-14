import { describe, expect, it } from 'bun:test'
import { ROUTES, SERVER_PATHS, isMeAnswer, isPublicUser } from '@/contract'

const user = { id: 'u1', display_name: 'Alice', email: null, thumb: 'https://plex.tv/a.png' }

describe('ROUTES', () => {
  it('puts every route under a server path, so none falls through to the web app', () => {
    Object.values(ROUTES).forEach((route) => {
      expect(SERVER_PATHS.some((path) => route.startsWith(path))).toBe(true)
    })
  })
})

describe('isPublicUser', () => {
  it('checks every field, email and thumb included', () => {
    expect(isPublicUser(user)).toBe(true)
    expect(isPublicUser({ ...user, thumb: 7 })).toBe(false)
    expect(isPublicUser({ ...user, email: undefined })).toBe(false)
    expect(isPublicUser({ id: 'u1' })).toBe(false)
  })
})

describe('isMeAnswer', () => {
  it('wants a whole user under `user`', () => {
    expect(isMeAnswer({ user })).toBe(true)
    expect(isMeAnswer({ user: { id: 'u1' } })).toBe(false)
  })
})
