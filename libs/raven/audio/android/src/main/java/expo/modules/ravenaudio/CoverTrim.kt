package expo.modules.ravenaudio

/** A file in the covers' cache folder, as the trim weighs it. */
data class CoverFile(val name: String, val length: Long, val modified: Long)

const val PART_SUFFIX = ".part"

/** The cache folder's bounds; past either, the covers read longest ago go first. */
const val CACHE_FILES_KEPT = 200
const val CACHE_BYTES_KEPT = 50L * 1024 * 1024

/** A part this old belongs to a fetch a killed process left behind. */
const val PART_ABANDONED_MS = 10L * 60 * 1000

/**
 * A cover read or written this recently stays, whatever the bounds: another thread may have
 * just found it and not yet opened it.
 */
const val RECENT_HIT_MS = 60_000L

/** The files a trim deletes: abandoned parts, and the covers past the bounds that were not just read. */
fun trimmed(covers: List<CoverFile>, now: Long): List<CoverFile> {
  val (parts, whole) = covers.partition { it.name.endsWith(PART_SUFFIX) }
  val abandoned = parts.filter { now - it.modified > PART_ABANDONED_MS }
  val newestFirst = whole.sortedByDescending { it.modified }
  val bytesSoFar = newestFirst.runningFold(0L) { total, each -> total + each.length }.drop(1)
  val past = newestFirst.zip(bytesSoFar).filterIndexed { place, (cover, bytes) ->
    (place >= CACHE_FILES_KEPT || bytes > CACHE_BYTES_KEPT) && now - cover.modified >= RECENT_HIT_MS
  }.map { (cover) -> cover }
  return abandoned + past
}
