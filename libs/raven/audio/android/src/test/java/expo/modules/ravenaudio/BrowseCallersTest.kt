package expo.modules.ravenaudio

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

private const val OWN = "app.netlify.wren"

class BrowseCallersTest {
  @Test
  fun theAppAndTheCarsMayBrowse() {
    listOf(
      OWN,
      "com.google.android.projection.gearhead",
      "com.android.systemui",
      "com.google.android.googlequicksearchbox",
    ).forEach { caller -> assertTrue(caller, canBrowse(caller, OWN)) }
  }

  @Test
  fun anyOtherAppMayNot() {
    assertFalse(canBrowse("com.example.snoop", OWN))
    assertFalse(canBrowse("", OWN))
  }

  @Test
  fun aPlayThatFollowsAChosenNodeIsSwallowedOnce() {
    var now = 0L
    val gate = PlayAfterBrowse(clock = { now })

    gate.chosen()
    now += 500

    assertTrue(gate.shouldSwallowPlay())
    assertFalse(gate.shouldSwallowPlay())
  }

  @Test
  fun aLaterPlayIsTheListeners() {
    var now = 0L
    val gate = PlayAfterBrowse(clock = { now })

    assertFalse(gate.shouldSwallowPlay())
    gate.chosen()
    now += PLAY_AFTER_BROWSE_MS + 1

    assertFalse(gate.shouldSwallowPlay())
  }
}
