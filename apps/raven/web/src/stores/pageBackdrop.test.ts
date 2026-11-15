import { describe, expect, it } from 'bun:test'
import { usePageBackdrop } from '@/stores/pageBackdrop'

describe('the page backdrop', () => {
  it('shows the latest picture, keeping the few before it to fade out', () => {
    const { show } = usePageBackdrop.getState()
    ;['/a', '/b', '/c', '/d', '/e', '/c'].forEach((url) => show(url))
    expect(usePageBackdrop.getState()).toMatchObject({
      current: '/c',
      recent: ['/b', '/d', '/e', '/c'],
    })
  })

  it('puts a picture away only while it is the one shown', () => {
    const { show, hide, markLoaded } = usePageBackdrop.getState()
    show('/a')
    show('/b')
    markLoaded('/b')
    hide('/a')
    expect(usePageBackdrop.getState()).toMatchObject({ current: '/b', shown: '/b' })
    hide('/b')
    expect(usePageBackdrop.getState()).toMatchObject({ current: null, shown: null })
  })

  it('shows a picture once it has loaded, the one before it held up till then', () => {
    const { show, markLoaded } = usePageBackdrop.getState()
    show('/a')
    expect(usePageBackdrop.getState().shown).toBeNull()
    markLoaded('/a')
    expect(usePageBackdrop.getState().shown).toBe('/a')
    show('/b')
    expect(usePageBackdrop.getState()).toMatchObject({ current: '/b', shown: '/a' })
    markLoaded('/b')
    expect(usePageBackdrop.getState().shown).toBe('/b')
    // Loaded before, it shows at once.
    show('/a')
    expect(usePageBackdrop.getState().shown).toBe('/a')
  })

  it('remembers only the loads of the pictures it keeps', () => {
    const { show, markLoaded } = usePageBackdrop.getState()
    ;['/a', '/b', '/c', '/d'].forEach((url) => {
      show(url)
      markLoaded(url)
    })
    show('/e')
    markLoaded('/gone')
    expect(usePageBackdrop.getState().loaded).toEqual(['/b', '/c', '/d'])
  })
})
