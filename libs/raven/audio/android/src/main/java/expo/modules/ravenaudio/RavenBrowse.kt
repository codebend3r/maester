package expo.modules.ravenaudio

import android.content.Context
import android.content.SharedPreferences
import android.os.Handler
import android.os.Looper
import java.util.UUID

private const val PREFERENCES_NAME = "raven.browse"

private class PreferencesStore(private val preferences: SharedPreferences) : BrowseStore {
  override fun read(key: String): String? = preferences.getString(key, null)

  override fun write(key: String, value: String) {
    preferences.edit().putString(key, value).apply()
  }

  override fun clear() {
    preferences.edit().clear().apply()
  }
}

/** The session's requests and the module's answers both arrive on the main thread. */
private object MainTimer : BrowseTimer {
  private val handler = Handler(Looper.getMainLooper())

  override fun after(ms: Long, run: () -> Unit): () -> Unit {
    val task = Runnable { run() }
    handler.postDelayed(task, ms)
    return { handler.removeCallbacks(task) }
  }
}

/**
 * Where the service and the module meet over the browse tree: the service may start for a car
 * before the app does, so the module, while it lives, sets how to ask JS and how to play a
 * chosen node, and the service hears late answers. One process holds both.
 */
object RavenBrowse {
  var ask: BrowseAsker? = null
  var play: ((id: String) -> Unit)? = null
  var onLateAnswer: ((parentId: String, count: Int) -> Unit)? = null

  private var made: BrowseBridge? = null

  fun bridge(context: Context): BrowseBridge = made ?: BrowseBridge(
    cache = BrowseCache(PreferencesStore(context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE))),
    timer = MainTimer,
    newId = { UUID.randomUUID().toString() },
    asker = { ask },
    onLateAnswer = { parentId, count -> onLateAnswer?.invoke(parentId, count) },
  ).also { made = it }

  fun clear(context: Context) = bridge(context).clear()

  /** An answer with no bridge made has no request waiting on it. */
  fun answer(requestId: String, answer: BrowseAnswer) {
    made?.answer(requestId, answer)
  }
}
