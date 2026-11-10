import { type EventSubscription, requireNativeModule } from 'expo-modules-core'

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
const nativeOrNull = (): NativeKeysModule | null => {
  try {
    return requireNativeModule<NativeKeysModule>(NATIVE.module)
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
