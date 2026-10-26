import { isString } from '@/schema'
import { URL_PROTOCOLS } from '@/urls'

/**
 * A server's address as a person types it, read without `URL`: React Native's
 * is a handful of regular expressions with no `canParse`, and this library
 * leans on no web API. The rules are WHATWG URL's host parser (IPv4 in all its
 * forms, IPv6, punycode for an international name), narrowed to a bare http or
 * https origin.
 */

export const MAX_ORIGIN_LENGTH = 2048

const DEFAULT_PORTS = {
  [URL_PROTOCOLS.http]: '80',
  [URL_PROTOCOLS.https]: '443',
} as const satisfies Record<string, string>

const isWebProtocol = (value: string): value is keyof typeof DEFAULT_PORTS =>
  Object.hasOwn(DEFAULT_PORTS, value)
const UNREACHABLE_PORT = 0
const MAX_PORT = 65_535

// What URL silently drops (tabs, newlines) or folds to nothing (zero-width characters, variation
// selectors, fillers: every default-ignorable code point) is refused up front, so a hidden
// character never makes a second host that looks like the first.
const HIDDEN = /[\s\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]/u
// UTS 46 refuses unassigned, private-use and surrogate code points, the noncharacters
// (unassigned too) and the replacement character.
const DISALLOWED = /[\p{Cn}\p{Co}\p{Cs}\p{Noncharacter_Code_Point}\ufffd]/u
const HTTP_ORIGIN_ONLY = /^(https?:)\/\/([^/\\]+)\/?$/i
const BRACKETED = /^\[([^\]]*)\](?::(.*))?$/
const PORT = /^\d*$/
// WHATWG's forbidden domain code points that the checks above let through, plus `%`:
// URL would percent-decode it into another name, which no server address needs.
const FORBIDDEN_DOMAIN = /[#%/:<>?@[\\\]^|]/u
// Controls and spaces are refused before this is asked.
const ASCII_ONLY = /^[\u0021-\u007e]*$/u
// UTS 46 maps the ideographic and fullwidth full stops to a dot before anything else.
const FULL_STOPS = /[\u3002\uff0e\uff61]/gu
// UTS 46 refuses a label that starts with a combining mark.
const LEADING_MARK = /^\p{M}/u

const DECIMAL = /^\d+$/
const OCTAL = /^0[0-7]+$/
const HEX = /^0x([0-9a-f]*)$/i
const IPV4_PIECE = /^(?:0|[1-9]\d{0,2})$/
const IPV6_PIECE = /^[0-9a-f]{1,4}$/i
const IPV6_PIECES = 8

const ipv4NumberOf = (part: string): number | null => {
  const hex = HEX.exec(part)
  if (hex !== null) return hex[1] === '' ? 0 : Number.parseInt(hex[1] ?? '', 16)
  if (OCTAL.test(part)) return Number.parseInt(part, 8)
  if (part.length > 1 && part.startsWith('0')) return null
  return DECIMAL.test(part) ? Number(part) : null
}

/** The host's dot-separated parts, without the one empty part a trailing dot leaves. */
const partsOf = (host: string): string[] => {
  const parts = host.split('.')
  return parts.length > 1 && parts.at(-1) === '' ? parts.slice(0, -1) : parts
}

/** WHATWG's test for a host that must be an IPv4 address: its last part is a number. */
const isNumericHost = (host: string): boolean => {
  const last = partsOf(host).at(-1) ?? ''
  return DECIMAL.test(last) || HEX.test(last)
}

const ipv4Of = (host: string): string | null => {
  const parts = partsOf(host)
  if (parts.length > 4) return null
  const numbers = parts.map(ipv4NumberOf)
  if (!numbers.every((value) => value !== null)) return null
  const last = numbers.at(-1) ?? 0
  const leading = numbers.slice(0, -1)
  if (leading.some((value) => value > 255)) return null
  if (last >= 256 ** (5 - numbers.length)) return null
  const address = leading.reduce((sum, value, index) => sum + value * 256 ** (3 - index), last)
  return [3, 2, 1, 0].map((power) => Math.floor(address / 256 ** power) % 256).join('.')
}

/** A dotted IPv4 tail of an IPv6 address as its two 16-bit pieces; stricter than a host's IPv4. */
const ipv4PiecesOf = (text: string): number[] | null => {
  const parts = text.split('.')
  if (parts.length !== 4 || !parts.every((part) => IPV4_PIECE.test(part))) return null
  const bytes = parts.map(Number)
  if (bytes.some((value) => value > 255)) return null
  const [a = 0, b = 0, c = 0, d = 0] = bytes
  return [a * 256 + b, c * 256 + d]
}

type Ipv6PiecesOfProps = { text: string; isLast: boolean }

/** The 16-bit pieces of one side of `::`; an IPv4 tail is allowed only where `isLast` says. */
const ipv6PiecesOf = ({ text, isLast }: Ipv6PiecesOfProps): number[] | null => {
  if (text === '') return []
  const parts = text.split(':')
  const tail = parts.at(-1) ?? ''
  const hasIpv4 = isLast && tail.includes('.')
  const hexParts = hasIpv4 ? parts.slice(0, -1) : parts
  if (!hexParts.every((part) => IPV6_PIECE.test(part))) return null
  const ipv4 = hasIpv4 ? ipv4PiecesOf(tail) : []
  if (ipv4 === null) return null
  return [...hexParts.map((part) => Number.parseInt(part, 16)), ...ipv4]
}

const ipv6PiecesFrom = (address: string): number[] | null => {
  const halves = address.split('::')
  if (halves.length > 2) return null
  const [head = '', tail] = halves
  const front = ipv6PiecesOf({ text: head, isLast: tail === undefined })
  const back = tail === undefined ? [] : ipv6PiecesOf({ text: tail, isLast: true })
  if (front === null || back === null) return null
  if (tail === undefined) return front.length === IPV6_PIECES ? front : null
  const gap = IPV6_PIECES - front.length - back.length
  return gap < 1 ? null : [...front, ...Array.from({ length: gap }, () => 0), ...back]
}

/** Where the longest run of two or more zero pieces starts and how long it is; the first such run on a tie. */
const longestZeroRun = (pieces: readonly number[]): { start: number; length: number } | null => {
  const runs = pieces.reduce<{ start: number; length: number }[]>((found, piece, index) => {
    if (piece !== 0) return found
    const previous = found.at(-1)
    if (previous !== undefined && previous.start + previous.length === index) {
      return [...found.slice(0, -1), { start: previous.start, length: previous.length + 1 }]
    }
    return [...found, { start: index, length: 1 }]
  }, [])
  const best = runs.reduce<{ start: number; length: number } | null>(
    (longest, run) => (run.length > (longest?.length ?? 1) ? run : longest),
    null,
  )
  return best
}

const hexOf = (pieces: readonly number[]): string =>
  pieces.map((piece) => piece.toString(16)).join(':')

const ipv6Of = (address: string): string | null => {
  const pieces = ipv6PiecesFrom(address)
  if (pieces === null) return null
  const run = longestZeroRun(pieces)
  if (run === null) return `[${hexOf(pieces)}]`
  const head = hexOf(pieces.slice(0, run.start))
  const tail = hexOf(pieces.slice(run.start + run.length))
  return `[${head}::${tail}]`
}

// RFC 3492's bootstring parameters for punycode.
const BASE = 36
const T_MIN = 1
const T_MAX = 26
const SKEW = 38
const DAMP = 700
const INITIAL_BIAS = 72
const INITIAL_N = 128
const ACE_PREFIX = 'xn--'

const digitOf = (digit: number): string =>
  String.fromCodePoint(digit < 26 ? digit + 97 : digit + 22)

type AdaptProps = { delta: number; points: number; isFirst: boolean }

const adapt = ({ delta, points, isFirst }: AdaptProps) => {
  const scaled = isFirst ? Math.floor(delta / DAMP) : Math.floor(delta / 2)
  type SettleProps = { value: number; k: number }

  const settle = ({ value, k }: SettleProps): number =>
    value > ((BASE - T_MIN) * T_MAX) / 2
      ? settle({ value: Math.floor(value / (BASE - T_MIN)), k: k + BASE })
      : k + Math.floor(((BASE - T_MIN + 1) * value) / (value + SKEW))
  return settle({ value: scaled + Math.floor(scaled / points), k: 0 })
}

type VariableLengthProps = { q: number; bias: number; k?: number }

/** `q` as RFC 3492's generalised variable-length integer. */
const variableLength = ({ q, bias, k = BASE }: VariableLengthProps): string => {
  const threshold = k <= bias ? T_MIN : k >= bias + T_MAX ? T_MAX : k - bias
  if (q < threshold) return digitOf(q)
  const digit = digitOf(threshold + ((q - threshold) % (BASE - threshold)))
  const rest = Math.floor((q - threshold) / (BASE - threshold))
  return digit + variableLength({ q: rest, bias, k: k + BASE })
}

type Encoding = { n: number; delta: number; bias: number; handled: number; output: string }

const punycodeOf = (label: string): string => {
  const points = Array.from(label, (character) => character.codePointAt(0) ?? 0)
  const basic = points.filter((point) => point < INITIAL_N)
  const encode = ({ n, delta, bias, handled, output }: Encoding): string => {
    if (handled >= points.length) return output
    const next = Math.min(...points.filter((point) => point >= n))
    const step = points.reduce(
      (state, point) => {
        if (point < next) {
          return {
            output: state.output,
            delta: state.delta + 1,
            bias: state.bias,
            handled: state.handled,
          }
        }
        if (point > next) return state
        return {
          output: state.output + variableLength({ q: state.delta, bias: state.bias }),
          bias: adapt({
            delta: state.delta,
            points: state.handled + 1,
            isFirst: state.handled === basic.length,
          }),
          delta: 0,
          handled: state.handled + 1,
        }
      },
      { output, delta: delta + (next - n) * (handled + 1), bias, handled },
    )
    return encode({ ...step, n: next + 1, delta: step.delta + 1 })
  }
  const start = basic.length === 0 ? '' : `${String.fromCodePoint(...basic)}-`
  return encode({
    n: INITIAL_N,
    delta: 0,
    bias: INITIAL_BIAS,
    handled: basic.length,
    output: start,
  })
}

const CHEROKEE_SMALL = { first: 0xab70, last: 0xabbf, toCapital: 0x13a0 - 0xab70 } as const
const CHEROKEE_SMALL_EXTRA = { first: 0x13f8, last: 0x13fd, toCapital: 0x13f0 - 0x13f8 } as const
const GREEK_EXTENDED = { first: 0x1f80, last: 0x1fff } as const

/**
 * Where UTS 46's case folding parts from `toLowerCase`: Cherokee folds to its capitals, and a
 * Greek letter with iota subscript folds to the letter and an iota (its uppercase, lowered).
 */
const foldCase = (character: string): string => {
  const point = character.codePointAt(0) ?? 0
  const cherokee = [CHEROKEE_SMALL, CHEROKEE_SMALL_EXTRA].find(
    ({ first, last }) => point >= first && point <= last,
  )
  if (cherokee !== undefined) return String.fromCodePoint(point + cherokee.toCapital)
  const isGreekExtended = point >= GREEK_EXTENDED.first && point <= GREEK_EXTENDED.last
  if (isGreekExtended && character.toUpperCase().length > 1) {
    return character.toUpperCase().toLowerCase()
  }
  return character
}

/** UTS 46's mapping, as near as the language's own normalisation comes, then punycode per label. */
const asciiDomainOf = (host: string): string | null => {
  if (ASCII_ONLY.test(host)) return host.toLowerCase()
  const stopped = host.replace(FULL_STOPS, '.')
  // NFKC can make a full stop of its own (U+FE12 becomes U+3002), so they are mapped again.
  const lowered = stopped.normalize('NFKC').toLowerCase().replace(FULL_STOPS, '.')
  // A character such as U+2490 (a digit and a full stop) or U+FE12 would split a label in two.
  if (lowered.split('.').length !== stopped.split('.').length) return null
  const mapped = Array.from(lowered, foldCase).join('').normalize('NFC')
  if (HIDDEN.test(mapped) || DISALLOWED.test(mapped) || FORBIDDEN_DOMAIN.test(mapped)) return null
  const labels = mapped.split('.')
  if (labels.some((label) => LEADING_MARK.test(label))) return null
  return labels
    .map((label) => (ASCII_ONLY.test(label) ? label : `${ACE_PREFIX}${punycodeOf(label)}`))
    .join('.')
}

const hostOf = (raw: string): string | null => {
  if (raw === '' || FORBIDDEN_DOMAIN.test(raw)) return null
  const domain = asciiDomainOf(raw)
  if (domain === null) return null
  if (isNumericHost(domain)) return ipv4Of(domain)
  // A trailing dot names the same host as a second origin; an empty label names none.
  if (domain.split('.').includes('')) return null
  return domain
}

/** The host and port as written in the authority, or null when they do not split cleanly. */
const splitAuthority = (authority: string): { host: string | null; port: string } | null => {
  const bracketed = BRACKETED.exec(authority)
  if (bracketed !== null) return { host: ipv6Of(bracketed[1] ?? ''), port: bracketed[2] ?? '' }
  const colon = authority.lastIndexOf(':')
  if (colon === -1) return { host: hostOf(authority), port: '' }
  return { host: hostOf(authority.slice(0, colon)), port: authority.slice(colon + 1) }
}

type PortOfProps = { port: string; protocol: string }

/** The port to write after the host: '' for none or the scheme's default, null for one that is no port. */
const portOf = ({ port, protocol }: PortOfProps): string | null => {
  if (!PORT.test(port)) return null
  if (port === '') return ''
  const value = Number(port)
  if (value === UNREACHABLE_PORT || value > MAX_PORT) return null
  const written = String(value)
  const isDefault = isWebProtocol(protocol) && written === DEFAULT_PORTS[protocol]
  return isDefault ? '' : `:${written}`
}

/** The normalised origin of a server address, or null for anything that is not a bare http or https origin. */
export const serverOriginOf = (raw: string): string | null => {
  const address = raw.trim()
  if (address.length > MAX_ORIGIN_LENGTH) return null
  if (HIDDEN.test(address)) return null
  const match = HTTP_ORIGIN_ONLY.exec(address)
  if (match === null) return null
  const protocol = (match[1] ?? '').toLowerCase()
  const parts = splitAuthority(match[2] ?? '')
  const host = parts?.host ?? null
  if (parts === null || host === null) return null
  const port = portOf({ port: parts.port, protocol })
  if (port === null) return null
  return `${protocol}//${host}${port}`
}

/** A server origin exactly as `serverOriginOf` writes it. */
export const isServerOrigin = (value: unknown): value is string =>
  isString(value) && serverOriginOf(value) === value
