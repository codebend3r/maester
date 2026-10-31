package expo.modules.ravenaudio

import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.ForwardingSimpleBasePlayer
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.source.MediaSource
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaLibraryService
import androidx.media3.session.MediaSession
import androidx.media3.session.SessionError
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.SettableFuture

/** The system's transport controls, as `REMOTE_COMMANDS` in `@raven/core` names them. */
object RemoteCommands {
  const val PLAY = "play"
  const val PAUSE = "pause"
  const val NEXT = "next"
  const val PREVIOUS = "previous"
  const val STOP = "stop"
  const val SEEK = "seek"
}

/** The browse tree's root, `BROWSE_ROOTS.home` on the JS side. */
private const val BROWSE_ROOT = "root"

/** A remote command as the contract's `isRemoteCommand` reads it: `{ kind }`, or `{ kind, time }` to seek. */
typealias RemoteCommand = Map<String, Any>

/**
 * Hands every transport command the session hears to the app instead of the player: the queue
 * lives in JS, so next and previous mean nothing to a window of two, and iOS sends every remote
 * command to JS too. The app answers by calling the module, which drives the player itself.
 */
@OptIn(UnstableApi::class)
private class RemotePlayer(player: Player, private val forward: (RemoteCommand) -> Unit) :
  ForwardingSimpleBasePlayer(player) {

  /** Next and previous stay on with one item held, since the app's queue may go on past it. */
  override fun getState(): State {
    val state = super.getState()
    val commands = state.availableCommands.buildUpon()
      .addAll(
        Player.COMMAND_SEEK_TO_NEXT,
        Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM,
        Player.COMMAND_SEEK_TO_PREVIOUS,
        Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM,
      )
      .build()
    return state.buildUpon().setAvailableCommands(commands).build()
  }

  override fun handleSetPlayWhenReady(playWhenReady: Boolean): ListenableFuture<*> {
    forward(mapOf("kind" to if (playWhenReady) RemoteCommands.PLAY else RemoteCommands.PAUSE))
    return Futures.immediateVoidFuture()
  }

  override fun handleSeek(mediaItemIndex: Int, positionMs: Long, seekCommand: Int): ListenableFuture<*> {
    when (seekCommand) {
      Player.COMMAND_SEEK_TO_NEXT, Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM ->
        forward(mapOf("kind" to RemoteCommands.NEXT))
      Player.COMMAND_SEEK_TO_PREVIOUS, Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM ->
        forward(mapOf("kind" to RemoteCommands.PREVIOUS))
      Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM, Player.COMMAND_SEEK_BACK, Player.COMMAND_SEEK_FORWARD ->
        if (positionMs != C.TIME_UNSET) {
          forward(mapOf("kind" to RemoteCommands.SEEK, "time" to positionMs / 1000.0))
        }
      // Play on an ended item first asks to go back to its start; the app decides what plays.
      else -> Unit
    }
    return Futures.immediateVoidFuture()
  }

  override fun handleStop(): ListenableFuture<*> {
    forward(mapOf("kind" to RemoteCommands.STOP))
    return Futures.immediateVoidFuture()
  }

  // A car's chosen node reaches the app as `playFromBrowse`, which opens the window itself.
  override fun handleSetMediaItems(
    mediaItems: MutableList<MediaItem>,
    startIndex: Int,
    startPositionMs: Long,
  ): ListenableFuture<*> = Futures.immediateVoidFuture()

  override fun handleAddMediaItems(index: Int, mediaItems: MutableList<MediaItem>): ListenableFuture<*> =
    Futures.immediateVoidFuture()
}

private val rootItem: MediaItem = MediaItem.Builder()
  .setMediaId(BROWSE_ROOT)
  .setMediaMetadata(MediaMetadata.Builder().setIsBrowsable(true).setIsPlayable(false).build())
  .build()

/**
 * The browse tree Android Auto reads: the root, then each parent's children through the bridge,
 * asked of the app and answered from the cache when it is not there to answer. A chosen node
 * goes to the app as `playFromBrowse`, which fills its queue and drives the player itself.
 */
