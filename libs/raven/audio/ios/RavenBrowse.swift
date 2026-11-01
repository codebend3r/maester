import Foundation

/// One entry of CarPlay's lists: see `BrowseNode` in `src/contract.ts`.
struct BrowseNode: Codable, Equatable {
  let id: String
  let title: String
  let subtitle: String?
  let artworkUri: String?
  let isPlayable: Bool
}

/// The app's answer to one request: the nodes, and the headers each http cover is fetched with.
struct BrowseAnswer {
  let nodes: [BrowseNode]
  let artworkHeaders: [String: String]
}

/// The browse tree's top, as `BROWSE_ROOTS` names it on the JS side.
enum BrowseRoots {
  static let home = "root"
  static let albums = "albums"
  static let playlists = "playlists"
  static let downloads = "downloads"
}

/// How long the app has to answer before the car is answered from the cache.
private let browseWait: TimeInterval = 3

/// What the car shows when the app has never answered: the app's own copy, as it cannot ask JS.
private let openAppCopy = "Open Wren on your phone"

let openAppNode = BrowseNode(id: "open-app", title: openAppCopy, subtitle: nil, artworkUri: nil, isPlayable: false)

private let cachePrefix = "raven.browse."

/// How many timed out requests a late answer may still land on.
private let lateKept = 32

/// Ruling 10's bridge, as `BrowseBridge.kt` is on Android: the car's request goes to the app,
/// whose answer is delivered and kept per parent in `UserDefaults`, as JSON; with no answer in
/// three seconds (the app not yet running), or no app to ask, the last answer is shown, and with
/// none one node asks the listener to open the app. A late answer is kept and announced, so the
/// car can show it. Headers are never kept: they carry the account's token. Main thread only.
final class RavenBrowse {
  static let shared = RavenBrowse(defaults: .standard)

  /// Set by the module while it lives: how to ask JS for a parent's children, and to play a node.
  var ask: ((_ requestId: String, _ parentId: String) -> Void)?
  var play: ((_ id: String) -> Void)?
  /// Set by CarPlay while it shows: a parent whose answer came after its wait.
  var onLateAnswer: ((_ parentId: String) -> Void)?

  private let defaults: UserDefaults
  private var waiting: [String: (parentId: String, deliver: (BrowseAnswer) -> Void, timeout: DispatchWorkItem)] = [:]
  private var late: [(requestId: String, parentId: String)] = []

  init(defaults: UserDefaults) {
    self.defaults = defaults
  }

  func children(of parentId: String, deliver: @escaping (BrowseAnswer) -> Void) {
    guard let ask else {
      deliver(fallback(for: parentId))
      return
    }
    let requestId = UUID().uuidString
    let timeout = DispatchWorkItem { [weak self] in self?.timedOut(requestId) }
    waiting[requestId] = (parentId, deliver, timeout)
    DispatchQueue.main.asyncAfter(deadline: .now() + browseWait, execute: timeout)
    ask(requestId, parentId)
  }

  func answer(requestId: String, answer: BrowseAnswer) {
    if let asked = waiting.removeValue(forKey: requestId) {
      asked.timeout.cancel()
      keep(answer.nodes, for: asked.parentId)
      asked.deliver(answer)
      return
    }
    guard let place = late.firstIndex(where: { $0.requestId == requestId }) else { return }
    let parentId = late.remove(at: place).parentId
    keep(answer.nodes, for: parentId)
    onLateAnswer?(parentId)
  }

  /// Forgets every list kept: another account's titles must never show in the car.
  func clear() {
    defaults.dictionaryRepresentation().keys
      .filter { $0.hasPrefix(cachePrefix) }
      .forEach(defaults.removeObject(forKey:))
  }

  private func timedOut(_ requestId: String) {
    guard let asked = waiting.removeValue(forKey: requestId) else { return }
    late = Array((late + [(requestId, asked.parentId)]).suffix(lateKept))
    asked.deliver(fallback(for: asked.parentId))
  }

  private func keep(_ nodes: [BrowseNode], for parentId: String) {
    guard let saved = try? JSONEncoder().encode(nodes) else { return }
    defaults.set(saved, forKey: cachePrefix + parentId)
  }

  private func fallback(for parentId: String) -> BrowseAnswer {
    let cached = defaults.data(forKey: cachePrefix + parentId)
      .flatMap { try? JSONDecoder().decode([BrowseNode].self, from: $0) }
    return BrowseAnswer(nodes: cached ?? [openAppNode], artworkHeaders: [:])
  }
}
