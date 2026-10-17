import { SetMetadata } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { MarkTargets } from '@/routeMarks'

const MEDIA_PLANE = Symbol('MEDIA_PLANE')

/**
 * Marks a GET that a browser on another origin may ask for: the media
 * plane, which opens to the origins in RAVEN_MEDIA_ORIGINS and, when held by
 * `PrivateBy('media')`, to a request carrying a media ticket in place of the
 * cookie.
 */
export const MediaPlane = () => SetMetadata(MEDIA_PLANE, true)

const decorators = new Reflector()

/** Whether a route, or else its controller, is marked `MediaPlane`, read the same by the guard and the route inventory. */
export const isMediaPlaneRoute = (targets: MarkTargets): boolean =>
  decorators.getAllAndOverride(MEDIA_PLANE, targets) === true
