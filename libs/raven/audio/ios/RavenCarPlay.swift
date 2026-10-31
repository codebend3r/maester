#if os(iOS)
import CarPlay
import UIKit

/// The SF Symbol each of the root's folders wears as its tab.
private let tabSymbols = [
  BrowseRoots.albums: "square.stack",
  BrowseRoots.playlists: "music.note.list",
  BrowseRoots.downloads: "arrow.down.circle",
]
private let defaultTabSymbol = "music.note"

/// Wren in CarPlay: a tab for each folder the root lists (Albums, Playlists and Downloads),
/// each a list the browse bridge fills. A playable node plays through the app's queue and shows
/// Now Playing; a folder opens as a list of its own. Declared as the CarPlay scene's delegate by
/// Wren's `withCarPlay` plugin, so the device app, which declares no such scene, never makes one.
public final class RavenCarPlay: UIResponder, CPTemplateApplicationSceneDelegate, CPInterfaceControllerDelegate {
  private var interfaceController: CPInterfaceController?
  private var tabs: CPTabBarTemplate?
  private var lists: [(parentId: String, template: CPListTemplate)] = []

  public func templateApplicationScene(
    _ templateApplicationScene: CPTemplateApplicationScene,
    didConnect interfaceController: CPInterfaceController
  ) {
    self.interfaceController = interfaceController
    interfaceController.delegate = self
    RavenBrowse.shared.onLateAnswer = { [weak self] parentId in self?.reload(parentId) }
    loadRoot()
  }

  public func templateApplicationScene(
    _ templateApplicationScene: CPTemplateApplicationScene,
    didDisconnectInterfaceController interfaceController: CPInterfaceController
  ) {
    RavenBrowse.shared.onLateAnswer = nil
    self.interfaceController = nil
    tabs = nil
    lists = []
  }

  // MARK: The lists

  private func loadRoot() {
    RavenBrowse.shared.children(of: BrowseRoots.home) { [weak self] answer in self?.showRoot(answer) }
  }

  /// One tab per folder; with none (the app has never answered), the root's own nodes in one.
  private func showRoot(_ answer: BrowseAnswer) {
    let folders = answer.nodes.filter(isFolder)
    lists = []
    let templates: [CPListTemplate] = folders.isEmpty
      ? [listTemplate(title: answer.nodes.first?.title ?? "", showing: answer)]
      : folders.prefix(CPTabBarTemplate.maximumTabCount).map { folder in
        let template = CPListTemplate(title: folder.title, sections: [])
        template.tabTitle = folder.title
        template.tabImage = UIImage(systemName: tabSymbols[folder.id] ?? defaultTabSymbol)
        lists.append((folder.id, template))
        load(folder.id, into: template)
        return template
      }
    if let tabs {
      tabs.updateTemplates(templates)
      return
    }
    let made = CPTabBarTemplate(templates: templates)
    tabs = made
    interfaceController?.setRootTemplate(made, animated: false, completion: nil)
  }

  private func listTemplate(title: String, showing answer: BrowseAnswer) -> CPListTemplate {
    let template = CPListTemplate(title: title, sections: [section(of: answer)])
    template.tabImage = UIImage(systemName: defaultTabSymbol)
    return template
  }

  private func load(_ parentId: String, into template: CPListTemplate) {
    RavenBrowse.shared.children(of: parentId) { [weak self] answer in
      guard let self else { return }
      template.updateSections([self.section(of: answer)])
    }
  }

  private func reload(_ parentId: String) {
    if parentId == BrowseRoots.home {
      loadRoot()
      return
    }
    lists.filter { $0.parentId == parentId }.forEach { load($0.parentId, into: $0.template) }
  }

  private func section(of answer: BrowseAnswer) -> CPListSection {
    CPListSection(items: answer.nodes.map { item(for: $0, headers: answer.artworkHeaders) })
  }

  private func isFolder(_ node: BrowseNode) -> Bool {
    !node.isPlayable && node.id != openAppNode.id
  }

  // The list shows at once; each cover arrives on its own.
  private func item(for node: BrowseNode, headers: [String: String]) -> CPListItem {
    let item = CPListItem(text: node.title, detailText: node.subtitle)
    if isFolder(node) { item.accessoryType = .disclosureIndicator }
    item.handler = { [weak self] _, completion in
      self?.chose(node)
      completion()
    }
    loadArtwork(node.artworkUri, headers: headers) { image in item.setImage(image) }
    return item
  }

  private func chose(_ node: BrowseNode) {
    if node.isPlayable {
      // With no app to play it, Now Playing would show the last queue, not the choice.
      guard let play = RavenBrowse.shared.play else { return }
      play(node.id)
      interfaceController?.pushTemplate(CPNowPlayingTemplate.shared, animated: true, completion: nil)
      return
    }
    guard isFolder(node) else { return }
    let template = CPListTemplate(title: node.title, sections: [])
    lists.append((node.id, template))
    load(node.id, into: template)
    interfaceController?.pushTemplate(template, animated: true, completion: nil)
  }

  /// A list popped off the stack is no longer reloaded; the tabs' stay.
  public func templateDidDisappear(_ aTemplate: CPTemplate, animated: Bool) {
    let showing = (interfaceController?.templates ?? []) + (tabs?.templates ?? [])
    lists = lists.filter { list in showing.contains { $0 === list.template } }
  }

  // MARK: Covers

  /// A downloaded cover is read from its file; a server's is fetched with the answer's headers.
  private func loadArtwork(_ uri: String?, headers: [String: String], show: @escaping (UIImage) -> Void) {
    guard let uri, let url = URL(string: uri) else { return }
    if url.isFileURL {
      DispatchQueue.global(qos: .utility).async {
        guard let image = UIImage(contentsOfFile: url.path) else { return }
        DispatchQueue.main.async { show(image) }
      }
      return
    }
    var request = URLRequest(url: url)
    headers.forEach { name, value in request.setValue(value, forHTTPHeaderField: name) }
    URLSession.shared.dataTask(with: request) { data, _, _ in
      guard let data, let image = UIImage(data: data) else { return }
      DispatchQueue.main.async { show(image) }
    }.resume()
  }
}
#endif
