import XCTest

/// raven on the Apple TV, driven only by the Siri Remote and the platform's keyboard, against
/// `@raven/server`'s `serve:fixture` on the loopback. It drives the build installed on the
/// simulator (Release, development variant), so it names the app by its bundle id.
final class RemoteFlowTests: XCTestCase {
  /// The fixture server's address and secrets, as `serve:fixture` prints them.
  private enum Fixture {
    static let address = "http://127.0.0.1:8490"
    static let pin = "1357"
    static let adminPassword = "Raven-Admin-2026"
    static let film = "Kestrel Point"
  }

  private enum Copy {
    static let play = "Play"
    static let continueWatching = "Continue watching"
    static let resume = "Resume from"
    static let markWatched = "Mark watched"
    static let watched = "Watched"
    static let keyboardGo = "go"
  }

  private let app = XCUIApplication(bundleIdentifier: "io.github.codebend3r.raven.app")
  private let remote = XCUIRemote.shared

  override func setUp() {
    continueAfterFailure = false
  }

  /// Signs in, plays the film from Home, leaves with Menu, finds it under Continue watching with
  /// the focus back on the card it was opened from, then leaves the app with Menu on Home.
  func testPlaysFromHomeAndMenuComesBack() throws {
    app.launch()
    signIn()

    XCTAssertTrue(waitForFocus(timeout: 60) { $0 == Fixture.film }, "Home opens on the film")
    XCTAssertFalse(app.staticTexts[Copy.continueWatching].exists, "Nothing is being watched yet")

    press(.select)
    XCTAssertTrue(waitForFocus(timeout: 30) { $0 == Copy.play }, "The film's page opens on Play")

    // The film is an MKV, which plays through the server's HLS remux under the system's
    // transport. Twenty seconds in, more than one ten-second save has landed.
    press(.select)
    sleep(20)
    attachScreenshot(named: "playing")

    // Menu leaves the player for the page, which offers to resume where it stopped.
    press(.menu)
    XCTAssertTrue(
      waitForFocus(timeout: 30) { $0.hasPrefix(Copy.resume) },
      "Menu leaves the player for the film's page, with the spot saved"
    )

    // Menu again goes back to Home, now with the film under Continue watching, and the focus
    // on the card the page was opened from, not on the new first card.
    press(.menu)
    XCTAssertTrue(app.staticTexts[Copy.continueWatching].waitForExistence(timeout: 30))
    XCTAssertTrue(waitForFocus(timeout: 10) { $0 == Fixture.film })
    let cards = app.buttons.matching(NSPredicate(format: "label == %@", Fixture.film))
      .allElementsBoundByIndex
    XCTAssertEqual(cards.count, 2, "The film sits under Continue watching and on its own shelf")
    let continuing = cards.min { $0.frame.minY < $1.frame.minY }
    let focused = focusedElement()
    XCTAssertNotNil(continuing)
    XCTAssertGreaterThan(
      focused.frame.minY,
      continuing?.frame.minY ?? .infinity,
      "Focus is back on the card the film was opened from, below Continue watching"
    )
    attachScreenshot(named: "back-on-home")

    // On Home, Menu is tvOS's: the app goes to the background.
    press(.menu)
    XCTAssertTrue(app.wait(for: .runningBackground, timeout: 15), "Menu on Home leaves the app")

    clearTheSpot()
  }

  // MARK: - Steps

  /// The address, then the PIN, then the admin password, each on the platform's keyboard.
  private func signIn() {
    guard app.textFields.firstMatch.waitForExistence(timeout: 60) else { return }
    press(.select)
    sleep(2)
    app.typeText("\(Fixture.address)\n")
    enterSecret(Fixture.pin, isNumberPad: true)
    enterSecret(Fixture.adminPassword, isNumberPad: false)
  }

  private func enterSecret(_ secret: String, isNumberPad: Bool) {
    XCTAssertTrue(app.secureTextFields.firstMatch.waitForExistence(timeout: 30))
    XCTAssertTrue(waitForFocus(timeout: 10) { _ in self.app.secureTextFields.firstMatch.hasFocus })
    press(.select)
    sleep(2)
    app.typeText(secret)
    if isNumberPad {
      // The number pad's go sits under the digits.
      press(.down)
    } else {
      XCTAssertTrue(waitForFocus(pressing: .down, tries: 8) { $0 == Copy.keyboardGo })
    }
    press(.select)
    sleep(3)
  }

  /// Leaves the fixture as it was found: a mark clears the saved spot, and taking it off again
  /// leaves the film never started, so the iPhone flows that follow see what they expect.
  private func clearTheSpot() {
    app.activate()
    XCTAssertTrue(waitForFocus(timeout: 30) { $0 == Fixture.film })
    press(.select)
    XCTAssertTrue(waitForFocus(timeout: 30) { $0.hasPrefix(Copy.resume) })
    XCTAssertTrue(waitForFocus(pressing: .right, tries: 4) { $0 == Copy.markWatched })
    press(.select)
    XCTAssertTrue(waitForFocus(timeout: 15) { $0 == Copy.watched })
    press(.select)
    XCTAssertTrue(waitForFocus(timeout: 15) { $0 == Copy.markWatched })
    XCTAssertTrue(app.buttons[Copy.play].waitForExistence(timeout: 15))
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
