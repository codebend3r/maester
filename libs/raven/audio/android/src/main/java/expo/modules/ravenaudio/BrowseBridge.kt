package expo.modules.ravenaudio

import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/** One entry of Android Auto's lists: see `BrowseNode` in `src/contract.ts`. */
data class BrowseNode(
  val id: String,
  val title: String,
  val subtitle: String?,
  val artworkUri: String?,
  val isPlayable: Boolean,
)

/** The app's answer to one request: the nodes, and the headers each http cover is fetched with. */
data class BrowseAnswer(val nodes: List<BrowseNode>, val artworkHeaders: Map<String, String>)

/** How long the app has to answer before the car is answered from the cache. */
const val BROWSE_WAIT_MS = 3_000L

/** What the car shows when the app has never answered: the app's own copy, as it cannot ask JS. */
private const val OPEN_APP_COPY = "Open Wren on your phone"

val OPEN_APP_NODE = BrowseNode(id = "open-app", title = OPEN_APP_COPY, subtitle = null, artworkUri = null, isPlayable = false)

/** Where the cache keeps its strings: `SharedPreferences` on the device, a map in the tests. */
interface BrowseStore {
  fun read(key: String): String?

  fun write(key: String, value: String)

  /** Forgets every key: the store holds the cache alone. */
  fun clear()
}

/** Runs `run` after `ms`, on the thread the car's requests come on; the answer cancels it. */
fun interface BrowseTimer {
  fun after(ms: Long, run: () -> Unit): () -> Unit
}

private const val CACHE_PREFIX = "raven.browse."

private object NodeFields {
  const val ID = "id"
  const val TITLE = "title"
  const val SUBTITLE = "subtitle"
  const val ARTWORK_URI = "artworkUri"
  const val IS_PLAYABLE = "isPlayable"
}

/**
 * The last answer for each parent, as JSON, so a car that connects before the app runs still
 * lists what it listed last. Headers are never kept: they carry the account's token.
 */
class BrowseCache(private val store: BrowseStore) {
  fun read(parentId: String): List<BrowseNode>? {
    val saved = store.read(CACHE_PREFIX + parentId) ?: return null
    return try {
      val array = JSONArray(saved)
      (0 until array.length()).map { index -> nodeOf(array.getJSONObject(index)) }
    } catch (error: JSONException) {
      null
    }
  }

  fun clear() = store.clear()

  fun write(parentId: String, nodes: List<BrowseNode>) {
    val array = JSONArray()
    nodes.forEach { node ->
      array.put(
        JSONObject()
          .put(NodeFields.ID, node.id)
          .put(NodeFields.TITLE, node.title)
          .put(NodeFields.SUBTITLE, node.subtitle ?: JSONObject.NULL)
          .put(NodeFields.ARTWORK_URI, node.artworkUri ?: JSONObject.NULL)
          .put(NodeFields.IS_PLAYABLE, node.isPlayable),
      )
    }
    store.write(CACHE_PREFIX + parentId, array.toString())
  }

  private fun nodeOf(saved: JSONObject) = BrowseNode(
    id = saved.getString(NodeFields.ID),
    title = saved.getString(NodeFields.TITLE),
    subtitle = optionalString(saved, NodeFields.SUBTITLE),
    artworkUri = optionalString(saved, NodeFields.ARTWORK_URI),
    isPlayable = saved.getBoolean(NodeFields.IS_PLAYABLE),
  )

  private fun optionalString(saved: JSONObject, field: String): String? =
    if (saved.isNull(field)) null else saved.getString(field)
}

/** Asks the app for a parent's children under a request id: the module's event to JS. */
typealias BrowseAsker = (requestId: String, parentId: String) -> Unit

/** How many timed out requests a late answer may still land on. */
private const val LATE_KEPT = 32

/** How many nodes the car was shown are kept for `nodeOf`: a few long lists' worth. */
const val SHOWN_KEPT = 1_000

/**
 * Ruling 10's bridge, apart from Android so its rules run on the JVM: the car's request goes to
 * the app, whose answer is delivered and cached; with no answer in `BROWSE_WAIT_MS` (the app
 * not yet running), or no app to ask, the cache answers, and with no cache one node asks the
 * listener to open the app. An answer that comes late is cached and announced, so the car
 * can ask again. Everything runs on one thread, the session's.
 */
class BrowseBridge(
  private val cache: BrowseCache,
  private val timer: BrowseTimer,
  private val newId: () -> String,
  private val asker: () -> BrowseAsker?,
  private val onLateAnswer: (parentId: String, count: Int) -> Unit,
) {
  private class Waiting(val parentId: String, val deliver: (BrowseAnswer) -> Unit, val cancel: () -> Unit)

  private var waiting: Map<String, Waiting> = emptyMap()
  private var late: List<Pair<String, String>> = emptyList()
  private var shown: Map<String, BrowseNode> = emptyMap()

  fun children(parentId: String, deliver: (BrowseAnswer) -> Unit) {
    val ask = asker()
    if (ask == null) {
      deliver(fallback(parentId))
      return
    }
    val requestId = newId()
    val cancel = timer.after(BROWSE_WAIT_MS) { timedOut(requestId) }
    waiting = waiting + (requestId to Waiting(parentId, deliver, cancel))
    ask(requestId, parentId)
  }

  fun answer(requestId: String, answer: BrowseAnswer) {
    val asked = waiting[requestId]
    if (asked != null) {
      waiting = waiting - requestId
      asked.cancel()
      remember(asked.parentId, answer.nodes)
      asked.deliver(answer)
      return
    }
    val parentId = late.firstOrNull { it.first == requestId }?.second ?: return
    late = late.filter { it.first != requestId }
    remember(parentId, answer.nodes)
    onLateAnswer(parentId, answer.nodes.size)
  }

  /** A node the car has been shown, for a request that names it alone. */
  fun nodeOf(id: String): BrowseNode? = shown[id]

  /** Forgets every list and node: another account's titles must never show in the car. */
  fun clear() {
    cache.clear()
    shown = emptyMap()
  }

  private fun timedOut(requestId: String) {
    val asked = waiting[requestId] ?: return
    waiting = waiting - requestId
    late = (late + (requestId to asked.parentId)).takeLast(LATE_KEPT)
    asked.deliver(fallback(asked.parentId))
  }

  private fun remember(parentId: String, nodes: List<BrowseNode>) {
    cache.write(parentId, nodes)
    show(nodes)
  }

  /** Newest last, so the oldest go first once past `SHOWN_KEPT`. */
  private fun show(nodes: List<BrowseNode>) {
    val ids = nodes.map { it.id }.toSet()
    shown = (shown - ids + nodes.associateBy { it.id }).entries.toList().takeLast(SHOWN_KEPT).associate { it.toPair() }
  }

  private fun fallback(parentId: String): BrowseAnswer {
    val cached = cache.read(parentId)
    cached?.let(::show)
    return BrowseAnswer(cached ?: listOf(OPEN_APP_NODE), emptyMap())
  }
}
