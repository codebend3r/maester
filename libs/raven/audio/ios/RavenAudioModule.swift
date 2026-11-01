import AVFoundation
import ExpoModulesCore
import MediaPlayer

/// One track as the app hands it over: see `AudioItem` in `src/index.ts`.
struct AudioItem: Record {
  @Field var id: Int = 0
  @Field var uri: String = ""
  @Field var headers: [String: String] = [:]
  @Field var title: String = ""
  @Field var artist: String = ""
  @Field var album: String = ""
  @Field var artworkUri: String? = nil
  @Field var duration: Double? = nil
}

/// The one event the module emits; its `type` says which player event it carries.
private let audioEvent = "onAudioEvent"

/// `AVQueuePlayer` holding the playing track and the one after it, so the seam plays with no gap
/// while the app is in the background, with Now Playing and the remote commands beside it.
public final class RavenAudioModule: Module {
  private let player = AVQueuePlayer()
  private var items: [(item: AudioItem, player: AVPlayerItem)] = []
  private var timeObserver: Any?
  private var endObserver: NSObjectProtocol?
  private var statusObservation: NSKeyValueObservation?
  private var rateObservation: NSKeyValueObservation?
  private var interruptionObserver: NSObjectProtocol?
  private var remoteTargets: [(MPRemoteCommand, Any)] = []
  private var artwork: (id: Int, image: MPMediaItemArtwork)?
  private var artworkAsked: Int?
  private var isStopped = true
  private var wasPlayingBeforeInterruption = false
  /// How fast every item plays, 1 as recorded. `AVQueuePlayer` keeps a rate set while it plays
  /// across the items it advances to, but `play()` alone would start again at 1, so every start
  /// goes through `startPlaying()`.
  private var playbackRate: Float = 1
  /// Where a window opened at a saved spot starts, until its seek lands, so the state events
  /// before it report that spot rather than 0. The seek waits for the item to be ready to play
  /// (`watchCurrentItem`): a seek with a completion handler before then raises an exception.
  private var pendingStart: Double?

  public func definition() -> ModuleDefinition {
    Name("RavenAudio")
    Events(audioEvent)

    // The remote commands are taken on the first window, not here: a film playing in the app's
    // own player must not hear the lock screen's Play.
    OnCreate {
      self.player.actionAtItemEnd = .advance
      self.observePlayer()
    }

    OnDestroy {
      self.letGo()
    }

    AsyncFunction("setWindow") { (items: [AudioItem], shouldPlay: Bool, start: Double) in
      try self.activateSession()
      if self.remoteTargets.isEmpty { self.takeRemoteCommands() }
      self.replaceWindow(with: items, shouldPlay: shouldPlay, start: start)
    }.runOnQueue(.main)

    AsyncFunction("setNext") { (items: [AudioItem]) in
      self.replaceNext(with: items)
    }.runOnQueue(.main)

    AsyncFunction("play") {
      try self.activateSession()
      self.isStopped = false
      self.startPlaying()
      self.showNowPlaying()
    }.runOnQueue(.main)

    AsyncFunction("pause") {
      self.player.pause()
      self.showNowPlaying()
    }.runOnQueue(.main)

    AsyncFunction("seekTo") { (seconds: Double) in
      let time = CMTime(seconds: seconds, preferredTimescale: 600)
      self.player.seek(to: time, toleranceBefore: .zero, toleranceAfter: .zero) { _ in
        self.showNowPlaying()
        self.reportState()
      }
    }.runOnQueue(.main)

    AsyncFunction("setVolume") { (volume: Double) in
      self.player.volume = Float(volume)
    }.runOnQueue(.main)

    AsyncFunction("setRate") { (rate: Double) in
      self.playbackRate = Float(rate)
      if #available(iOS 16.0, tvOS 16.0, *) {
        self.player.defaultRate = self.playbackRate
      }
      // A rate set while paused would start the player, so a paused one takes it on its next play.
      if self.player.rate > 0 { self.player.rate = self.playbackRate }
      self.showNowPlaying()
    }.runOnQueue(.main)

