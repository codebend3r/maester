/**
 * What imports no React Native or Expo module, so bun's tests load it as the device does: Wren's
 * routes, and the music library pick the listings read. What reaches the device is in `index.ts`.
 */
export {
  WREN_PAGES,
  WREN_ROUTES,
  WREN_ROUTE_PARAMS,
  WREN_SCREENS,
  WREN_TABS,
  collectionPathOf,
  libraryHref,
  pageHref,
} from '@/routes'
export { configureLibraryChoice } from '@/music/musicLibraries'
