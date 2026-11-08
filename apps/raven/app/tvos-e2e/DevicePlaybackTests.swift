import XCTest

/// raven's player on a real Apple TV against the real server, driven by the Siri Remote: every
/// way a viewer starts, stops and moves through a video, each checked by what the screen shows.
/// It opens each video by its link (`raven://play/<id>`), so it needs the app installed, signed
/// in and pointed at a server holding the videos. It runs only when `RAVEN_DEVICE_MEDIA_IDS`
/// names them, comma separated (`TEST_RUNNER_RAVEN_DEVICE_MEDIA_IDS` to `xcodebuild test`), so
/// the fixture run in CI skips it. It moves the account's saved spot for each video.
final class DevicePlaybackTests: XCTestCase {
  private enum Env {
    static let mediaIds = "RAVEN_DEVICE_MEDIA_IDS"
  }

  private enum Copy {
    static let position = "Position"
    /// What the opening mark is called aloud while the video has not yet started.
    static let opening = "Opening the video"
    static let modes = ["Direct play", "Remux", "Transcode"]
  }

  /// Seconds into the video the resume runs start from, past any opening black.
  private static let resumeAt = 600

  /// How long a video may take to show its first picture: a 4K remux on a NAS is slow to start.
  private static let firstPicture: TimeInterval = 90

  /// The controls fade five seconds after a press; this waits them out, so the picture is bare.
  private static let controlsFade: UInt32 = 8

  private let app = XCUIApplication(bundleIdentifier: "io.github.codebend3r.raven.app")
  private let remote = XCUIRemote.shared

  override func setUp() {
    continueAfterFailure = true
    // A link reaches only a running app: bring it up first, as it was left (signed in).
    app.activate()
    XCTAssertTrue(app.wait(for: .runningForeground, timeout: 60), "raven comes to the front")
    sleep(5)
  }

  private func mediaIds() throws -> [String] {
    let named = ProcessInfo.processInfo.environment[Env.mediaIds] ?? ""
    let ids = named.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
      .filter { !$0.isEmpty }
    if ids.isEmpty { throw XCTSkip("\(Env.mediaIds) names no video to play on this device") }
    return ids
  }

  /// From the start: a picture, then pause holds it still, play moves it on, and the remote's
  /// skips move the spot ten seconds either way.
  func testPlaysFromTheStartPausesAndSkips() throws {
    for id in try mediaIds() {
      open(id: id, query: "from=start")
      expectPicture(of: id, step: "from-start")

      press(.playPause)
      sleep(Self.controlsFade)
      let held = screenSample()
      sleep(3)
      XCTAssertEqual(held, screenSample(), "\(id): paused, the picture holds still")
      attach(named: "\(id)-paused")
      press(.playPause)
      sleep(4)
      XCTAssertNotEqual(held, screenSample(), "\(id): playing again, the picture moves on")

      let before = positionSeconds()
      press(.right)
      press(.right)
      sleep(3)
      let ahead = positionSeconds()
      XCTAssertGreaterThanOrEqual(
        (ahead ?? 0) - (before ?? 0), 18,
        "\(id): two skips forward move the spot twenty seconds (\(String(describing: before)) to \(String(describing: ahead)))"
      )
      press(.left)
      sleep(3)
      let back = positionSeconds()
      XCTAssertLessThan(back ?? Double.greatestFiniteMagnitude, (ahead ?? 0) - 5, "\(id): a skip back moves the spot back")
      sleep(Self.controlsFade)
      expectPicture(of: id, step: "after-skips")

      leave()
    }
  }

  /// Played from a spot, left, and opened again: it resumes where it stopped, with its picture,
  /// and starting over from the beginning still shows the picture.
  func testLeavesResumesAndStartsOver() throws {
    for id in try mediaIds() {
      open(id: id, query: "at=\(Self.resumeAt)")
      expectPicture(of: id, step: "opened-at-spot")
      sleep(12)
      leave()

      // No spot asked for: the player starts where the server saved it.
      open(id: id, query: nil)
      expectPicture(of: id, step: "resumed")
      let resumed = positionSeconds()
      XCTAssertGreaterThanOrEqual(
        resumed ?? 0, Double(Self.resumeAt),
        "\(id): it resumes past the spot it was left at (\(String(describing: resumed)))"
      )
      leave()

      open(id: id, query: "from=start")
      expectPicture(of: id, step: "started-over")
      leave()

      // Resumed a second time, from the spot the start over left, as a viewer going back in does.
      open(id: id, query: nil)
      expectPicture(of: id, step: "resumed-again")
      leave()
    }
  }

  // MARK: - Steps

