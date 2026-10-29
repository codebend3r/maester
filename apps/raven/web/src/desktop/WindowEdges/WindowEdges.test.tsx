import { DESKTOP_PLATFORMS, DESKTOP_REQUESTS, WINDOW_EDGES } from '@raven/core'
import { describe, expect, it } from 'bun:test'
import { fireEvent, render } from '@testing-library/react'
import { WindowEdges } from '@/desktop/WindowEdges/WindowEdges'
import { asPlayingDesktop, fakeClient } from '@/test/desktop'

const handles = (container: HTMLElement) => [...container.querySelectorAll('span')]

describe('WindowEdges', () => {
  it('draws nothing where macOS resizes the window itself', () => {
    asPlayingDesktop({ client: fakeClient({ platform: DESKTOP_PLATFORMS.mac }) })
    const { container } = render(<WindowEdges />)
    expect(handles(container)).toEqual([])
  })

  it('draws a handle on every edge and corner of a window with no frame', () => {
    asPlayingDesktop({ client: fakeClient({ platform: DESKTOP_PLATFORMS.windows }) })
    const { container } = render(<WindowEdges />)
    expect(handles(container)).toHaveLength(Object.keys(WINDOW_EDGES).length)
  })

  it('asks main to resize while a drag holds the pointer, in screen points', () => {
    const client = fakeClient({ platform: DESKTOP_PLATFORMS.windows })
    asPlayingDesktop({ client })
    const { container } = render(<WindowEdges />)
    const [topLeft] = handles(container)
    if (topLeft === undefined) throw new Error('no handle')
    fireEvent.pointerMove(topLeft, { pointerId: 1, screenX: 5, screenY: 5 })
    fireEvent.pointerDown(topLeft, { pointerId: 1, button: 0, screenX: 100, screenY: 80 })
    fireEvent.pointerMove(topLeft, { pointerId: 1, screenX: 90, screenY: 60 })
    expect(client.request.mock.calls.map(([request]) => request)).toEqual([
      { type: DESKTOP_REQUESTS.startWindowResize, edge: WINDOW_EDGES.topLeft, x: 100, y: 80 },
      { type: DESKTOP_REQUESTS.moveWindowResize, x: 90, y: 60 },
    ])
  })

  it('leaves a secondary click alone', () => {
    const client = fakeClient({ platform: DESKTOP_PLATFORMS.windows })
    asPlayingDesktop({ client })
    const { container } = render(<WindowEdges />)
    const [topLeft] = handles(container)
    if (topLeft === undefined) throw new Error('no handle')
    fireEvent.pointerDown(topLeft, { pointerId: 1, button: 2, screenX: 100, screenY: 80 })
    expect(client.request.mock.calls).toEqual([])
  })
})
