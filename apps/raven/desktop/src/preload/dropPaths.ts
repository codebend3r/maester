type ElementAtProps = { list: unknown[]; index: number }

// An element read through its descriptor: a getter is never run, so the page cannot
// hand over a different value than the one it put in the list.
const elementAt = ({ list, index }: ElementAtProps): unknown => {
  const descriptor = Object.getOwnPropertyDescriptor(list, index)
  if (descriptor === undefined || !('value' in descriptor)) return undefined
  return descriptor.value
}

type DropPathsProps = {
  files: unknown
  pathOf: (file: File) => string
}

/**
 * The paths of the dropped files, in drop order. `files` comes from the page, so no
 * method of it is ever called (contextBridge turns the page's functions into callable
 * proxies): it must be a real array, its elements are read by index, and only `File`s
 * count. Only a `File` the user dropped has a path; one the page made itself maps to
 * `''` and is left out, so a page cannot name a path by building a `File`.
 */
export const dropPaths = ({ files, pathOf }: DropPathsProps): string[] => {
  if (!Array.isArray(files)) return []
  const count = Object.getOwnPropertyDescriptor(files, 'length')?.value ?? 0
  if (typeof count !== 'number') return []
  // Only arrays built here are iterated; the page's list is read through `elementAt`.
  return Array.from({ length: count }, (_, index) => elementAt({ list: files, index }))
    .flatMap((element) => (element instanceof File ? [pathOf(element)] : []))
    .filter((path) => path !== '')
}