@OptIn(UnstableApi::class)
private class LibraryCallback(private val service: RavenAudioService) :
  MediaLibraryService.MediaLibrarySession.Callback {
  override fun onGetLibraryRoot(
    session: MediaLibraryService.MediaLibrarySession,
    browser: MediaSession.ControllerInfo,
    params: MediaLibraryService.LibraryParams?,
  ): ListenableFuture<LibraryResult<MediaItem>> = Futures.immediateFuture(LibraryResult.ofItem(rootItem, params))

  override fun onGetChildren(
    session: MediaLibraryService.MediaLibrarySession,
    browser: MediaSession.ControllerInfo,
    parentId: String,
    page: Int,
    pageSize: Int,
    params: MediaLibraryService.LibraryParams?,
  ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> {
    val future = SettableFuture.create<LibraryResult<ImmutableList<MediaItem>>>()
    RavenBrowse.bridge(service).children(parentId) { answer ->
      val onPage = if (pageSize > 0) answer.nodes.drop(page * pageSize).take(pageSize) else answer.nodes
      val items = onPage.map { node -> service.browseItemOf(node, answer.artworkHeaders) }
      future.set(LibraryResult.ofItemList(ImmutableList.copyOf(items), params))
    }
    return future
  }

  override fun onGetItem(
    session: MediaLibraryService.MediaLibrarySession,
    browser: MediaSession.ControllerInfo,
    mediaId: String,
  ): ListenableFuture<LibraryResult<MediaItem>> {
    if (mediaId == BROWSE_ROOT) return Futures.immediateFuture(LibraryResult.ofItem(rootItem, null))
    val node = RavenBrowse.bridge(service).nodeOf(mediaId)
      ?: return Futures.immediateFuture(LibraryResult.ofError(SessionError.ERROR_BAD_VALUE))
    return Futures.immediateFuture(LibraryResult.ofItem(service.browseItemOf(node, emptyMap()), null))
  }

  /**
   * A node chosen in the car carries only its id, so the app is told which, and the items are
   * handed back as they came: `RemotePlayer` takes no queue from a controller.
   */
  override fun onAddMediaItems(
    mediaSession: MediaSession,
    controller: MediaSession.ControllerInfo,
    mediaItems: MutableList<MediaItem>,
  ): ListenableFuture<MutableList<MediaItem>> {
    mediaItems
      .filter { it.localConfiguration == null }
      .forEach { item -> RavenBrowse.play?.invoke(item.mediaId) }
    return Futures.immediateFuture(mediaItems)
  }
}

/**
 * Owns the one ExoPlayer and the media session over it, which gives the notification, the lock
 * screen, Bluetooth buttons and the foreground service that keeps music playing in the
 * background. The module runs in the same process and drives `player` directly.
 */
@OptIn(UnstableApi::class)
class RavenAudioService : MediaLibraryService() {
  /** Hears the service come and go: the module, which drives its player. */
  class Observer(val onCreated: (RavenAudioService) -> Unit, val onDestroyed: (RavenAudioService) -> Unit)

  companion object {
    /** The service while it runs: the module and the service share one process. */
    var running: RavenAudioService? = null
      private set

    private var observers: List<Observer> = emptyList()

    fun observe(observer: Observer) {
      if (observers.none { it === observer }) observers = observers + observer
    }

    fun forget(observer: Observer) {
      observers = observers.filter { it !== observer }
    }
  }

  lateinit var player: ExoPlayer
    private set

  private var session: MediaLibrarySession? = null

  /** Hears the remote commands; the module sets it while it lives. */
  var onRemote: ((RemoteCommand) -> Unit)? = null

  override fun onCreate() {
    super.onCreate()
    val attributes = AudioAttributes.Builder()
      .setUsage(C.USAGE_MEDIA)
      .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
      .build()
    // ExoPlayer takes audio focus and pauses for a call or when headphones come out; the
    // module reports that pause through its state events.
    val made = ExoPlayer.Builder(this)
      .setAudioAttributes(attributes, true)
      .setHandleAudioBecomingNoisy(true)
      .setWakeMode(C.WAKE_MODE_NETWORK)
      .build()
    player = made
    val built = MediaLibrarySession.Builder(this, RemotePlayer(made) { command -> onRemote?.invoke(command) }, LibraryCallback(this))
      .build()
    session = built
    RavenBrowse.onLateAnswer = { parentId, count -> built.notifyChildrenChanged(parentId, count, null) }
    running = this
    observers.forEach { it.onCreated(this) }
  }

  override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaLibrarySession? = session

  override fun onDestroy() {
    running = null
    RavenBrowse.onLateAnswer = null
    observers.forEach { it.onDestroyed(this) }
    onRemote = null
    session?.release()
    session = null
    player.release()
    super.onDestroy()
  }

  /** A node as Android Auto lists it: a folder to open, a node to play, or the app's own note. */
  fun browseItemOf(node: BrowseNode, artworkHeaders: Map<String, String>): MediaItem {
    val metadata = MediaMetadata.Builder()
      .setTitle(node.title)
      .setSubtitle(node.subtitle)
      .setArtist(node.subtitle)
      .setArtworkUri(node.artworkUri?.let { RavenArtworkProvider.uriFor(this, it, artworkHeaders) })
      .setIsBrowsable(!node.isPlayable && node.id != OPEN_APP_NODE.id)
      .setIsPlayable(node.isPlayable)
      .build()
    return MediaItem.Builder().setMediaId(node.id).setMediaMetadata(metadata).build()
  }

  /**
   * The source for one track, with its own headers: tracks carry their own tickets, so each
   * gets a `DefaultHttpDataSource` of its own rather than one shared set of request properties.
   * `DefaultDataSource` over it also opens a downloaded `file://` track.
   */
  fun sourceOf(track: AudioTrack): MediaSource {
    val http = DefaultHttpDataSource.Factory().setDefaultRequestProperties(track.headers)
    val metadata = MediaMetadata.Builder()
      .setTitle(track.title)
      .setArtist(track.artist)
      .setAlbumTitle(track.album)
      .setArtworkUri(track.artworkUri?.let(Uri::parse))
      .setDurationMs(track.duration?.let { (it * 1000).toLong() })
      .setIsBrowsable(false)
      .setIsPlayable(true)
      .build()
    val item = MediaItem.Builder()
      .setMediaId(track.mediaId)
      .setUri(track.uri)
      .setMediaMetadata(metadata)
      .build()
    return DefaultMediaSourceFactory(DefaultDataSource.Factory(this, http)).createMediaSource(item)
  }
}
