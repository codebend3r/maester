import { type EventSubscription, requireNativeModule } from 'expo-modules-core'

import { isRecord } from '@raven/core'

import { type KeyDown, isKeyDown } from '@/contract'

/** The native module's name, and the one event it emits: a key going down. */
const NATIVE = { module: 'RavenKeys', keyDown: 'onKeyDown' } as const

type NativeKeysModule = {
  /** Takes the hardware keyboard's `keys` (the web's `KeyboardEvent.key` names) until `stop`. */
  start: (keys: string[]) => Promise<void>
  stop: () => Promise<void>
  addListener: (
    name: typeof NATIVE.keyDown,
    listener: (event: unknown) => void,
  ) => EventSubscription
}

/**
 * The native module, or null where the build carries none (a TV, a test), so a screen that asks
 * for the keys there hears nothing rather than failing.
 */
const isFunction = (value: unknown): boolean => typeof value === 'function'

/** Whether the module Expo handed over has the calls this one makes. */
const isNativeKeysModule = (value: unknown): value is NativeKeysModule =>
  isRecord(value) &&
  isFunction(value.start) &&
  isFunction(value.stop) &&
  isFunction(value.addListener)

const nativeOrNull = (): NativeKeysModule | null => {
  try {
    const native: unknown = requireNativeModule(NATIVE.module)
    return isNativeKeysModule(native) ? native : null
  } catch {
    return null
  }
}

type WatchKeysProps = {
  /** The keys to hear, by the web's `KeyboardEvent.key` names. */
  keys: readonly string[]
  onKey: (press: KeyDown) => void
}

/**
 * Hears the hardware keyboard's `keys` through `onKey` until the function it returns is called,
 * which gives the keys back to the system.
 */
export const watchKeys = ({ keys, onKey }: WatchKeysProps): (() => void) => {
  const native = nativeOrNull()
  if (native === null) return () => undefined
  const subscription = native.addListener(NATIVE.keyDown, (event) => {
    if (isKeyDown(event)) onKey(event)
  })
  // A start the native side refuses leaves the keys with the system, and the screen plays on.
  native.start([...keys]).catch(() => undefined)
  return () => {
    subscription.remove()
    native.stop().catch(() => undefined)
  }
}
