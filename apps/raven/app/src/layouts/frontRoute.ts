/** A route as a navigator's state lists it, with the state of a navigator nested in it. */
type RouteLike = { key?: string; state?: NavigationLike }

/** A navigator's state, or the part of it a navigator nested in a route holds so far. */
type NavigationLike = { index?: number; routes: readonly RouteLike[] }

type FrontRouteKeyOfProps = { state: NavigationLike | undefined }

/**
 * The key of the route in front, the one whose screen the viewer sees, as `useRoute().key` names
 * it on that screen: the focused route of the deepest navigator. Null before any route is known.
 */
export const frontRouteKeyOf = ({ state }: FrontRouteKeyOfProps): string | null => {
  const routes = state?.routes ?? []
  const route = routes[state?.index ?? routes.length - 1]
  if (route === undefined) return null
  return route.state === undefined ? (route.key ?? null) : frontRouteKeyOf({ state: route.state })
}
