import { mock } from 'bun:test'
import type { CanPlay } from '@weirwood/core'

const everything: CanPlay = () => true
const support = { current: everything }

/**
 * happy-dom's <video> plays nothing, so tests say what the pretend browser
 * supports. Registered once in the preload: Bun's module mocks are shared
 * by every test file, so per-file mocks would leak into each other.
 */
export const setBrowserSupport = (canPlay: CanPlay): void => {
  support.current = canPlay
}

export const resetBrowserSupport = (): void => {
  support.current = everything
}

mock.module('@/lib/canPlay', () => ({
  browserCanPlay: (mime: string) => support.current(mime),
}))
