package expo.modules.ravenaudio

/**
 * Who may read the browse tree beside the app itself: Android Auto, the system's media
 * controls and Google's assistant. Any other app that binds the service may still drive
 * playback through the session, but never lists the library or asks the app to fetch for it.
 */
private val BROWSERS = setOf(
  "com.google.android.projection.gearhead",
  "com.android.systemui",
  "com.google.android.googlequicksearchbox",
)

fun canBrowse(packageName: String, ownPackage: String): Boolean =
  packageName == ownPackage || packageName in BROWSERS

/** How soon after a car chose a node its Play may come and still be the choice's own. */
const val PLAY_AFTER_BROWSE_MS = 5_000L

/**
 * Android Auto follows a chosen node with Play. The app opens that node's window itself once
 * JS has its tracks, so a Play forwarded at once would first resume the old queue; the one Play
 * that follows a choice within `PLAY_AFTER_BROWSE_MS` is swallowed.
 */
class PlayAfterBrowse(private val clock: () -> Long) {
  private var chosenAt: Long? = null

  fun chosen() {
    chosenAt = clock()
  }

  fun shouldSwallowPlay(): Boolean {
    val at = chosenAt ?: return false
    chosenAt = null
    return clock() - at <= PLAY_AFTER_BROWSE_MS
  }
}
