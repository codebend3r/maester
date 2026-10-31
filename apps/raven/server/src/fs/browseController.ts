import { readdir, realpath, stat } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Query,
} from '@nestjs/common'
import type { DirectoryEntry, DirectoryListing } from '@raven/core'
import { AdminOnly } from '@/admin/adminGuard'
import { SERVER_CONFIG, type ServerConfig } from '@/config'
import { ERROR_CODES } from '@/errorMessage'
import { SKIPPED_FOLDERS } from '@/scanner/walk'

const errorCode = (error: unknown): string | null =>
  error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : null

/**
 * Lists folders for the library path picker. Only folders are shown, hidden
 * ones are skipped, and nothing above BROWSE_ROOT is reachable, symlinks
 * included, since the check runs on the resolved real path.
 */
@Controller('api/fs')
export class BrowseController {
  constructor(@Inject(SERVER_CONFIG) private readonly config: ServerConfig) {}

  @AdminOnly()
  @Get('browse')
  async browse(@Query('path') requested?: string): Promise<DirectoryListing> {
    const configuredRoot = resolve(this.config.browseRoot)
    const root = await realpath(configuredRoot).catch(() => configuredRoot)
    const resolved = resolve(requested?.trim() || root)
    const prefix = root.endsWith(sep) ? root : `${root}${sep}`
    const configuredPrefix = configuredRoot.endsWith(sep)
      ? configuredRoot
      : `${configuredRoot}${sep}`
    // Accept the configured alias too, such as macOS's /var pointing at /private/var,
    // by rebasing it onto the real root so one prefix check guards the path.
    const isAliased = resolved === configuredRoot || resolved.startsWith(configuredPrefix)
    const requestedPath = isAliased ? join(root, resolved.slice(configuredRoot.length)) : resolved
    if (requestedPath !== root && !requestedPath.startsWith(prefix)) {
      throw new BadRequestException(`Only folders under ${root} can be browsed`)
    }
    const target = await realpath(requestedPath).catch((error: unknown) => {
      throw errorCode(error) === ERROR_CODES.enoent
        ? new NotFoundException('That folder does not exist')
        : new BadRequestException('That folder cannot be opened')
    })
    if (target !== root && !target.startsWith(prefix)) {
      throw new BadRequestException(`Only folders under ${root} can be browsed`)
    }

    const entries = await readdir(target, { withFileTypes: true }).catch((error: unknown) => {
      throw errorCode(error) === ERROR_CODES.eacces || errorCode(error) === ERROR_CODES.eperm
        ? new ForbiddenException('No permission to read that folder')
        : new BadRequestException('That folder cannot be read')
    })
    const candidates = await Promise.all(
      entries
        .filter((entry) => !entry.name.startsWith('.') && entry.name !== SKIPPED_FOLDERS.eaDir)
        .map(async (entry): Promise<DirectoryEntry[]> => {
          const path = join(target, entry.name)
          const isFolder =
            entry.isDirectory() ||
            (entry.isSymbolicLink() && !!(await stat(path).catch(() => null))?.isDirectory())
          return isFolder ? [{ name: entry.name, path }] : []
        }),
    )
    const directories = candidates
      .flat()
      .toSorted((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }),
      )

    return { path: target, parent: target === root ? null : dirname(target), directories }
  }
}
