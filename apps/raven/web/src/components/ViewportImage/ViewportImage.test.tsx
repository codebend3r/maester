import { afterEach, describe, expect, it } from 'bun:test'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { ViewportImage, hasArrived } from '@/components/ViewportImage/ViewportImage'
import { moveOnScreen as move, startOnScreen } from '@/test/viewport'

const SRC = '/api/pictures/items/4/poster/p1'
const SRC_SET = `${SRC}&w=154 154w, ${SRC} 500w`

const moveOnScreen = (args: Parameters<typeof move>[0]) => act(() => move(args))

const offScreen = () => {
  startOnScreen(false)
  const { container } = render(<ViewportImage src={SRC} srcSet={SRC_SET} sizes="auto" alt="" />)
  const image = container.querySelector('img')
  if (!image) throw new Error('No picture drawn')
  return image
}

describe('ViewportImage', () => {
  afterEach(() => {
    cleanup()
    startOnScreen(true)
  })

  it('asks for nothing while it is far from the screen', () => {
    const image = offScreen()
    expect(image.getAttribute('src')).toBeNull()
    expect(image.getAttribute('srcset')).toBeNull()
    expect(image).toHaveAttribute('sizes', 'auto')
  })

  it('asks for its picture once it nears the screen, lazily', () => {
    const image = offScreen()
    moveOnScreen({ target: image, isOnScreen: true })
    expect(image).toHaveAttribute('src', SRC)
    expect(image).toHaveAttribute('srcset', SRC_SET)
    expect(image).toHaveAttribute('loading', 'lazy')
  })

  it('lets its request go when scrolled away before the picture arrives', () => {
    const image = offScreen()
    moveOnScreen({ target: image, isOnScreen: true })
    moveOnScreen({ target: image, isOnScreen: false })
    expect(image.getAttribute('src')).toBeNull()
  })

  it('keeps a picture that arrived when scrolled away', () => {
    const image = offScreen()
    moveOnScreen({ target: image, isOnScreen: true })
    fireEvent.load(image)
    moveOnScreen({ target: image, isOnScreen: false })
    expect(image).toHaveAttribute('src', SRC)
  })

  it('draws a picture that arrived before at once, eagerly, at the width it had, when drawn again', () => {
    const src = '/api/pictures/items/5/poster/p1'
    startOnScreen(false)
    const first = render(<ViewportImage src={src} srcSet={SRC_SET} sizes="auto" alt="" />)
    const image = first.container.querySelector('img')
    if (!image) throw new Error('No picture drawn')
    moveOnScreen({ target: image, isOnScreen: true })
    Object.defineProperty(image, 'clientWidth', { value: 154 })
    fireEvent.load(image)
    first.unmount()
    const again = render(
      <ViewportImage src={src} srcSet={SRC_SET} sizes="auto" alt="" />,
    ).container.querySelector('img')
    expect(again).toHaveAttribute('src', src)
    expect(again).toHaveAttribute('loading', 'eager')
    expect(again).toHaveAttribute('sizes', '154px')
    expect(hasArrived(src)).toBe(true)
  })

  it('asks lazily again for a picture that arrived at no width, as its first time', () => {
    const src = '/api/pictures/items/6/poster/p1'
    startOnScreen(false)
    const first = render(<ViewportImage src={src} srcSet={SRC_SET} sizes="auto" alt="" />)
    const image = first.container.querySelector('img')
    if (!image) throw new Error('No picture drawn')
    moveOnScreen({ target: image, isOnScreen: true })
    fireEvent.load(image)
    first.unmount()
    const again = render(
      <ViewportImage src={src} srcSet={SRC_SET} sizes="auto" alt="" />,
    ).container.querySelector('img')
    expect(again).toHaveAttribute('loading', 'lazy')
    expect(again).toHaveAttribute('sizes', 'auto')
  })
})
