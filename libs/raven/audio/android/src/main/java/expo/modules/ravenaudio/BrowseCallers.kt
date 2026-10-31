package expo.modules.ravenaudio

import android.os.Build
import androidx.media3.session.MediaSession

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

/** What Media3 names a legacy controller whose package the platform cannot tell it. */
const val LEGACY_CONTROLLER = MediaSession.ControllerInfo.LEGACY_CONTROLLER_PACKAGE_NAME

/**
 * Who may choose a node to play. Below Android 9 the platform cannot name a legacy
 * `MediaControllerCompat`'s package, and Android Auto's play-from-id comes through one, so
 * there a legacy controller may choose too; it still never lists, since listing comes through
 * the browser connection, whose package is known.
 */
fun canChoose(packageName: String, ownPackage: String, sdk: Int): Boolean =
  canBrowse(packageName, ownPackage) || (sdk < Build.VERSION_CODES.P && packageName == LEGACY_CONTROLLER)

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
