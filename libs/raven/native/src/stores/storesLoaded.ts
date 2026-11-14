import { useEffect, useState } from 'react'

type UseStoresLoadedProps = {
  /** Reads what the app keeps on the device; a store that cannot be read starts empty. */
  load: () => Promise<void>
}

/**
 * Whether the app's stores have been read back, read once as the root mounts, so no route
 * renders before them. A load that fails still lets the app in: what could not be read starts
 * from its defaults.
 */
export const useStoresLoaded = ({ load }: UseStoresLoadedProps): boolean => {
  const [isLoaded, setLoaded] = useState(false)
  useEffect(() => {
    const show = () => setLoaded(true)
    load().then(show, show)
  }, [load])
  return isLoaded
}
