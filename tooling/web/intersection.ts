import { act } from '@testing-library/react'

/**
 * When the fake reports. `onObserve` reports each element as it is observed, on the screen unless
 * `startOnScreen` says otherwise, as a page short enough to show it all would. `onDemand` reports
 * nothing until a test says the page was scrolled (`reachEnds`).
 */
export const INTERSECTION_REPORTING = {
  onObserve: 'onObserve',
  onDemand: 'onDemand',
} as const
type IntersectionReporting = (typeof INTERSECTION_REPORTING)[keyof typeof INTERSECTION_REPORTING]

type Watching = {
  reporting: IntersectionReporting
  isOnScreen: boolean
  observers: Set<FakeIntersectionObserver>
}

const watching: Watching = {
  reporting: INTERSECTION_REPORTING.onDemand,
  isOnScreen: true,
  observers: new Set(),
}

type ReportProps = { targets: readonly Element[]; isIntersecting: boolean }

type ReportOneProps = {
  observer: FakeIntersectionObserver
  target: Element
  isIntersecting: boolean
}

/** happy-dom's IntersectionObserver never reports; this one reports when the test's policy says. */
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
    watching.observers.add(this)
  }

  get targets(): readonly Element[] {
    return [...this.#targets]
  }

  /** One callback for those of `targets` this observer watches, and none when it watches none. */
  report({ targets, isIntersecting }: ReportProps): void {
    const entries = targets
      .filter((target) => this.#targets.has(target))
      .map((target) => {
        const box = target.getBoundingClientRect()
        return {
          target,
          isIntersecting,
          intersectionRatio: isIntersecting ? 1 : 0,
          boundingClientRect: box,
          intersectionRect: box,
          rootBounds: null,
          time: performance.now(),
        }
      })
    if (entries.length > 0) this.#callback(entries, this)
  }

  observe(target: Element): void {
    this.#targets.add(target)
    if (watching.reporting !== INTERSECTION_REPORTING.onObserve) return
    // Like a browser's, the report comes after the element mounts rather than while React commits it.
    queueMicrotask(() => reportOne({ observer: this, target, isIntersecting: watching.isOnScreen }))
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

/** A report on one element is an act() of its own, so the update it causes lands as a test expects. */
const reportOne = ({ observer, target, isIntersecting }: ReportOneProps): void => {
  if (!observer.targets.includes(target)) return
  act(() => observer.report({ targets: [target], isIntersecting }))
}

const GLOBAL_NAME = 'IntersectionObserver'

type WatchIntersectionsProps = { reporting: IntersectionReporting }

/**
 * Puts the fake in the browser's place and returns what puts the browser's back. An app that
 * reports on observe calls it from a preload, before any component makes an observer; a test of a
 * list that pages calls it before the list renders, and the return after `cleanup()`.
 */
export const watchIntersections = ({ reporting }: WatchIntersectionsProps): (() => void) => {
  const before = Object.getOwnPropertyDescriptor(globalThis, GLOBAL_NAME)
  watching.reporting = reporting
  Object.defineProperty(globalThis, GLOBAL_NAME, {
    value: FakeIntersectionObserver,
    configurable: true,
    writable: true,
  })
  return () => {
    watching.observers.clear()
    if (before === undefined) {
      Reflect.deleteProperty(globalThis, GLOBAL_NAME)
      return
    }
    Object.defineProperty(globalThis, GLOBAL_NAME, before)
  }
}

/** Whether elements observed from now on start on the screen, where the fake reports on observe. */
export const startOnScreen = (isOnScreen: boolean): void => {
  watching.isOnScreen = isOnScreen
}

type MoveOnScreenProps = {
  target: Element
  isOnScreen: boolean
}

/** Scrolls `target` onto the screen or off it. */
export const moveOnScreen = ({ target, isOnScreen }: MoveOnScreenProps): void =>
  watching.observers.forEach((observer) =>
    reportOne({ observer, target, isIntersecting: isOnScreen }),
  )

/** Waits for the reports on what just mounted, as a test that reads a picture at once needs. */
export const reported = (): Promise<void> => act(async () => {})

/** Scrolls every watched element onto the screen, as a listener nearing a list's end does. */
export const reachEnds = async (): Promise<void> => {
  await act(async () => {
    watching.observers.forEach((observer) =>
      observer.report({ targets: observer.targets, isIntersecting: true }),
    )
  })
}
