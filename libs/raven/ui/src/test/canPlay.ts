import { mock } from 'bun:test'
import type { CanPlay } from '@raven/core'

const everything: CanPlay = () => true
const nothing: CanPlay = () => false
const support = { current: everything, stream: nothing }

/**
 * happy-dom's <video> plays nothing, so tests say what the pretend browser
 * supports. Registered once in the preload: Bun's module mocks are shared
 * by every test file, so per-file mocks would leak into each other.
 */
export const setBrowserSupport = (canPlay: CanPlay): void => {
  support.current = canPlay
}

/** What the pretend browser plays through Media Source Extensions; nothing unless a test says. */
export const setStreamSupport = (canStream: CanPlay): void => {
  support.stream = canStream
}

export const resetBrowserSupport = (): void => {
  support.current = everything
  support.stream = nothing
}

mock.module('@/lib/canPlay', () => ({
  browserCanPlay: (mime: string) => support.current(mime),
  browserCanStream: (mime: string) => support.stream(mime),
}))
