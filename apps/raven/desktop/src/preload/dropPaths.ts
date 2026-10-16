/**
 * The paths of the dropped files, in drop order. Only a `File` the user dropped has
 * a path; one the page made itself maps to `''` and is left out, so a page cannot
 * name a path by building a `File`.
 */
export const dropPaths = ({
  files,
  pathOf,
}: {
  files: readonly unknown[]
  pathOf: (file: File) => string
}): string[] =>
  files
    .filter((file): file is File => file instanceof File)
    .map((file) => pathOf(file))
    .filter((path) => path !== '')
