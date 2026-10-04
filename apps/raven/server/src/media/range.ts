export type ByteRange = { start: number; end: number }

/**
 * Reads a `Range: bytes=...` header against a file of `size` bytes. null
 * means serve the whole file; 'unsatisfiable' is a 416. Only the first range
 * of a multi-range request is honoured, which is all a video element asks for.
 */
export const parseRange = ({
  header,
  size,
}: {
  header: string | undefined
  size: number
}): ByteRange | 'unsatisfiable' | null => {
  if (!header) return null
  const match = /^bytes=(\d*)-(\d*)/.exec(header.trim())
  if (!match) return null
  const [, rawStart = '', rawEnd = ''] = match
  if (rawStart === '' && rawEnd === '') return null

  // "bytes=-500" is the last 500 bytes.
  if (rawStart === '') {
    const suffix = Number(rawEnd)
    if (suffix === 0) return 'unsatisfiable'
    return { start: Math.max(0, size - suffix), end: size - 1 }
  }

  const start = Number(rawStart)
  const end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1)
  if (start >= size || end < start) return 'unsatisfiable'
  return { start, end }
}
