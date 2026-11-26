import XCTest

/// Wren on the Apple TV, driven only by the Siri Remote, against `@raven/server`'s
/// `serve:fixture` on the loopback, whose music library holds one album, Morning Chorus by The
/// Fixture Birds. It drives the build installed on the simulator (Release, development
/// variant), so it names the app by its bundle id.
final class WrenRemoteFlowTests: XCTestCase {
  private enum Fixture {
    static let album = "Morning Chorus"
    static let firstTrack = "First Light"
    static let artist = "The Fixture Birds"
  }

  private enum Copy {
    static let shuffleAll = "Shuffle all"
    static let play = "Play"
    static let home = "Home"
    static let library = "Library"
    static let albums = "Albums"
    static let recentlyAdded = "Recently added"
    /// The sidebar's playing row, read as the phone's mini player: "Now Playing: First Light, ...".
    static let nowPlaying = "Now Playing: \(Fixture.firstTrack), \(Fixture.artist)"
  }

  private let app = XCUIApplication(bundleIdentifier: "app.netlify.wren.tv")
  private let remote = XCUIRemote.shared

  override func setUp() {
    continueAfterFailure = false
  }

  /// Home opens with the remote on Shuffle all; Down reaches the album under Recently added,
  /// select opens its page on Play, and Play starts it: Menu back on Home, the sidebar's row
  /// names the first track. Then the sidebar's Library opens Albums, which holds the album.
  func testPlaysTheAlbumFromHomeAndFindsItInLibrary() throws {
    app.launch()

    XCTAssertTrue(
      waitForFocus(timeout: 60) { $0.hasPrefix(Copy.shuffleAll) },
      "Home opens with the remote on Shuffle all"
    )
    XCTAssertTrue(app.staticTexts[Copy.recentlyAdded].exists, "Home lists what was added lately")
    XCTAssertTrue(
      waitForFocus(pressing: .down, tries: 4) { $0.hasPrefix(Fixture.album) },
      "Down goes to the album under Recently added"
    )

    press(.select)
    XCTAssertTrue(waitForFocus(timeout: 30) { $0 == Copy.play }, "The album's page opens on Play")
    press(.select)
    attachScreenshot(named: "playing")

    // Menu goes back to Home, where the sidebar's foot names the track playing.
    press(.menu)
    XCTAssertTrue(
      app.buttons[Copy.nowPlaying].waitForExistence(timeout: 30),
      "The sidebar names the album's first track as playing"
    )
    // The remote's play and pause key pauses the music wherever the focus is.
    press(.playPause)

    // Left reaches the sidebar; Down along it to Library, which opens on Albums.
    XCTAssertTrue(
      waitForFocus(pressing: .left, tries: 4) { $0 == Copy.shuffleAll || $0 == Copy.home },
      "Left reaches the sidebar"
    )
    XCTAssertTrue(
      waitForFocus(pressing: .down, tries: 4) { $0 == Copy.library },
      "Down along the sidebar reaches Library"
    )
    press(.select)
    XCTAssertTrue(
      waitForFocus(timeout: 30) { $0.hasPrefix(Copy.albums) },
      "Library opens with the remote on Albums"
    )
    press(.select)
    XCTAssertTrue(
      app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", Fixture.album)).firstMatch
        .waitForExistence(timeout: 30),
      "Albums holds the fixture's album"
    )
    attachScreenshot(named: "albums")
  }

  // MARK: - The remote and the focus

  private func press(_ button: XCUIRemote.Button) {
    remote.press(button)
    usleep(800_000)
  }

  private func focusedElement() -> XCUIElement {
    app.descendants(matching: .any).element(matching: NSPredicate(format: "hasFocus == true"))
  }

  /// The focused element's label, or nothing while nothing in the app has the focus.
  private func focusedLabel() -> String? {
    let element = focusedElement()
    return element.exists ? element.label : nil
  }

  /// Waits until the focused element's label passes `check`.
  private func waitForFocus(timeout: TimeInterval, _ check: @escaping (String) -> Bool) -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
      if let label = focusedLabel(), check(label) { return true }
      usleep(500_000)
    }
    print("Focus was on \(focusedLabel() ?? "nothing")")
    return false
  }

  /// Presses `button` until the focused element's label passes `check`, at most `tries` times.
  private func waitForFocus(
    pressing button: XCUIRemote.Button,
    tries: Int,
    _ check: @escaping (String) -> Bool
  ) -> Bool {
    (0...tries).contains { attempt in
      if let label = focusedLabel(), check(label) { return true }
      if attempt < tries { press(button) }
      return false
    }
  }

  private func attachScreenshot(named name: String) {
    let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }
}