  private func open(id: String, query: String?) {
    let link = query.map { "raven://play/\(id)?\($0)" } ?? "raven://play/\(id)"
    guard let url = URL(string: link) else { return XCTFail("\(link) is no link") }
    // The system opens the link as one from outside the app would; the app's own `open` waits on accessibility it never reports.
    XCUIDevice.shared.system.open(url)
    XCTAssertTrue(app.wait(for: .runningForeground, timeout: 30), "raven opens \(link)")
  }

  /// Menu leaves the player; the spot is saved on the way out.
  private func leave() {
    press(.menu)
    sleep(4)
  }

  /// Waits for the opening mark to go and the clock to run, then checks the screen's middle shows
  /// a picture, recording how the video plays and how long it took.
  private func expectPicture(of id: String, step: String) {
    let opened = Date()
    let opening = app.descendants(matching: .any).matching(
      NSPredicate(format: "label == %@", Copy.opening)
    ).firstMatch
    let deadline = opened.addingTimeInterval(Self.firstPicture)
    while Date() < deadline, opening.exists { sleep(2) }
    let wait = Int(Date().timeIntervalSince(opened))
    let isStillOpening = opening.exists
    let first = positionSeconds()
    sleep(5)
    let later = positionSeconds()
    sleep(Self.controlsFade)
    let lit = litShare()
    press(.down)
    let mode = playingMode() ?? "unknown"
    attach(named: "\(id)-\(step)-\(mode)-\(isStillOpening ? "stuck" : "\(wait)s")")
    XCTAssertFalse(
      isStillOpening,
      "\(id) \(step): still opening \(Int(Self.firstPicture))s after it was asked for (as \(mode))"
    )
    XCTAssertGreaterThan(
      later ?? 0, first ?? .greatestFiniteMagnitude,
      "\(id) \(step): the clock runs (\(String(describing: first)) then \(String(describing: later)), as \(mode))"
    )
    XCTAssertGreaterThan(lit, 0, "\(id) \(step): the picture shows, not a black screen (as \(mode))")
  }

  // MARK: - The remote and the screen

  private func press(_ button: XCUIRemote.Button) {
    remote.press(button)
    usleep(800_000)
  }

  /// How the video plays, as the controls' corner says it, while the controls are up.
  private func playingMode() -> String? {
    let corner = app.otherElements.matching(
      NSPredicate(format: "label CONTAINS %@ OR label CONTAINS %@ OR label CONTAINS %@",
                  Copy.modes[0], Copy.modes[1], Copy.modes[2])
    ).firstMatch
    guard corner.waitForExistence(timeout: 5) else { return nil }
    return Copy.modes.first { corner.label.contains($0) }
  }

  /// Where the scrubber says the video is, in seconds, bringing the controls up to read it.
  private func positionSeconds() -> Double? {
    let line = app.descendants(matching: .any).matching(
      NSPredicate(format: "label == %@", Copy.position)
    ).firstMatch
    // Hidden controls hold no line: any key brings them back, and Up moves nothing along it.
    if !line.exists { press(.up) }
    guard line.waitForExistence(timeout: 5), let value = line.value as? String else { return nil }
    // "1:05:03 of 1:58:56": the spot is the first clock.
    let spot = value.components(separatedBy: " of ").first ?? ""
    return spot.split(separator: ":").reduce(0) { $0 * 60 + (Double($1) ?? 0) }
  }

  /// The screen shrunk to 64 by 36 pixels, as grey levels: enough to compare two moments.
  private func screenSample() -> [UInt8] {
    let width = 64
    let height = 36
    guard let image = XCUIScreen.main.screenshot().image.cgImage else { return [] }
    var grey = [UInt8](repeating: 0, count: width * height)
    let drawn = grey.withUnsafeMutableBytes { bytes -> Bool in
      guard
        let context = CGContext(
          data: bytes.baseAddress, width: width, height: height, bitsPerComponent: 8,
          bytesPerRow: width, space: CGColorSpaceCreateDeviceGray(),
          bitmapInfo: CGImageAlphaInfo.none.rawValue)
      else { return false }
      context.interpolationQuality = .medium
      context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
      return true
    }
    return drawn ? grey : []
  }

  /// How many pixels in the middle of the screen, where no control sits once they fade, are
  /// lit: none on a black screen, many on any picture.
  private func litShare() -> Int {
    let sample = screenSample()
    guard sample.count == 64 * 36 else { return 0 }
    return (9..<27).flatMap { y in (16..<48).map { x in sample[y * 64 + x] } }
      .filter { $0 > 24 }.count
  }

  private func attach(named name: String) {
    let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }
}
