package expo.modules.ravenaudio

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

private fun track(id: Int, duration: Double? = null) = AudioTrack(
  id = id,
  uri = "https://raven.example/api/media/$id/file",
  headers = mapOf("Authorization" to "Bearer ticket-$id"),
  title = "Track $id",
  artist = "Artist",
  album = "Album",
  artworkUri = null,
  duration = duration,
)

class AudioWindowTest {
  @Test
  fun opensTheWindowInPlayOrder() {
    val window = AudioWindow()

    val held = window.open(listOf(track(1), track(2)))

    assertEquals(listOf("1", "2"), held.map { it.mediaId })
    assertEquals(listOf("1", "2"), window.tracks.map { it.mediaId })
    assertEquals(1, window.current?.id)
  }

  @Test
  fun leavesOutAnItemWithNoAddress() {
    val window = AudioWindow()

    val held = window.open(listOf(track(1).copy(uri = " "), track(2)))

    assertEquals(listOf("2"), held.map { it.mediaId })
  }

  @Test
  fun setNextReplacesOnlyTheItemAfterTheCurrentOne() {
    val window = AudioWindow()
    window.open(listOf(track(1), track(2)))

    val added = window.replaceNext(listOf(track(3)))

    assertEquals(listOf("3"), added?.map { it.mediaId })
    assertEquals(listOf("1", "3"), window.tracks.map { it.mediaId })
  }

  @Test
  fun setNextWithNothingClearsWhatFollows() {
    val window = AudioWindow()
    window.open(listOf(track(1), track(2)))

    window.replaceNext(emptyList())

    assertEquals(listOf("1"), window.tracks.map { it.mediaId })
  }

  @Test
  fun setNextKeepsTheItemPlayingAfterAnAdvance() {
    val window = AudioWindow()
    window.open(listOf(track(1), track(2)))
    window.transitioned(isAutomatic = true)

    window.replaceNext(listOf(track(3)))

    assertEquals(listOf("2", "3"), window.tracks.map { it.mediaId })
  }

  @Test
  fun setNextWithNothingPlayingChangesNothing() {
    val window = AudioWindow()

    assertNull(window.replaceNext(listOf(track(3))))
    assertEquals(emptyList<String>(), window.tracks.map { it.mediaId })
  }

  @Test
  fun anAutomaticTransitionSendsAdvancedAndDropsTheFinishedItem() {
    val window = AudioWindow()
    window.open(listOf(track(1), track(2)))

    val step = window.transitioned(isAutomatic = true)

    assertEquals(listOf(AudioEventTypes.ADVANCED), step.events)
    assertTrue(step.shouldDropFinished)
    assertFalse(step.shouldPause)
    assertEquals(listOf("2"), window.tracks.map { it.mediaId })
  }

  @Test
  fun aTransitionTheAppAskedForSendsNothing() {
    val window = AudioWindow()
    window.open(listOf(track(1), track(2)))

    val step = window.transitioned(isAutomatic = false)

    assertEquals(emptyList<String>(), step.events)
    assertFalse(step.shouldDropFinished)
    assertEquals(listOf("1", "2"), window.tracks.map { it.mediaId })
  }

  @Test
  fun theLastItemEndingSendsEndedAndPauses() {
    val window = AudioWindow()
    window.open(listOf(track(1)))

    val step = window.ended()

    assertEquals(listOf(AudioEventTypes.ENDED), step.events)
    assertTrue(step.shouldPause)
    assertNull(window.current)
  }

  @Test
  fun anEndAfterTheWindowClosedSendsNothing() {
    val window = AudioWindow()
    window.open(listOf(track(1)))
    window.close()

    val step = window.ended()

    assertEquals(emptyList<String>(), step.events)
    assertFalse(step.shouldPause)
  }

  @Test
  fun theServerDurationWinsOverThePlayers() {
    val window = AudioWindow()
    window.open(listOf(track(1, duration = 241.5)))

    assertEquals(241.5, window.durationOf(playerSeconds = 242.0) ?: 0.0, 0.0)
  }

  @Test
  fun thePlayersDurationFillsInWhenTheServerHasNone() {
    val window = AudioWindow()
    window.open(listOf(track(1)))

    assertEquals(180.0, window.durationOf(playerSeconds = 180.0) ?: 0.0, 0.0)
    assertNull(window.durationOf(playerSeconds = null))
  }
}
