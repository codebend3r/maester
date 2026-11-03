import { type ComponentType, lazy } from 'react'

/** Imports a page's module and picks the page out of it, so the module keeps its named exports. */
type LoadPage<Props> = () => Promise<ComponentType<Props>>

/**
 * A page the browser fetches the first time a route renders it, as a chunk of
 * its own, so the pages few visits reach stay out of the one every visit loads.
 */
export const lazyPage = <Props extends object>(load: LoadPage<Props>) =>
  lazy(async () => ({ default: await load() }))
