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

/** The one event the module emits; its `type` says which player event it carries. */
private const val AUDIO_EVENT = "onAudioEvent"

/** How often the playing item reports where it is, as iOS's periodic observer does. */
private const val STATE_INTERVAL_MS = 250L

private const val COULD_NOT_OPEN = "Raven could not open this track."
private const val COULD_NOT_PLAY = "Raven could not play this track."

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

    OnDestroy {
      letGo()
    }

    AsyncFunction("setWindow") { items: List<AudioItem>, shouldPlay: Boolean, start: Double ->
      withService { service -> replaceWindow(service, items.map { it.toTrack() }, shouldPlay, start) }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("setNext") { items: List<AudioItem> ->
      replaceNext(items.map { it.toTrack() })
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("play") {
      resume()
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("pause") {
      player?.pause()
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("seekTo") { seconds: Double ->
      player?.seekTo((seconds * 1000).toLong())
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("setVolume") { level: Double ->
      volume = level.toFloat()
      player?.volume = volume
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("setRate") { rate: Double ->
      // ExoPlayer stretches time and keeps a voice's pitch, as an audiobook's speed needs.
      playbackRate = rate.toFloat()
      player?.setPlaybackSpeed(playbackRate)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("stop") {
      isStopped = true
      window.close()
      ticker.removeCallbacks(tick)
      player?.stop()
      player?.clearMediaItems()
    }.runOnQueue(Queues.MAIN)
  }

  // The service

  /** Runs `action` once the service is up, binding it on first use. */
  private fun withService(action: (RavenAudioService) -> Unit) {
    if (controller == null) bindService()
    RavenAudioService.whenRunning { service ->
      if (service !== attached) attach(service)
      action(service)
    }
  }

  private fun bindService() {
    val context = appContext.reactContext ?: return
    val token = SessionToken(context, ComponentName(context, RavenAudioService::class.java))
    controller = MediaController.Builder(context, token).buildAsync()
  }

  private fun attach(service: RavenAudioService) {
    attached = service
    service.player.addListener(listener)
    service.player.volume = volume
    service.player.setPlaybackSpeed(playbackRate)
    service.onRemote = { command ->
      if (!isStopped) sendEvent(AUDIO_EVENT, mapOf("type" to AudioEventTypes.REMOTE, "command" to command))
    }
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
  private fun resume() {
    val playing = player ?: return
    if (window.current == null) return
    isStopped = false
    // A failed item leaves the player idle, and only a prepare lets it try again.
    if (playing.playbackState == Player.STATE_IDLE) playing.prepare()
    playing.play()
  }

  private fun replaceNext(next: List<AudioTrack>) {
    val service = attached ?: return
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
    ticker.removeCallbacks(tick)
    attached?.let { service ->
      service.onRemote = null
      service.player.removeListener(listener)
      service.player.stop()
      service.player.clearMediaItems()
    }
    attached = null
    controller?.let(MediaController::releaseFuture)
    controller = null
  }
}
