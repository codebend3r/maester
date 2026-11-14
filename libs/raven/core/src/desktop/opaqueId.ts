import { matching } from '@/schema'

/*
 * A standard scheme lowercases its host, so an id must already be lowercase to
 * survive a round trip through `raven-file://<id>`.
 */
const OPAQUE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** What `crypto.randomUUID()` returns: the only handle the page ever holds for a file. */
export const isOpaqueId = matching(OPAQUE_ID)
