package expo.modules.ravenaudio

/** One track as the app hands it over: see `AudioItem` in `src/contract.ts`. */
data class AudioTrack(
  val id: Int,
  val uri: String,
  val headers: Map<String, String>,
  val title: String,
  val artist: String,
  val album: String,
  val artworkUri: String?,
  val duration: Double?,
) {
  /** The id the player and the session know the track by. */
  val mediaId: String
    get() = id.toString()
}

/** The `type` of each event the module sends, as `AUDIO_PLAYER_EVENTS` in `src/contract.ts` names them. */
object AudioEventTypes {
  const val STATE = "state"
  const val ADVANCED = "advanced"
  const val ENDED = "ended"
  const val ERROR = "error"
  const val REMOTE = "remote"
}

/** What the player does after the window moved: the events to send, and what to change. */
data class WindowStep(
  val events: List<String>,
  /** The player still holds the item it just finished, ahead of the one now playing. */
  val shouldDropFinished: Boolean,
  val shouldPause: Boolean,
)

private val NOTHING = WindowStep(events = emptyList(), shouldDropFinished = false, shouldPause = false)

/**
 * The playing track and the ones after it, as the player should hold them, kept apart from
 * Media3 so its rules run on the JVM. The playing track is always first: an item the player
 * finished is dropped as it moves on, as `AVQueuePlayer` drops it on iOS.
 */
class AudioWindow {
  var tracks: List<AudioTrack> = emptyList()
    private set

  val current: AudioTrack?
    get() = tracks.firstOrNull()

  /** Takes a new window, in play order, and hands back the tracks the player can open. */
  fun open(window: List<AudioTrack>): List<AudioTrack> {
    tracks = window.filter(::canOpen)
    return tracks
  }

  /**
   * Keeps the playing track and puts `next` after it, handing back what the player adds, or
   * null when nothing plays and so nothing changes.
   */
  fun replaceNext(next: List<AudioTrack>): List<AudioTrack>? {
    val playing = current ?: return null
    val opened = next.filter(::canOpen)
    tracks = listOf(playing) + opened
    return opened
  }

  /**
   * The player moved to another item. Only a move it made by itself, at the end of a track,
   * is the app's `advanced`; any other came from the app replacing the window.
   */
  fun transitioned(isAutomatic: Boolean): WindowStep {
    if (!isAutomatic || tracks.size < 2) return NOTHING
    tracks = tracks.drop(1)
    return WindowStep(events = listOf(AudioEventTypes.ADVANCED), shouldDropFinished = true, shouldPause = false)
  }

  /** The playing track ended with nothing after it: the app hears `ended`, and the player pauses. */
  fun ended(): WindowStep {
    if (tracks.isEmpty()) return NOTHING
    tracks = emptyList()
    return WindowStep(events = listOf(AudioEventTypes.ENDED), shouldDropFinished = false, shouldPause = true)
  }

  fun close() {
    tracks = emptyList()
  }

  /** The server's length wins: a decoder may round a FLAC's up to whole blocks. */
  fun durationOf(playerSeconds: Double?): Double? = current?.duration ?: playerSeconds

  private fun canOpen(track: AudioTrack) = track.uri.isNotBlank()
}
