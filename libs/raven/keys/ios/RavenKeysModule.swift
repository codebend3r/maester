import ExpoModulesCore
import UIKit

/// The one event the module emits: a key the player asked for went down.
private let keyEvent = "onKeyDown"

/// UIKit names the arrows, Escape, Home and End by private characters; the app speaks the
/// web's `KeyboardEvent.key` names, so each is mapped both ways.
private let namedInputs: [String: String] = [
  "ArrowUp": UIKeyCommand.inputUpArrow,
  "ArrowDown": UIKeyCommand.inputDownArrow,
  "ArrowLeft": UIKeyCommand.inputLeftArrow,
  "ArrowRight": UIKeyCommand.inputRightArrow,
  "Escape": UIKeyCommand.inputEscape,
  "Home": UIKeyCommand.inputHome,
  "End": UIKeyCommand.inputEnd,
]

private let namedKeys: [String: String] = Dictionary(
  uniqueKeysWithValues: namedInputs.map { ($0.value, $0.key) })

/// Hands each key command's press to whoever listens, since a responder's action method cannot
/// reach the module instance.
final class RavenKeyRelay {
  static let shared = RavenKeyRelay()
  var onPress: ((UIKeyCommand) -> Void)?
}

extension UIResponder {
  /// Every responder answers the player's key commands, so the first responder, whichever
  /// view it is, hands the press on; UIKit calls this on the chain's first responder that has it.
  @objc func ravenKeyCommandPressed(_ command: UIKeyCommand) {
    RavenKeyRelay.shared.onPress?(command)
  }
}

/// The hardware keyboard's keys the player answers, while it asks for them: each is a
/// `UIKeyCommand` on the window's root view controller, so a press anywhere in the app reaches it,
/// with priority over the system's own use of the arrows and Space. A shifted symbol is taken
/// with Shift held too, since UIKit matches a key command's modifiers exactly.
public final class RavenKeysModule: Module {
  private var commands: [UIKeyCommand] = []
  private weak var host: UIViewController?

  public func definition() -> ModuleDefinition {
    Name("RavenKeys")
    Events(keyEvent)

    AsyncFunction("start") { (keys: [String]) in
      self.install(keys)
    }.runOnQueue(.main)

    AsyncFunction("stop") {
      self.remove()
    }.runOnQueue(.main)

    OnDestroy {
      DispatchQueue.main.async { self.remove() }
    }
  }

  private func install(_ keys: [String]) {
    remove()
    guard let root = rootViewController() else { return }
    RavenKeyRelay.shared.onPress = { [weak self] command in self?.pressed(command) }
    commands = keys.flatMap { key -> [UIKeyCommand] in
      let named = namedInputs[key]
      let input = named ?? key
      let flags: [UIKeyModifierFlags] = named == nil ? [[], .shift] : [[]]
      return flags.map { flag in
        let command = UIKeyCommand(
          input: input, modifierFlags: flag, action: #selector(UIResponder.ravenKeyCommandPressed(_:)))
        command.wantsPriorityOverSystemBehavior = true
        return command
      }
    }
    commands.forEach { root.addKeyCommand($0) }
    host = root
  }

  private func remove() {
    commands.forEach { host?.removeKeyCommand($0) }
    commands = []
    host = nil
    RavenKeyRelay.shared.onPress = nil
  }

  private func pressed(_ command: UIKeyCommand) {
    guard let input = command.input else { return }
    sendEvent(
      keyEvent,
      [
        "key": namedKeys[input] ?? input,
        "isShift": command.modifierFlags.contains(.shift),
        "isMeta": command.modifierFlags.contains(.command),
      ])
  }

  private func rootViewController() -> UIViewController? {
    let windows = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap { $0.windows }
    return (windows.first { $0.isKeyWindow } ?? windows.first)?.rootViewController
  }
}
