import { act } from '@testing-library/react'

/**
 * happy-dom's IntersectionObserver never reports, so no picture that waits
 * for the screen would ever load. This one reports every element it is
 * given as on the screen, as a page short enough to show it all would,
 * unless a test says otherwise. Like a browser's, it reports after the
 * element mounts rather than while React commits it, and each report is an
 * act() of its own, so the update it causes lands as a test expects.
 */
const reporting: { isOnScreen: boolean; observers: Set<FakeIntersectionObserver> } = {
  isOnScreen: true,
  observers: new Set(),
}

class FakeIntersectionObserver {
  readonly root = null
  readonly rootMargin: string
  readonly scrollMargin = '0px'
  readonly thresholds: readonly number[] = [0]
  readonly #callback: IntersectionObserverCallback
  readonly #targets = new Set<Element>()

  constructor(callback: IntersectionObserverCallback, options: IntersectionObserverInit = {}) {
    this.#callback = callback
    this.rootMargin = options.rootMargin ?? '0px'
    reporting.observers.add(this)
  }

  report({ target, isIntersecting }: { target: Element; isIntersecting: boolean }): void {
    if (!this.#targets.has(target)) return
    const box = target.getBoundingClientRect()
    act(() =>
      this.#callback(
        [
          {
            target,
            isIntersecting,
            intersectionRatio: isIntersecting ? 1 : 0,
            boundingClientRect: box,
            intersectionRect: box,
            rootBounds: null,
            time: performance.now(),
          },
        ],
        this,
      ),
    )
  }

  observe(target: Element): void {
    this.#targets.add(target)
    queueMicrotask(() => this.report({ target, isIntersecting: reporting.isOnScreen }))
  }

  unobserve(target: Element): void {
    this.#targets.delete(target)
  }

  disconnect(): void {
    this.#targets.clear()
  }

  takeRecords(): IntersectionObserverEntry[] {
    return []
  }
}

Object.defineProperty(globalThis, 'IntersectionObserver', {
  value: FakeIntersectionObserver,
  configurable: true,
})

/** Whether elements observed from now on start on the screen. */
export const startOnScreen = (isOnScreen: boolean): void => {
  reporting.isOnScreen = isOnScreen
}

/** Scrolls `target` onto the screen or off it. */
export const moveOnScreen = ({
  target,
  isOnScreen,
}: {
  target: Element
  isOnScreen: boolean
}): void =>
  reporting.observers.forEach((observer) => observer.report({ target, isIntersecting: isOnScreen }))

/** Waits for the reports on what just mounted, as a test that reads a picture at once needs. */
export const reported = (): Promise<void> => act(async () => {})
