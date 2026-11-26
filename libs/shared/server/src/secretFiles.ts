import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { text } from '@/env'

export const SECRET_FILES_ENV = { dir: 'SECRETS_DIR' } as const

/** Where Docker mounts a container's secrets, and where a compose file binds a folder of them. */
const DEFAULT_SECRETS_DIR = '/run/secrets'

// A file counts only when its name could be an environment variable's.
const SECRET_NAME = /^[A-Z][A-Z0-9_]*$/

const FS_ERROR_CODES = { missing: 'ENOENT' } as const

const isMissing = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && 'code' in error && error.code === FS_ERROR_CODES.missing

// Only a missing folder means there are none; any other error stops the start.
const namesIn = (dir: string): string[] => {
  try {
    return readdirSync(dir)
  } catch (error) {
    if (isMissing(error)) return []
    throw error
  }
}

// An entry that cannot be read, a dangling link among them, throws here rather than passing for no folder.
const secretNamesIn = (dir: string): string[] =>
  namesIn(dir).filter((name) => SECRET_NAME.test(name) && statSync(join(dir, name)).isFile())

type SecretEntry = [name: string, value: string]

type SecretOfProps = { dir: string; name: string }

// An empty file sets nothing, so it never wipes a value the environment holds.
const secretOf = ({ dir, name }: SecretOfProps): SecretEntry[] => {
  const value = text({ value: readFileSync(join(dir, name), 'utf8'), fallback: null })
  return value === null ? [] : [[name, value]]
}

type WithSecretFilesProps = { env: NodeJS.ProcessEnv }

/**
 * `env` with every secret file laid over it: a file in `SECRETS_DIR`
 * (`/run/secrets` by default) named after a variable, holding its value,
 * wins over the variable. A secret kept this way never enters the process's
 * environment, so the container's settings, `docker inspect` and every
 * child process (ffmpeg, ffprobe) never see it. No folder means no secret
 * files, and an empty file sets nothing; a folder or file that cannot be
 * read stops the server, since starting without its admin password or PIN
 * would open what they lock.
 */
export const withSecretFiles = ({ env }: WithSecretFilesProps): NodeJS.ProcessEnv => {
  const dir = text({ value: env[SECRET_FILES_ENV.dir], fallback: DEFAULT_SECRETS_DIR })
  const secrets = Object.fromEntries(secretNamesIn(dir).flatMap((name) => secretOf({ dir, name })))
  return { ...env, ...secrets }
}
