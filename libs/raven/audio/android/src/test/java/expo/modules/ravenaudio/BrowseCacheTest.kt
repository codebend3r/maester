package expo.modules.ravenaudio

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

private class MemoryStore : BrowseStore {
  var values: Map<String, String> = emptyMap()
    private set

  override fun read(key: String): String? = values[key]

  override fun write(key: String, value: String) {
    values = values + (key to value)
  }

  override fun clear() {
    values = emptyMap()
  }
}

/** A clock the test moves by hand: what is due runs as `advance` passes its time. */
private class ManualTimer : BrowseTimer {
  private var now = 0L
  private var due: List<Pair<Long, () -> Unit>> = emptyList()

  override fun after(ms: Long, run: () -> Unit): () -> Unit {
    val entry = (now + ms) to run
    due = due + entry
    return { due = due.filter { it !== entry } }
  }

  fun advance(ms: Long) {
    now += ms
    val ready = due.filter { it.first <= now }
    due = due - ready.toSet()
    ready.forEach { it.second() }
  }
}

private val ALBUM = BrowseNode(
  id = "album:3",
  title = "Morning Chorus",
  subtitle = "The Fixture Birds",
  artworkUri = "file:///data/cover.jpg",
  isPlayable = true,
)
private val PLAYLIST = BrowseNode(id = "playlist:9", title = "Road trip", subtitle = null, artworkUri = null, isPlayable = true)

private class Car {
  val store = MemoryStore()
  val timer = ManualTimer()
  var asked: List<Pair<String, String>> = emptyList()
  var delivered: List<BrowseAnswer> = emptyList()
  var late: List<String> = emptyList()
  private var nextId = 0
  var isAppRunning = true
  private val ask: (String, String) -> Unit = { requestId, parentId -> asked = asked + (requestId to parentId) }

  val bridge = BrowseBridge(
    cache = BrowseCache(store),
    timer = timer,
    newId = { "r${++nextId}" },
    asker = { if (isAppRunning) ask else null },
    onLateAnswer = { parentId, _ -> late = late + parentId },
  )

  fun browse(parentId: String) = bridge.children(parentId) { delivered = delivered + it }
}

class BrowseCacheTest {
  @Test
  fun theCacheReadsBackWhatItWrote() {
    val cache = BrowseCache(MemoryStore())

    cache.write("albums", listOf(ALBUM, PLAYLIST))

    assertEquals(listOf(ALBUM, PLAYLIST), cache.read("albums"))
    assertNull(cache.read("playlists"))
  }

  @Test
  fun anUnreadableCacheReadsAsNone() {
    val store = MemoryStore()
    store.write("raven.browse.albums", "not json")

    assertNull(BrowseCache(store).read("albums"))
  }

  @Test
  fun theAppsAnswerIsDeliveredUnderItsRequestAndCached() {
    val car = Car()
    car.browse("albums")
    val (requestId, parentId) = car.asked.single()

    car.bridge.answer(requestId, BrowseAnswer(listOf(ALBUM), mapOf("cookie" to "raven_unlock=1")))

    assertEquals("albums", parentId)
    assertEquals(listOf(BrowseAnswer(listOf(ALBUM), mapOf("cookie" to "raven_unlock=1"))), car.delivered)
    assertEquals(listOf(ALBUM), BrowseCache(car.store).read("albums"))
    car.timer.advance(BROWSE_WAIT_MS)
    assertEquals(1, car.delivered.size)
  }

  @Test
  fun noAnswerInThreeSecondsServesTheCache() {
    val car = Car()
    BrowseCache(car.store).write("albums", listOf(ALBUM))
    car.browse("albums")

    car.timer.advance(BROWSE_WAIT_MS - 1)
    assertEquals(emptyList<BrowseAnswer>(), car.delivered)
    car.timer.advance(1)

    assertEquals(listOf(BrowseAnswer(listOf(ALBUM), emptyMap())), car.delivered)
  }

  @Test
  fun noAnswerAndNoCacheServesOpenWren() {
    val car = Car()
    car.browse("albums")

    car.timer.advance(BROWSE_WAIT_MS)

    val node = car.delivered.single().nodes.single()
    assertEquals(OPEN_APP_NODE, node)
    assertEquals("Open Wren on your phone", node.title)
    assertEquals(false, node.isPlayable)
  }

  @Test
  fun withTheAppNotRunningTheCacheServesAtOnce() {
    val car = Car()
    car.isAppRunning = false
    BrowseCache(car.store).write("root", listOf(PLAYLIST))

    car.browse("root")

    assertEquals(emptyList<Pair<String, String>>(), car.asked)
    assertEquals(listOf(BrowseAnswer(listOf(PLAYLIST), emptyMap())), car.delivered)
  }

  @Test
  fun aLateAnswerIsCachedAndAnnounced() {
    val car = Car()
    car.browse("albums")
    val (requestId, _) = car.asked.single()
    car.timer.advance(BROWSE_WAIT_MS)

    car.bridge.answer(requestId, BrowseAnswer(listOf(ALBUM), emptyMap()))

    assertEquals(1, car.delivered.size)
    assertEquals(listOf("albums"), car.late)
    assertEquals(listOf(ALBUM), BrowseCache(car.store).read("albums"))
  }

  @Test
  fun anAnswerToNoRequestIsIgnored() {
    val car = Car()

    car.bridge.answer("unknown", BrowseAnswer(listOf(ALBUM), emptyMap()))

    assertEquals(emptyMap<String, String>(), car.store.values)
    assertEquals(emptyList<String>(), car.late)
  }

  @Test
  fun aNodeTheCarWasShownCanBeLookedUp() {
    val car = Car()
    car.browse("albums")
    car.bridge.answer(car.asked.single().first, BrowseAnswer(listOf(ALBUM), emptyMap()))

    assertEquals(ALBUM, car.bridge.nodeOf("album:3"))
    assertNull(car.bridge.nodeOf("album:4"))
  }

  @Test
  fun clearingForgetsEveryListAndNode() {
    val car = Car()
    car.browse("albums")
    car.bridge.answer(car.asked.single().first, BrowseAnswer(listOf(ALBUM), emptyMap()))

    car.bridge.clear()
    car.browse("albums")
    car.timer.advance(BROWSE_WAIT_MS)

    assertNull(car.bridge.nodeOf("album:3"))
    assertEquals(listOf(OPEN_APP_NODE), car.delivered.last().nodes)
  }

  @Test
  fun theNodesShownAreBounded() {
    val car = Car()
    val many = (1..SHOWN_KEPT + 10).map { ALBUM.copy(id = "album:$it") }
    car.browse("albums")

    car.bridge.answer(car.asked.single().first, BrowseAnswer(many, emptyMap()))

    assertNull(car.bridge.nodeOf("album:1"))
    assertEquals(many.last(), car.bridge.nodeOf("album:${SHOWN_KEPT + 10}"))
  }
}
