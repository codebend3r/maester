import CryptoKit
import ExpoModulesCore
import Foundation

#if os(tvOS)
  import TVServices
#endif

/// The shelf as JS hands it over: each picture still on the server, with the headers it needs.
private struct IncomingPicture: Codable {
  let uri: String
  let headers: [String: String]
}

private struct IncomingItem: Codable {
  let id: String
  let title: String
  let summary: String?
  let picture: IncomingPicture
  let playUrl: String?
  let openUrl: String
}

private typealias IncomingShelf = RavenTopShelf<IncomingItem>

/// The picture types the server answers with, by their file's extension; anything else is kept as a JPEG.
private let pictureExtensions = ["image/png": "png", "image/webp": "webp", "image/heic": "heic"]

/// A name safe for a file, from an item's id.
private func fileSafe(_ id: String) -> String {
  String(id.map { $0.isLetter || $0.isNumber ? $0 : "-" })
}

/// The picture's MD5, its first 8 bytes in hex, so a new picture for the same title gets a new file and tvOS never shows the old one it cached.
private func fingerprint(_ data: Data) -> String {
  Insecure.MD5.hash(data: data).prefix(8).map { String(format: "%02x", $0) }.joined()
}

/// Fetches one item's picture into `folder`; nil when it cannot be read, which leaves the item off the shelf.
private func stored(_ item: IncomingItem, in folder: URL) async -> RavenTopShelfStoredItem? {
  guard let url = URL(string: item.picture.uri) else { return nil }
  var request = URLRequest(url: url)
  item.picture.headers.forEach { name, value in request.setValue(value, forHTTPHeaderField: name) }
  guard
    let (data, response) = try? await URLSession.shared.data(for: request),
    let http = response as? HTTPURLResponse,
    (200..<300).contains(http.statusCode),
    !data.isEmpty
  else { return nil }
  let kind = pictureExtensions[http.mimeType ?? ""] ?? "jpg"
  let file = "\(fileSafe(item.id))-\(fingerprint(data)).\(kind)"
  do {
    try data.write(to: folder.appendingPathComponent(file), options: .atomic)
  } catch {
    return nil
  }
  return RavenTopShelfStoredItem(
    id: item.id, title: item.title, summary: item.summary, file: file,
    playUrl: item.playUrl, openUrl: item.openUrl)
}

/// Every item's picture fetched at once, in the shelf's order.
private func storedItems(_ items: [IncomingItem], in folder: URL) async -> [RavenTopShelfStoredItem] {
  await withTaskGroup(of: (Int, RavenTopShelfStoredItem?).self) { group in
    items.enumerated().forEach { index, item in
      group.addTask { (index, await stored(item, in: folder)) }
    }
    let fetched = await group.reduce(into: [(Int, RavenTopShelfStoredItem)]()) { all, next in
      if let item = next.1 { all.append((next.0, item)) }
    }
    return fetched.sorted { $0.0 < $1.0 }.map { $0.1 }
  }
}

/// Deletes the pictures the new shelf no longer shows.
private func sweep(_ folder: URL, keeping kept: Set<String>) {
  let files = (try? FileManager.default.contentsOfDirectory(atPath: folder.path)) ?? []
  files
    .filter { !kept.contains($0) && $0 != RavenTopShelfStore.shelfFile }
    .forEach { try? FileManager.default.removeItem(at: folder.appendingPathComponent($0)) }
}

/// The shelf as the extension reads it, with each title's picture fetched into `folder`, and the pictures it shows.
private func storedShelf(_ incoming: IncomingShelf, in folder: URL) async -> (
  shelf: RavenTopShelfStored, files: Set<String>
) {
  switch incoming {
  case let .signedOut(title, openUrl):
    return (.signedOut(title: title, openUrl: openUrl), [])
  case let .titles(layout, title, items):
    let kept = await storedItems(items, in: folder)
    return (.titles(layout: layout, title: title, items: kept), Set(kept.map { $0.file }))
  }
}

/// Writes the shelf and its pictures where the extension reads them, then has tvOS load it again.
private func write(_ json: String) async throws {
  guard let folder = RavenTopShelfStore.folder() else { return }
  let incoming = try JSONDecoder().decode(IncomingShelf.self, from: Data(json.utf8))
  try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
  let (shelf, files) = await storedShelf(incoming, in: folder)
  try JSONEncoder().encode(shelf).write(
    to: folder.appendingPathComponent(RavenTopShelfStore.shelfFile), options: .atomic)
  sweep(folder, keeping: files)
  #if os(tvOS)
    TVTopShelfContentProvider.topShelfContentDidChange()
  #endif
}

public class RavenTopShelfModule: Module {
  public func definition() -> ModuleDefinition {
    Name("RavenTopShelf")

    /// An iPhone or iPad has no Top Shelf; there the shelf is dropped.
    AsyncFunction("show") { (json: String) async throws in
      #if os(tvOS)
        try await write(json)
      #endif
    }
  }
}
