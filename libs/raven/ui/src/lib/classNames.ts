/** A class name, or nothing where a condition left it out. */
type ClassName = string | false | null | undefined

/** The class names given, the ones left out dropped: `classNames([styles.stage, isIdle && styles.idle])`. */
export const classNames = (names: readonly ClassName[]): string => names.filter(Boolean).join(' ')
