import { execFileSync } from 'node:child_process'

/**
 * The latest version tag behind this commit without its `v`, `0.9.0.15`, or '' where git has
 * none to read (a clone with no tags). Wren's builds name it as the version Settings shows.
 */
export const latestVersionTag = (): string => {
  try {
    const tag = execFileSync('git', ['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return tag.trim().replace(/^v/, '')
  } catch {
    return ''
  }
}
