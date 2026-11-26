import TVServices

/// The invitation's picture, in the extension's bundle at each scale, copied there by `withTvTopShelf`.
private let signInPictures: [(name: String, scale: TVTopShelfItem.ImageTraits)] = [
  ("RavenTopShelfSignIn", .screenScale1x),
  ("RavenTopShelfSignIn-2x", .screenScale2x),
]
private let pictureType = "png"

/// A deep link as the system opens it; nil for an item with none.
private func action(_ link: String?) -> TVTopShelfAction? {
  link.flatMap { URL(string: $0) }.map { TVTopShelfAction(url: $0) }
}

/// Signed out: one wide picture asking the viewer to sign in, opening the sign-in page.
private func signedOut(_ shelf: RavenTopShelfStored) -> TVTopShelfContent {
  let item = TVTopShelfItem(identifier: RavenTopShelfKind.signedOut.rawValue)
  item.title = shelf.title
  signInPictures.forEach { picture in
    if let url = Bundle.main.url(forResource: picture.name, withExtension: pictureType) {
      item.setImageURL(url, for: picture.scale)
    }
  }
  item.displayAction = action(shelf.openUrl)
  return TVTopShelfInsetContent(items: [item])
}

/// A stored title's words, picture and deep links on the shelf's item, whichever kind it is.
private func dressed<Item: TVTopShelfItem>(
  _ item: Item, as stored: RavenTopShelfStoredItem, in folder: URL
) -> Item {
  item.title = stored.title
  item.setImageURL(folder.appendingPathComponent(stored.file), for: [.screenScale1x, .screenScale2x])
  item.playAction = action(stored.playUrl)
  item.displayAction = action(stored.openUrl)
  return item
}

/// raven's Continue watching: each title full screen behind the tile, with Play and More Info.
private func carousel(_ shelf: RavenTopShelfStored, in folder: URL) -> TVTopShelfContent {
  let items = shelf.items.map { stored -> TVTopShelfCarouselItem in
    let item = dressed(TVTopShelfCarouselItem(identifier: stored.id), as: stored, in: folder)
    item.contextTitle = shelf.title
    item.summary = stored.summary
    return item
  }
  return TVTopShelfCarouselContent(style: .actions, items: items)
}

/// Wren's latest releases: a row of square covers under the shelf's heading.
private func sectioned(_ shelf: RavenTopShelfStored, in folder: URL) -> TVTopShelfContent {
  let items = shelf.items.map { stored -> TVTopShelfSectionedItem in
    let item = dressed(TVTopShelfSectionedItem(identifier: stored.id), as: stored, in: folder)
    item.imageShape = .square
    return item
  }
  let section = TVTopShelfItemCollection(items: items)
  section.title = shelf.title
  return TVTopShelfSectionedContent(sections: [section])
}

/// What the shelf shows; nil (before the app first wrote one, or with nothing on it) leaves the static Top Shelf image up.
private func content() -> TVTopShelfContent? {
  guard let (shelf, folder) = RavenTopShelfStore.read() else { return nil }
  switch shelf.kind {
  case .signedOut:
    return signedOut(shelf)
  case .carousel:
    return shelf.items.isEmpty ? nil : carousel(shelf, in: folder)
  case .sectioned:
    return shelf.items.isEmpty ? nil : sectioned(shelf, in: folder)
  }
}

/// The extension tvOS asks for the app's Top Shelf whenever its tile in the top row takes focus.
final class RavenTopShelfProvider: TVTopShelfContentProvider {
  override func loadTopShelfContent(completionHandler: @escaping (TVTopShelfContent?) -> Void) {
    completionHandler(content())
  }
}
