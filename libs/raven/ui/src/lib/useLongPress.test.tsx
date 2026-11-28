import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test'
import { TOUCH_DRIFT_PX, TOUCH_HOLD_DELAY_MS } from '@raven/core'
import { act, cleanup, createEvent, fireEvent, render } from '@testing-library/react'
import { useLongPress } from '@/lib/useLongPress'

type Calls = { holds: string[]; clicks: string[] }

type HarnessProps = { calls: Calls }

const Harness = ({ calls }: HarnessProps) => {
  const press = useLongPress({ onLongPress: () => calls.holds.push('hold') })
  return (
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
    <section onClick={() => calls.clicks.push('click')}>
      <a href="#cover" data-testid="cover" {...press}>
        Cover
      </a>
    </section>
  )
}

const mount = () => {
  const calls: Calls = { holds: [], clicks: [] }
  const view = render(<Harness calls={calls} />)
  return { calls, cover: view.getByTestId('cover') }
}

const AT = 10

type PressProps = { target: HTMLElement; pointerType?: string }

const press = ({ target, pointerType = 'touch' }: PressProps) =>
  fireEvent.pointerDown(target, { pointerType, clientX: AT, clientY: AT })

const wait = (ms: number) => act(() => jest.advanceTimersByTime(ms))

/** Whether the browser's own menu would open: a context menu event nobody cancelled. */
const isMenuLeftToBrowser = (target: HTMLElement): boolean => {
  const event = createEvent.contextMenu(target)
  fireEvent(target, event)
  return !event.defaultPrevented
}

beforeEach(() => jest.useFakeTimers())

afterEach(() => {
  cleanup()
  jest.useRealTimers()
})

describe('useLongPress', () => {
  it('holds once a finger has rested for the hold, and swallows the click its lifting sends', () => {
    const { calls, cover } = mount()
    press({ target: cover })
    wait(TOUCH_HOLD_DELAY_MS - 1)
    expect(calls.holds).toHaveLength(0)
    wait(1)
    expect(calls.holds).toHaveLength(1)
    fireEvent.pointerUp(cover, { pointerType: 'touch' })
    fireEvent.click(cover)
    expect(calls.clicks).toHaveLength(0)
  })

  it("cancels the lift's touchend once it has held, so no click is made of it", () => {
    const { cover } = mount()
    press({ target: cover })
    wait(TOUCH_HOLD_DELAY_MS)
    const touchEnd = createEvent.touchEnd(cover)
    fireEvent(cover, touchEnd)
    expect(touchEnd.defaultPrevented).toBe(true)
  })

  it('leaves a quick tap to the link, lifted before the hold', () => {
    const { calls, cover } = mount()
    press({ target: cover })
    wait(TOUCH_HOLD_DELAY_MS / 2)
    fireEvent.pointerUp(cover, { pointerType: 'touch' })
    fireEvent.click(cover)
    wait(TOUCH_HOLD_DELAY_MS)
    expect([calls.holds.length, calls.clicks.length]).toEqual([0, 1])
  })

  it('is no hold once the finger drifts past the slop, as a scroll does', () => {
    const { calls, cover } = mount()
    press({ target: cover })
    fireEvent.pointerMove(cover, {
      pointerType: 'touch',
      clientX: AT + TOUCH_DRIFT_PX + 1,
      clientY: AT,
    })
    wait(TOUCH_HOLD_DELAY_MS)
    expect(calls.holds).toHaveLength(0)
  })

  it('stays a hold through a finger that drifts a little', () => {
    const { calls, cover } = mount()
    press({ target: cover })
    fireEvent.pointerMove(cover, {
      pointerType: 'touch',
      clientX: AT + TOUCH_DRIFT_PX / 2,
      clientY: AT,
    })
    wait(TOUCH_HOLD_DELAY_MS)
    expect(calls.holds).toHaveLength(1)
  })

  it('is cancelled by the browser taking the touch', () => {
    const { calls, cover } = mount()
    press({ target: cover })
    fireEvent.pointerCancel(cover, { pointerType: 'touch' })
    wait(TOUCH_HOLD_DELAY_MS)
    expect(calls.holds).toHaveLength(0)
  })

  it('is cancelled by the finger leaving the element', () => {
    const { calls, cover } = mount()
    press({ target: cover })
    fireEvent.pointerLeave(cover, { pointerType: 'touch' })
    wait(TOUCH_HOLD_DELAY_MS)
    expect(calls.holds).toHaveLength(0)
  })

  it('never holds a mouse, whose press stays a click', () => {
    const { calls, cover } = mount()
    press({ target: cover, pointerType: 'mouse' })
    wait(TOUCH_HOLD_DELAY_MS * 2)
    fireEvent.click(cover)
    expect([calls.holds.length, calls.clicks.length]).toEqual([0, 1])
  })

  it("opens on a mouse's right click in the browser's menu's place", () => {
    const { calls, cover } = mount()
    press({ target: cover, pointerType: 'mouse' })
    expect(isMenuLeftToBrowser(cover)).toBe(false)
    expect(calls.holds).toHaveLength(1)
  })

  it("holds at once when Android's own long press menu comes first, and only once", () => {
    const { calls, cover } = mount()
    press({ target: cover })
    expect(isMenuLeftToBrowser(cover)).toBe(false)
    wait(TOUCH_HOLD_DELAY_MS)
    expect(isMenuLeftToBrowser(cover)).toBe(false)
    expect(calls.holds).toHaveLength(1)
  })

  it('lets the next tap through when no click followed a hold', () => {
    const { calls, cover } = mount()
    press({ target: cover })
    wait(TOUCH_HOLD_DELAY_MS)
    fireEvent.pointerUp(cover, { pointerType: 'touch' })
    press({ target: cover })
    fireEvent.pointerUp(cover, { pointerType: 'touch' })
    fireEvent.click(cover)
    expect([calls.holds.length, calls.clicks.length]).toEqual([1, 1])
  })
})
