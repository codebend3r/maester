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
import { SERVER_CONFIG, type ServerConfig } from '@/config'

const isInside = ({ root, path }: { root: string; path: string }): boolean =>
  path === root || path.startsWith(root.endsWith(sep) ? root : `${root}${sep}`)

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

  @Get('browse')
  async browse(@Query('path') requested?: string): Promise<DirectoryListing> {
    const root = await realpath(this.config.browseRoot).catch(() => this.config.browseRoot)
    const target = await realpath(resolve(requested?.trim() || root)).catch((error: unknown) => {
      throw errorCode(error) === 'ENOENT'
        ? new NotFoundException('That folder does not exist')
        : new BadRequestException('That folder cannot be opened')
    })
    if (!isInside({ root, path: target })) {
      throw new BadRequestException(`Only folders under ${root} can be browsed`)
    }

    const entries = await readdir(target, { withFileTypes: true }).catch((error: unknown) => {
      throw errorCode(error) === 'EACCES' || errorCode(error) === 'EPERM'
        ? new ForbiddenException('No permission to read that folder')
        : new BadRequestException('That folder cannot be read')
    })
    const candidates = await Promise.all(
      entries
        .filter((entry) => !entry.name.startsWith('.') && entry.name !== '@eaDir')
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
