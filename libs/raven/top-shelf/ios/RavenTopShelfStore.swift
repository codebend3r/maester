import Foundation

/*
 * What the app and its Top Shelf extension share, compiled into both: the module's pod and,
 * copied by `withTvTopShelf`, the extension's target. The app writes `shelf.json` and the
 * pictures into the App Group's container; the extension, a process of its own that cannot ask
 * the app or reach the server, reads them back.
 */

/// The three shelves, the JS contract's `TOP_SHELF_KINDS`.
enum RavenTopShelfKind: String, Codable {
  case signedOut
  case carousel
  case sectioned
}

/// One title as the extension reads it: its picture is a file beside `shelf.json`.
struct RavenTopShelfStoredItem: Codable {
  let id: String
  let title: String
  let summary: String?
  let file: String
  let playUrl: String?
  let openUrl: String
}

/// The shelf as the extension reads it.
struct RavenTopShelfStored: Codable {
  let kind: RavenTopShelfKind
  let title: String
  let openUrl: String?
  let items: [RavenTopShelfStoredItem]
}

enum RavenTopShelfStore {
  /// The Info.plist key `withTvTopShelf` writes the App Group's id under, in the app and the extension alike.
  static let groupKey = "RavenTopShelfGroup"
  static let shelfFile = "shelf.json"
  private static let folderName = "TopShelf"

  /// The shared folder, or nil in a build without the App Group (an iPhone's, or an unsigned one).
  static func folder() -> URL? {
    guard
      let group = Bundle.main.object(forInfoDictionaryKey: groupKey) as? String,
      let container = FileManager.default.containerURL(
        forSecurityApplicationGroupIdentifier: group)
    else { return nil }
    return container.appendingPathComponent(folderName, isDirectory: true)
  }

  /// The shelf the app last wrote; nil before its first write, which leaves the static Top Shelf image up.
  static func read() -> (shelf: RavenTopShelfStored, folder: URL)? {
    guard
      let folder = folder(),
      let data = try? Data(contentsOf: folder.appendingPathComponent(shelfFile)),
      let shelf = try? JSONDecoder().decode(RavenTopShelfStored.self, from: data)
    else { return nil }
    return (shelf, folder)
  }
}
