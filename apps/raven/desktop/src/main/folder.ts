import { dirname, join, basename } from 'node:path'
import { isVideoFile } from '@raven/core'
import type { GrantedFile, Grants } from '@/main/grants'

export const NEXT_ATTEMPTS = 10

const collator = new Intl.Collator(undefined, { numeric: true })

/** The videos after `current` in its folder, in natural order: what plays next, then the fallbacks. */
export const followingVideos = ({
  current,
  siblings,
}: {
  current: string
  siblings: readonly string[]
}): string[] =>
  siblings
    .filter((name) => !name.startsWith('.') && isVideoFile(name) && name !== current)
    .toSorted(collator.compare)
    .filter((name) => collator.compare(name, current) > 0)

const firstGranted = async ({
  candidates,
  grants,
}: {
  candidates: readonly string[]
  grants: Grants
}): Promise<GrantedFile | null> => {
  const [candidate, ...rest] = candidates
  if (candidate === undefined) return null
  const result = await grants.grant(candidate)
  if (result.ok) return result.file
  return firstGranted({ candidates: rest, grants })
}

export const grantNext = async ({
  path,
  readdir,
  grants,
}: {
  path: string
  readdir: (dir: string) => Promise<string[]>
  grants: Grants
}): Promise<GrantedFile | null> => {
  const dir = dirname(path)
  const siblings = await readdir(dir).catch(() => null)
  if (siblings === null) return null
  const candidates = followingVideos({ current: basename(path), siblings })
    .slice(0, NEXT_ATTEMPTS)
    .map((name) => join(dir, name))
  return firstGranted({ candidates, grants })
}
