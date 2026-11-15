import { describe, expect, it } from 'bun:test'
import { HTTP_METHODS } from '@/contract'
import { ROUTES, pathFor } from '@/routes'

describe('pathFor', () => {
  it('fills each placeholder, escaped', () => {
    expect(pathFor({ path: ROUTES.getMedia.path, params: { id: 7 } })).toBe('/api/media/7')
    expect(
      pathFor({ path: ROUTES.subtitles.path, params: { id: 7, trackId: 'embedded 0/1' } }),
    ).toBe('/api/media/7/subtitles/embedded%200%2F1')
  })

  it('leaves a path with no placeholders as it is', () => {
    expect(pathFor({ path: ROUTES.getHome.path, params: {} })).toBe('/api/home')
  })
})

describe('ROUTES', () => {
  it('names one route for each method and path', () => {
    const keys = Object.values(ROUTES).map(({ method, path }) => `${method} ${path}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('answers JSON only where the client reads it as JSON', () => {
    expect(ROUTES.getLibrary.method).toBe(HTTP_METHODS.get)
    expect(ROUTES.getLibrary.reply).toBeFunction()
    expect(ROUTES.file.reply).toBeNull()
  })
})
