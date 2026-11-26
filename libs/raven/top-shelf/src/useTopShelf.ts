import { requireOptionalNativeModule } from 'expo-modules-core'
import { useEffect, useRef } from 'react'

import { type TopShelf, topShelfKeyOf } from '@/contract'

/** The name `RavenTopShelfModule` registers under. */
const NATIVE_MODULE = 'RavenTopShelf'

type NativeTopShelfModule = {
  /**
   * Downloads each item's picture into the App Group's container, writes the shelf beside them
   * for the extension to read, and asks tvOS to load the Top Shelf again.
   */
  show: (shelf: string) => Promise<void>
}

/*
 * Null on Android, which has no Top Shelf and builds no module of this package's. The pod builds
 * for iOS too, where `show` does nothing.
 */
const native = requireOptionalNativeModule<NativeTopShelfModule>(NATIVE_MODULE)

/** Writes the shelf the home screen shows above the app's tile. */
const showTopShelf = async (shelf: TopShelf): Promise<void> => {
  await native?.show(JSON.stringify(shelf))
}

/**
 * Keeps the Top Shelf showing `shelf`, writing it whenever its titles change; null while what it
 * is made of is still on its way, which leaves the last one up. A write that fails is tried again
 * with the next change.
 */
export const useTopShelf = (shelf: TopShelf | null): void => {
  const written = useRef<string | null>(null)
  useEffect(() => {
    if (shelf === null) return
    const key = topShelfKeyOf(shelf)
    if (key === written.current) return
    written.current = key
    showTopShelf(shelf).catch(() => {
      written.current = null
    })
  }, [shelf])
}
