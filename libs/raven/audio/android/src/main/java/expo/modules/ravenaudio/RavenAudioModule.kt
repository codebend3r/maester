package expo.modules.ravenaudio

import android.content.ComponentName
import android.os.Handler
import android.os.Looper
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.MoreExecutors
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/** One track as the app hands it over: see `AudioItem` in `src/contract.ts`. */
class AudioItem : Record {
  @Field val id: Int = 0
  @Field val uri: String = ""
  @Field val headers: Map<String, String> = emptyMap()
  @Field val title: String = ""
  @Field val artist: String = ""
  @Field val album: String = ""
  @Field val artworkUri: String? = null
  @Field val duration: Double? = null

  fun toTrack() = AudioTrack(
    id = id,
    uri = uri,
    headers = headers,
    title = title,
    artist = artist,
    album = album,
    artworkUri = artworkUri,
    duration = duration,
  )
}

/** One entry of the car's lists as the app answers it: see `BrowseNode` in `src/contract.ts`. */
class BrowseNodeRecord : Record {
  @Field val id: String = ""
  @Field val title: String = ""
  @Field val subtitle: String? = null
  @Field val artworkUri: String? = null
  @Field val isPlayable: Boolean = false

  fun toNode() = BrowseNode(id = id, title = title, subtitle = subtitle, artworkUri = artworkUri, isPlayable = isPlayable)
}

/** The one event the module emits; its `type` says which player event it carries. */
private const val AUDIO_EVENT = "onAudioEvent"

/** How often the playing item reports where it is, as iOS's periodic observer does. */
private const val STATE_INTERVAL_MS = 250L

private const val COULD_NOT_OPEN = "Raven could not open this track."
private const val COULD_NOT_PLAY = "Raven could not play this track."
private const val COULD_NOT_START = "Raven could not start its player."
private const val PLAYER_UNAVAILABLE = "ERR_RAVEN_AUDIO_UNAVAILABLE"

private fun secondsOf(ms: Long) = ms / 1000.0

/**
 * ExoPlayer, in `RavenAudioService`, holding the playing track and the one after it, so the
 * seam plays with no gap while the app is in the background. `AudioWindow` decides what the
 * player holds and what the app hears; this applies it.
 */
class RavenAudioModule : Module() {
  private val window = AudioWindow()
  private val ticker = Handler(Looper.getMainLooper())

  /**
   * Binds the service for as long as the module lives, as the app's own controller, so it is
   * created on the first window and kept while the app runs. Commands go to the player directly.
   */
  private var controller: ListenableFuture<MediaController>? = null
  private val gate = ServiceGate<RavenAudioService>()
  private val observer = RavenAudioService.Observer(onCreated = ::connected, onDestroyed = ::serviceGone)
  private var attached: RavenAudioService? = null
  private var isStopped = true

  /** How fast every item plays, 1 as recorded; ExoPlayer keeps it across items and windows. */
  private var playbackRate = 1f
  private var volume = 1f

  private val player: ExoPlayer?
    get() = attached?.player

  private val tick = object : Runnable {
    override fun run() {
      reportState()
      if (player?.isPlaying == true) ticker.postDelayed(this, STATE_INTERVAL_MS)
    }
  }

  private val listener = object : Player.Listener {
    override fun onIsPlayingChanged(isPlaying: Boolean) {
      ticker.removeCallbacks(tick)
      if (isPlaying) ticker.postDelayed(tick, STATE_INTERVAL_MS)
      reportState()
    }

    override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
      reportState()
    }

    override fun onPlaybackStateChanged(playbackState: Int) {
      if (playbackState == Player.STATE_ENDED) {
        apply(window.ended())
        return
      }
      reportState()
    }

