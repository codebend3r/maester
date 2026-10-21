import { afterEach, describe, expect, it } from 'bun:test'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { ViewportImage } from '@/components/ViewportImage/ViewportImage'
import { moveOnScreen as move, startOnScreen } from '@/test/viewport'

const SRC = '/api/items/4/images/poster?v=p1'
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
})
