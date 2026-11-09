/** The prefix every media controller mounts under, as `@Controller` takes it. */
export const MEDIA_ROUTES = 'api/media'

/** A path core names under the media routes, with its leading slash. */
type MediaPath = `/${typeof MEDIA_ROUTES}/${string}`

/** A media path as its controller's route: what follows the `api/media` prefix, as `@Get` takes it. */
export const routeOf = (path: MediaPath): string => path.slice(`/${MEDIA_ROUTES}/`.length)