    override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
      apply(window.transitioned(isAutomatic = reason == Player.MEDIA_ITEM_TRANSITION_REASON_AUTO))
      reportState()
    }

    override fun onPositionDiscontinuity(
      oldPosition: Player.PositionInfo,
      newPosition: Player.PositionInfo,
      reason: Int,
    ) {
      if (reason == Player.DISCONTINUITY_REASON_SEEK) reportState()
    }

    override fun onPlayerError(error: PlaybackException) {
      sendError(error.message ?: COULD_NOT_PLAY)
    }
  }

  override fun definition() = ModuleDefinition {
    Name("RavenAudio")
    Events(AUDIO_EVENT)

    // While the module lives, Android Auto's requests reach JS through it.
    OnCreate {
      RavenBrowse.ask = { requestId, parentId ->
        sendEvent(AUDIO_EVENT, mapOf("type" to AudioEventTypes.BROWSE, "requestId" to requestId, "parentId" to parentId))
      }
      RavenBrowse.play = { id -> sendEvent(AUDIO_EVENT, mapOf("type" to AudioEventTypes.PLAY_FROM_BROWSE, "id" to id)) }
    }

    OnDestroy {
      RavenBrowse.ask = null
      RavenBrowse.play = null
      letGo()
    }

    AsyncFunction("setWindow") { items: List<AudioItem>, shouldPlay: Boolean, start: Double, promise: Promise ->
      val tracks = items.map { it.toTrack() }
      withService(promise, shouldBind = true) { service -> replaceWindow(service, tracks, shouldPlay, start) }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("setNext") { items: List<AudioItem>, promise: Promise ->
      val tracks = items.map { it.toTrack() }
      withService(promise) { service -> replaceNext(service, tracks) }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("play") { promise: Promise ->
      withService(promise, action = ::resume)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("pause") { promise: Promise ->
      withService(promise) { service -> service.player.pause() }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("seekTo") { seconds: Double, promise: Promise ->
      withService(promise) { service -> service.player.seekTo((seconds * 1000).toLong()) }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("setVolume") { level: Double, promise: Promise ->
      volume = level.toFloat()
      withService(promise) { service -> service.player.volume = volume }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("setRate") { rate: Double, promise: Promise ->
      // ExoPlayer stretches time and keeps a voice's pitch, as an audiobook's speed needs.
      playbackRate = rate.toFloat()
      withService(promise) { service -> service.player.setPlaybackSpeed(playbackRate) }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("answerBrowse") { requestId: String, nodes: List<BrowseNodeRecord>, artworkHeaders: Map<String, String> ->
      RavenBrowse.answer(requestId, BrowseAnswer(nodes.map { it.toNode() }, artworkHeaders))
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("stop") { promise: Promise ->
      withService(promise) { service ->
        isStopped = true
        window.close()
        ticker.removeCallbacks(tick)
        service.player.stop()
        service.player.clearMediaItems()
      }
    }.runOnQueue(Queues.MAIN)
  }

  // The service

  /**
   * Applies `action` on the service and only then settles `promise`, so the app's calls take
   * effect in the order it made them even while the service is still starting. Only a window
   * (`shouldBind`) starts the service; any other call before one has nothing to act on.
   */
  private fun withService(promise: Promise, shouldBind: Boolean = false, action: (RavenAudioService) -> Unit) {
    val pending = Pending<RavenAudioService>(
      run = { service ->
        action(service)
        promise.resolve(null)
      },
      drop = {
        if (shouldBind) promise.reject(PLAYER_UNAVAILABLE, COULD_NOT_START, null) else promise.resolve(null)
      },
      fail = { error -> promise.reject(PLAYER_UNAVAILABLE, error.message ?: COULD_NOT_PLAY, error) },
    )
    if (gate.submit(pending, shouldBind)) bindService()
  }

  private fun bindService() {
    RavenAudioService.observe(observer)
    // A service another controller started (a car, later) is used as it is.
    RavenAudioService.running?.let(::connected)
    val context = appContext.reactContext
    if (context == null) {
      gate.fail()
      return
    }
    val token = SessionToken(context, ComponentName(context, RavenAudioService::class.java))
    val future = MediaController.Builder(context, token)
      .setListener(object : MediaController.Listener {
        override fun onDisconnected(controller: MediaController) {
          attached?.let(::serviceGone)
        }
      })
      .buildAsync()
    controller = future
    // The future completes on the main looper, so its listener runs there too.
    future.addListener(
      {
        if (controller === future && runCatching { future.get() }.isFailure) {
          controller = null
          gate.fail()
        }
      },
      MoreExecutors.directExecutor(),
    )
  }

  private fun connected(service: RavenAudioService) {
    if (service === attached) return
    attached = service
    service.player.addListener(listener)
    service.player.volume = volume
    service.player.setPlaybackSpeed(playbackRate)
    service.onRemote = { command ->
      if (!isStopped) sendEvent(AUDIO_EVENT, mapOf("type" to AudioEventTypes.REMOTE, "command" to command))
    }
    gate.attach(service)
  }

  /** The service was destroyed: its player is gone, so the next window binds a new one. */
  private fun serviceGone(service: RavenAudioService) {
    if (service !== attached) return
    ticker.removeCallbacks(tick)
    service.player.removeListener(listener)
    service.onRemote = null
    attached = null
    isStopped = true
    window.close()
    gate.detach()
    controller?.let(MediaController::releaseFuture)
    controller = null
  }

  // The window

  private fun replaceWindow(service: RavenAudioService, tracks: List<AudioTrack>, shouldPlay: Boolean, start: Double) {
    val playing = service.player
    val opened = window.open(tracks)
    if (opened.isEmpty()) {
      sendError(COULD_NOT_OPEN)
      return
    }
    isStopped = false
    // ExoPlayer opens the first item at `start` itself, so its position is right from the start.
    playing.setMediaSources(opened.map(service::sourceOf), 0, (maxOf(0.0, start) * 1000).toLong())
    playing.prepare()
    playing.playWhenReady = shouldPlay
    reportState()
  }

  /** Plays the window it holds; with none, there is nothing to play. */
  private fun resume(service: RavenAudioService) {
    if (window.current == null) return
    val playing = service.player
    isStopped = false
    // A failed item leaves the player idle, and only a prepare lets it try again.
    if (playing.playbackState == Player.STATE_IDLE) playing.prepare()
    playing.play()
  }

  private fun replaceNext(service: RavenAudioService, next: List<AudioTrack>) {
    val playing = service.player
    val added = window.replaceNext(next) ?: return
    val after = playing.currentMediaItemIndex + 1
    if (after < playing.mediaItemCount) playing.removeMediaItems(after, playing.mediaItemCount)
    playing.addMediaSources(added.map(service::sourceOf))
  }

  private fun apply(step: WindowStep) {
    val playing = player ?: return
    if (step.shouldDropFinished && playing.currentMediaItemIndex > 0) {
      playing.removeMediaItems(0, playing.currentMediaItemIndex)
    }
    if (step.shouldPause) playing.pause()
    step.events.forEach { type -> sendEvent(AUDIO_EVENT, mapOf("type" to type)) }
  }

  // What the player reports

  private fun reportState() {
    val playing = player ?: return
    if (isStopped || window.current == null) return
    val playerDuration = playing.duration.takeIf { it != C.TIME_UNSET }?.let(::secondsOf)
    val isAsked = playing.playWhenReady && playing.playbackSuppressionReason == Player.PLAYBACK_SUPPRESSION_REASON_NONE
    sendEvent(
      AUDIO_EVENT,
      mapOf(
        "type" to AudioEventTypes.STATE,
        "position" to secondsOf(maxOf(0L, playing.currentPosition)),
        "duration" to window.durationOf(playerSeconds = playerDuration),
        // As AVPlayer's rate: asked to play, buffering included, until it ends or fails.
        "isPlaying" to (isAsked && playing.playbackState != Player.STATE_ENDED && playing.playbackState != Player.STATE_IDLE),
        "isBuffering" to (isAsked && playing.playbackState == Player.STATE_BUFFERING),
      ),
    )
  }

  private fun sendError(message: String) {
    sendEvent(AUDIO_EVENT, mapOf("type" to AudioEventTypes.ERROR, "message" to message))
  }

  private fun letGo() {
    RavenAudioService.forget(observer)
    gate.fail()
    attached?.let { service ->
      service.player.stop()
      service.player.clearMediaItems()
      serviceGone(service)
    }
    controller?.let(MediaController::releaseFuture)
    controller = null
  }
}
