/**
 * The little Markdown luwin's replies use: links and bold. Everything else
 * stays text, and nothing is ever read as HTML. A link opens only an http or
 * https address; a bare address becomes a link too, so a reply never shows
 * one spelled out.
 */

export const SEGMENT_KINDS = { text: 'text', link: 'link', strong: 'strong' } as const

export type Segment =
  | { kind: typeof SEGMENT_KINDS.text; text: string }
  | { kind: typeof SEGMENT_KINDS.link; text: string; href: string }
  | { kind: typeof SEGMENT_KINDS.strong; text: string }

/** What a bare address reads as, since the address itself is noise to whoever reads the reply. */
export const BARE_LINK_LABEL = 'Open link'

// `[label](https://...)`, `**bold**`, or a bare `https://...`, in that order of precedence.
const TOKENS = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*\n]+)\*\*|(https?:\/\/[^\s<>()]+)/g
// Punctuation that ends a sentence rather than the address it follows.
const TRAILING = /[.,;:!?'"]+$/

const toSegments = (match: RegExpMatchArray): Segment[] => {
  const [, label, href, strong, bare] = match
  if (label && href) return [{ kind: SEGMENT_KINDS.link, text: label, href }]
  if (strong) return [{ kind: SEGMENT_KINDS.strong, text: strong }]
  const address = (bare ?? '').replace(TRAILING, '')
  const after = (bare ?? '').slice(address.length)
  return [
    { kind: SEGMENT_KINDS.link, text: BARE_LINK_LABEL, href: address },
    ...(after ? [{ kind: SEGMENT_KINDS.text, text: after } as const] : []),
  ]
}

type Parsed = { segments: Segment[]; end: number }

/** `text` split into plain runs, links and bold, in order. */
export const parseRichText = (text: string): Segment[] => {
  const { segments, end } = [...text.matchAll(TOKENS)].reduce<Parsed>(
    (parsed, match) => {
      const start = match.index ?? 0
      const before = text.slice(parsed.end, start)
      return {
        segments: [
          ...parsed.segments,
          ...(before ? [{ kind: SEGMENT_KINDS.text, text: before } as const] : []),
          ...toSegments(match),
        ],
        end: start + match[0].length,
      }
    },
    { segments: [], end: 0 },
  )
  const rest = text.slice(end)
  return rest ? [...segments, { kind: SEGMENT_KINDS.text, text: rest }] : segments
}
