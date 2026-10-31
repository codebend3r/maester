package expo.modules.ravenaudio

import org.junit.Assert.assertEquals
import org.junit.Test

private const val NOW = 100_000_000L

private fun cover(name: String, ageMs: Long, length: Long = 1_000) = CoverFile(name, length, NOW - ageMs)

class CoverTrimTest {
  @Test
  fun keepsWhatFitsTheBounds() {
    val covers = listOf(cover("a", RECENT_HIT_MS * 2), cover("b", RECENT_HIT_MS * 3))
    assertEquals(emptyList<CoverFile>(), trimmed(covers, NOW))
  }

  @Test
  fun dropsTheCoversReadLongestAgoPastTheCount() {
    val covers = (0 until CACHE_FILES_KEPT + 2).map { place -> cover("c$place", RECENT_HIT_MS + place * 1_000L) }
    assertEquals(listOf("c${CACHE_FILES_KEPT}", "c${CACHE_FILES_KEPT + 1}"), trimmed(covers, NOW).map { it.name })
  }

  @Test
  fun dropsTheCoversPastTheBytes() {
    val big = CACHE_BYTES_KEPT / 2 + 1
    val covers = listOf(cover("new", RECENT_HIT_MS, big), cover("old", RECENT_HIT_MS * 2, big))
    assertEquals(listOf("old"), trimmed(covers, NOW).map { it.name })
  }

  @Test
  fun neverDropsACoverJustRead() {
    val big = CACHE_BYTES_KEPT / 2 + 1
    val covers = listOf(cover("new", 0, big), cover("hit", RECENT_HIT_MS - 1, big))
    assertEquals(emptyList<CoverFile>(), trimmed(covers, NOW))
  }

  @Test
  fun dropsAPartOnlyOnceItIsAbandoned() {
    val covers = listOf(
      cover("fresh$PART_SUFFIX", PART_ABANDONED_MS),
      cover("stale$PART_SUFFIX", PART_ABANDONED_MS + 1),
    )
    assertEquals(listOf("stale$PART_SUFFIX"), trimmed(covers, NOW).map { it.name })
  }
}
