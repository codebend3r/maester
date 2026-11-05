/** What a capped read answers once a body runs past its cap. */
export const OVERFLOWS = {
  /** The text read so far, one chunk past the cap, so the caller can tell it ran over. */
  truncate: (text: string): string => text,
  /** Nothing: a body past its cap is not passed on at all. */
  refuse: (): null => null,
} as const

type ReadCappedProps<Overflowed> = {
  body: ReadableStream<Uint8Array> | null
  maxChars: number
  /** One of `OVERFLOWS`: what the read answers in place of a body past `maxChars`. */
  onOverflow: (text: string) => Overflowed
}

/**
 * A body's text, read to its end or until it holds more than `maxChars`, after which the rest is
 * let go of, so a huge one is never held whole. A read that fails rejects; no body is empty text.
 */
export const readCapped = async <Overflowed>({
  body,
  maxChars,
  onOverflow,
}: ReadCappedProps<Overflowed>): Promise<string | Overflowed> => {
  if (body === null) return ''
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const readFrom = async (text: string): Promise<string | Overflowed> => {
    const { done, value } = await reader.read()
    if (done) return `${text}${decoder.decode()}`
    const next = `${text}${decoder.decode(value, { stream: true })}`
    return next.length > maxChars ? onOverflow(next) : readFrom(next)
  }
  try {
    return await readFrom('')
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}
