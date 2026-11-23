import { matching, wholeNumberIn } from '@/schema'

/** A server's id for a video, an item, a library, an album or a playlist: a whole number from 1. */
export const isMediaId = wholeNumberIn({ min: 1 })

/** A UUID in its usual 8-4-4-4-12 hex form, either case. */
export const isUuid = matching(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
