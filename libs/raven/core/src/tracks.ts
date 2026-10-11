/**
 * Languages by their two-letter code, with the three-letter codes (both
 * the bibliographic and terminology forms of ISO 639-2) and English names
 * that files and sidecar names use for them.
 */
const LANGUAGES: Record<string, readonly string[]> = {
  ar: ['ara', 'arabic'],
  cs: ['ces', 'cze', 'czech'],
  da: ['dan', 'danish'],
  de: ['deu', 'ger', 'german'],
  el: ['ell', 'gre', 'greek'],
  en: ['eng', 'english'],
  es: ['spa', 'spanish'],
  fa: ['fas', 'per', 'persian'],
  fi: ['fin', 'finnish'],
  fr: ['fra', 'fre', 'french'],
  he: ['heb', 'hebrew'],
  hi: ['hin', 'hindi'],
  hu: ['hun', 'hungarian'],
  id: ['ind', 'indonesian'],
  it: ['ita', 'italian'],
  ja: ['jpn', 'japanese'],
  ko: ['kor', 'korean'],
  ms: ['msa', 'may', 'malay'],
  nl: ['nld', 'dut', 'dutch'],
  no: ['nor', 'nob', 'nno', 'norwegian'],
  pl: ['pol', 'polish'],
  pt: ['por', 'portuguese'],
  ro: ['ron', 'rum', 'romanian'],
  ru: ['rus', 'russian'],
  sv: ['swe', 'swedish'],
  th: ['tha', 'thai'],
  tr: ['tur', 'turkish'],
  uk: ['ukr', 'ukrainian'],
  vi: ['vie', 'vietnamese'],
  zh: ['zho', 'chi', 'chinese'],
}

const ALIASES: ReadonlyMap<string, string> = new Map(
  Object.entries(LANGUAGES).flatMap(([tag, names]) =>
    [tag, ...names].map((name): [string, string] => [name, tag]),
  ),
)

/** Not a language at all: undetermined, no linguistic content, multiple. */
const NOT_A_LANGUAGE: ReadonlySet<string> = new Set(['und', 'zxx', 'mul', 'mis', ''])

/**
 * A comparable language tag from whatever a file says: 'eng', 'en',
 * 'English' and 'en-US' all give 'en'. An unknown code comes back as is,
 * lowercased, and "undetermined" gives null.
 */
export const languageTag = (code: string | null): string | null => {
  const lower = code?.trim().toLowerCase() ?? ''
  if (NOT_A_LANGUAGE.has(lower)) return null
  const primary = lower.split(/[-_]/)[0] ?? lower
  return ALIASES.get(lower) ?? ALIASES.get(primary) ?? lower
}

/** Whether `code` is something `languageTag` recognises, for telling a language from a title. */
export const isKnownLanguage = (code: string): boolean => ALIASES.has(code.trim().toLowerCase())