    AsyncFunction("stop") {
      self.isStopped = true
      self.pendingStart = nil
      self.player.pause()
      self.player.removeAllItems()
      self.items = []
      self.artwork = nil
      self.artworkAsked = nil
      self.releaseRemoteCommands()
      MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
      MPNowPlayingInfoCenter.default().playbackState = .stopped
      try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }.runOnQueue(.main)
  }

  // MARK: The window

  private func playerItem(for item: AudioItem) -> AVPlayerItem? {
    guard let url = URL(string: item.uri) else { return nil }
    // An undocumented key AVFoundation applies to every request the asset makes.
    let asset = AVURLAsset(url: url, options: ["AVURLAssetHTTPHeaderFieldsKey": item.headers])
    let made = AVPlayerItem(asset: asset)
    // Keeps a voice's pitch at any rate, as an audiobook's speed needs; at 1 it changes nothing.
    made.audioTimePitchAlgorithm = .timeDomain
    return made
  }

  /// Plays at the rate asked for: `defaultRate` where the system has it, else the rate itself,
  /// which starts the player as `play()` does.
  private func startPlaying() {
    if #available(iOS 16.0, tvOS 16.0, *) {
      player.defaultRate = playbackRate
      player.play()
    } else {
      player.rate = playbackRate
    }
  }

  private func replaceWindow(with window: [AudioItem], shouldPlay: Bool, start: Double) {
    // Do not feed the replacement's temporary pause back into the host's play/pause commands.
    isStopped = true
    player.pause()
    player.removeAllItems()
    items = window.compactMap { item in
      guard let made = playerItem(for: item) else { return nil }
      return (item, made)
    }
    guard !items.isEmpty else {
      sendError("Raven could not open this track.")
      return
    }
    items.forEach { player.insert($0.player, after: nil) }
    // An audiobook opens at its saved spot, sought once the item is ready to play.
    pendingStart = start > 0 ? start : nil
    watchCurrentItem()
    isStopped = false
    if shouldPlay { startPlaying() }
    showNowPlaying()
  }

  private func replaceNext(with next: [AudioItem]) {
    guard let current = player.currentItem else { return }
    player.items().filter { $0 !== current }.forEach { player.remove($0) }
    items = items.filter { $0.player === current }
    next.forEach { item in
      guard let made = playerItem(for: item) else { return }
      items.append((item, made))
      player.insert(made, after: nil)
    }
  }

  private var currentAudioItem: AudioItem? {
    guard let current = player.currentItem else { return nil }
    return items.first { $0.player === current }?.item
  }

  // MARK: What the player reports

  private func observePlayer() {
    timeObserver = player.addPeriodicTimeObserver(
      forInterval: CMTime(seconds: 0.25, preferredTimescale: 600), queue: .main
    ) { [weak self] _ in
      self?.reportState()
    }
    rateObservation = player.observe(\.rate, options: [.new]) { [weak self] _, _ in
      self?.reportState()
      self?.showNowPlaying()
    }
    endObserver = NotificationCenter.default.addObserver(
      forName: .AVPlayerItemDidPlayToEndTime, object: nil, queue: .main
    ) { [weak self] notification in
      self?.itemEnded(notification.object as? AVPlayerItem)
    }
    interruptionObserver = NotificationCenter.default.addObserver(
      forName: AVAudioSession.interruptionNotification, object: nil, queue: .main
    ) { [weak self] notification in
      self?.interrupted(notification)
    }
  }

  /// A call or an alarm pauses the player; once it is over, music the call cut off plays on.
  private func interrupted(_ notification: Notification) {
    guard
      let raw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
      let kind = AVAudioSession.InterruptionType(rawValue: raw)
    else { return }
    switch kind {
    case .began:
      wasPlayingBeforeInterruption = player.rate > 0
    case .ended:
      let options = (notification.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt)
        .map(AVAudioSession.InterruptionOptions.init(rawValue:)) ?? []
      guard !isStopped, wasPlayingBeforeInterruption, options.contains(.shouldResume) else { return }
      wasPlayingBeforeInterruption = false
      try? activateSession()
      startPlaying()
    @unknown default:
      return
    }
  }

  private func watchCurrentItem() {
    statusObservation = player.observe(\.currentItem?.status, options: [.initial, .new]) { [weak self] player, _ in
      guard let self, let item = player.currentItem else { return }
      switch item.status {
      case .failed:
        let message = item.error?.localizedDescription ?? "Raven could not play this track."
        self.sendError(message)
      case .readyToPlay:
        self.seekToPendingStart(of: item)
      default:
        return
      }
    }
  }

  /// Takes a window opened at a saved spot there, once its first item can play. A seek a newer
  /// window cut short leaves that window's spot alone.
  private func seekToPendingStart(of item: AVPlayerItem) {
    guard let start = pendingStart else { return }
    item.seek(
      to: CMTime(seconds: start, preferredTimescale: 600), toleranceBefore: .zero,
      toleranceAfter: .zero
    ) { [weak self] _ in
      DispatchQueue.main.async {
        guard let self, self.player.currentItem === item else { return }
        self.pendingStart = nil
        self.reportState()
        self.showNowPlaying()
      }
    }
  }

  /// The item-end event can fire before `AVQueuePlayer` drops the finished item, so what played
  /// is judged by the item named, not by `currentItem`.
  private func itemEnded(_ ended: AVPlayerItem?) {
    guard !isStopped, let ended, let place = items.firstIndex(where: { $0.player === ended }) else { return }
    let wasLast = place == items.count - 1
    items.remove(at: place)
    if wasLast {
      player.pause()
      sendEvent(audioEvent, ["type": "ended"])
      return
    }
    sendEvent(audioEvent, ["type": "advanced"])
    showNowPlaying()
  }

  /// Where the playing item is: the saved spot a window opened at until its seek lands.
  private var position: Double {
    pendingStart ?? max(0, player.currentTime().seconds)
  }

  private func reportState() {
    guard !isStopped, let current = player.currentItem else { return }
    let duration = current.duration.isNumeric ? current.duration.seconds : nil
    let known = currentAudioItem?.duration ?? duration
    sendEvent(audioEvent, [
      "type": "state",
      "position": position,
      "duration": known as Any,
      "isPlaying": player.rate > 0,
      "isBuffering": player.timeControlStatus == .waitingToPlayAtSpecifiedRate,
    ])
  }

  private func sendError(_ message: String) {
    sendEvent(audioEvent, ["type": "error", "message": message])
  }

  // MARK: Now Playing and the remote commands

  private func activateSession() throws {
    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.playback, mode: .default)
    try session.setActive(true)
  }

  private func showNowPlaying() {
    guard let item = currentAudioItem else { return }
    var info: [String: Any] = [
      MPMediaItemPropertyTitle: item.title,
      MPMediaItemPropertyArtist: item.artist,
      MPMediaItemPropertyAlbumTitle: item.album,
      MPNowPlayingInfoPropertyElapsedPlaybackTime: position,
      MPNowPlayingInfoPropertyPlaybackRate: Double(player.rate),
      MPNowPlayingInfoPropertyDefaultPlaybackRate: Double(playbackRate),
      MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.audio.rawValue,
    ]
    if let duration = item.duration { info[MPMediaItemPropertyPlaybackDuration] = duration }
    if let artwork, artwork.id == item.id { info[MPMediaItemPropertyArtwork] = artwork.image }
    MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    MPNowPlayingInfoCenter.default().playbackState = player.rate > 0 ? .playing : .paused
    if artwork?.id != item.id, artworkAsked != item.id {
      artworkAsked = item.id
      loadArtwork(for: item)
    }
  }

  /// Fetches the item's cover once and keeps it, so each rate change and seek redraws Now Playing
  /// with the cover it already has. The request carries no headers, so a library unlocked by the
  /// cookie fallback shows no cover here.
  private func loadArtwork(for item: AudioItem) {
    guard let uri = item.artworkUri, let url = URL(string: uri) else { return }
    URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
      guard let data, let image = UIImage(data: data) else { return }
      DispatchQueue.main.async {
        guard let self, self.currentAudioItem?.id == item.id else { return }
        self.artwork = (item.id, MPMediaItemArtwork(boundsSize: image.size) { _ in image })
        self.showNowPlaying()
      }
    }.resume()
  }

  private func takeRemoteCommands() {
    let center = MPRemoteCommandCenter.shared()
    let named: [(MPRemoteCommand, String)] = [
      (center.playCommand, "play"),
      (center.pauseCommand, "pause"),
      (center.togglePlayPauseCommand, "toggle"),
      (center.nextTrackCommand, "next"),
      (center.previousTrackCommand, "previous"),
      (center.stopCommand, "stop"),
    ]
    remoteTargets = named.map { command, name in
      command.isEnabled = true
      let target = command.addTarget { [weak self] _ in
        self?.sendEvent(audioEvent, ["type": "remote", "command": ["kind": name]])
        return .success
      }
      return (command, target)
    }
    center.changePlaybackPositionCommand.isEnabled = true
    let seek = center.changePlaybackPositionCommand.addTarget { [weak self] event in
      guard let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
      self?.sendEvent(audioEvent, ["type": "remote", "command": ["kind": "seek", "time": event.positionTime]])
      return .success
    }
    remoteTargets.append((center.changePlaybackPositionCommand, seek))
  }

  private func releaseRemoteCommands() {
    remoteTargets.forEach { command, target in
      command.removeTarget(target)
      command.isEnabled = false
    }
    remoteTargets = []
  }

  private func letGo() {
    releaseRemoteCommands()
    if let timeObserver { player.removeTimeObserver(timeObserver) }
    if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
    if let interruptionObserver { NotificationCenter.default.removeObserver(interruptionObserver) }
    statusObservation = nil
    rateObservation = nil
    player.pause()
    player.removeAllItems()
    MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
  }
}
