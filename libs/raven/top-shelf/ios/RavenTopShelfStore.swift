import Foundation

/*
 * What the app and its Top Shelf extension share, compiled into both: the module's pod and,
 * copied by `withTvTopShelf`, the extension's target. The app writes `shelf.json` and the
 * pictures into the App Group's container; the extension, a process of its own that cannot ask
 * the app or reach the server, reads them back.
 */

/// The two shelves, the JS contract's `TOP_SHELF_KINDS`: the key a shelf is told apart by.
enum RavenTopShelfKind: String, Codable {
  case signedOut
  case titles
}

/// How a shelf of titles is laid out, the JS contract's `TOP_SHELF_LAYOUTS`.
enum RavenTopShelfLayout: String, Codable {
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

/// A shelf as the JS contract's `TopShelf` writes it, keyed on `kind`, over the item the side reading it holds.
enum RavenTopShelf<Item: Codable>: Codable {
  case signedOut(title: String, openUrl: String)
  case titles(layout: RavenTopShelfLayout, title: String, items: [Item])

  private enum CodingKeys: String, CodingKey {
    case kind, title, openUrl, layout, items
  }

  init(from decoder: Decoder) throws {
    let values = try decoder.container(keyedBy: CodingKeys.self)
    let title = try values.decode(String.self, forKey: .title)
    switch try values.decode(RavenTopShelfKind.self, forKey: .kind) {
    case .signedOut:
      self = .signedOut(title: title, openUrl: try values.decode(String.self, forKey: .openUrl))
    case .titles:
      self = .titles(
        layout: try values.decode(RavenTopShelfLayout.self, forKey: .layout),
        title: title,
        items: try values.decode([Item].self, forKey: .items))
    }
  }

  func encode(to encoder: Encoder) throws {
    var values = encoder.container(keyedBy: CodingKeys.self)
    switch self {
    case let .signedOut(title, openUrl):
      try values.encode(RavenTopShelfKind.signedOut, forKey: .kind)
      try values.encode(title, forKey: .title)
      try values.encode(openUrl, forKey: .openUrl)
    case let .titles(layout, title, items):
      try values.encode(RavenTopShelfKind.titles, forKey: .kind)
      try values.encode(layout, forKey: .layout)
      try values.encode(title, forKey: .title)
      try values.encode(items, forKey: .items)
    }
  }
}

/// The shelf as the extension reads it.
typealias RavenTopShelfStored = RavenTopShelf<RavenTopShelfStoredItem>

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
