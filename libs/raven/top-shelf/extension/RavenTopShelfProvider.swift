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
private func signedOut(title: String, openUrl: String) -> TVTopShelfContent {
  let item = TVTopShelfItem(identifier: RavenTopShelfKind.signedOut.rawValue)
  item.title = title
  signInPictures.forEach { picture in
    if let url = Bundle.main.url(forResource: picture.name, withExtension: pictureType) {
      item.setImageURL(url, for: picture.scale)
    }
  }
  item.displayAction = action(openUrl)
  return TVTopShelfInsetContent(items: [item])
}

/// A stored title's words, picture and deep links on the shelf's item, whichever layout it is in.
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
private func carousel(title: String, items: [RavenTopShelfStoredItem], in folder: URL)
  -> TVTopShelfContent
{
  let slides = items.map { stored -> TVTopShelfCarouselItem in
    let item = dressed(TVTopShelfCarouselItem(identifier: stored.id), as: stored, in: folder)
    item.contextTitle = title
    item.summary = stored.summary
    return item
  }
  return TVTopShelfCarouselContent(style: .actions, items: slides)
}

/// Wren's latest releases: a row of square covers under the shelf's heading.
private func sectioned(title: String, items: [RavenTopShelfStoredItem], in folder: URL)
  -> TVTopShelfContent
{
  let tiles = items.map { stored -> TVTopShelfSectionedItem in
    let item = dressed(TVTopShelfSectionedItem(identifier: stored.id), as: stored, in: folder)
    item.imageShape = .square
    return item
  }
  let section = TVTopShelfItemCollection(items: tiles)
  section.title = title
  return TVTopShelfSectionedContent(sections: [section])
}

/// What the shelf shows; nil (before the app first wrote one, or with nothing on it) leaves the static Top Shelf image up.
private func content() -> TVTopShelfContent? {
  guard let (shelf, folder) = RavenTopShelfStore.read() else { return nil }
  switch shelf {
  case let .signedOut(title, openUrl):
    return signedOut(title: title, openUrl: openUrl)
  case let .titles(layout, title, items):
    guard !items.isEmpty else { return nil }
    switch layout {
    case .carousel:
      return carousel(title: title, items: items, in: folder)
    case .sectioned:
      return sectioned(title: title, items: items, in: folder)
    }
  }
}

/// The extension tvOS asks for the app's Top Shelf whenever its tile in the top row takes focus.
final class RavenTopShelfProvider: TVTopShelfContentProvider {
  override func loadTopShelfContent(completionHandler: @escaping (TVTopShelfContent?) -> Void) {
    completionHandler(content())
  }
}
