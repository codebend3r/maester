/**
 * What the apps' tests build their fake servers from: the answers a fetch gets, and media and
 * titles as the server lists them. Nothing here is bundled into an app; only tests import it.
 */
export {
  type Answer,
  type HeardRequest,
  NOT_FOUND,
  STATUSES,
  pathWithId,
  responseOf,
} from '@/test/fixtureFetch'
export { mediaItemFor, summaryFor } from '@/test/mediaItem'
