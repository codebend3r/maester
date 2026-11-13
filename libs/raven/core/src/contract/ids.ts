import { wholeNumberIn } from '@/schema'

/** A server's id for a video, an item, a library, an album or a playlist: a whole number from 1. */
export const isMediaId = wholeNumberIn({ min: 1 })
