export type FolderGroup = { parent: string; names: string[] }

/**
 * A library's folders grouped by the folder that holds them, in the order
 * each parent first appears, so seven paths on four drives read as four lines.
 * A path straight under the root has `/` for its parent.
 */
export const foldersByParent = (paths: readonly string[]): FolderGroup[] =>
  paths.reduce<FolderGroup[]>((groups, path) => {
    const cut = path.lastIndexOf('/')
    const parent = path.slice(0, cut) || '/'
    const name = path.slice(cut + 1)
    const at = groups.findIndex((group) => group.parent === parent)
    if (at === -1) return [...groups, { parent, names: [name] }]
    return groups.with(at, { parent, names: [...groups[at].names, name] })
  }, [])
