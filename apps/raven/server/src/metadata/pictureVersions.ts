import { createHmac } from 'node:crypto'
import { Inject, Injectable } from '@nestjs/common'
import type { ItemImageKind } from '@raven/core'
import { SettingsRepository } from '@/settings/settingsRepository'

/** How much of the keyed hash a version keeps: 22 base64url characters, 132 bits. */
const VERSION_LENGTH = 22

type PictureVersionsItemProps = {
  id: number
  kind: ItemImageKind
  source: string
  ref: string
}

type PictureVersionsPhotoProps = { id: number; photo: string | null }

type PictureVersionsAvatarProps = { id: number; avatar: string | null }

/**
 * A picture's version: its owner, its kind and its source hashed with this
 * server's own secret, so it changes exactly when the picture does and
 * nobody without the secret can work it out from a TMDB path or a file
 * name. A versioned picture address is then a capability for that one
 * picture: whoever was shown it may fetch it, so it can be cached publicly,
 * by Netlify's CDN among others, with no account asked for. Naming the owner
 * keeps one item's address from opening another's that shows the same file.
 */
@Injectable()
export class PictureVersions {
  private readonly key: string

  constructor(@Inject(SettingsRepository) settings: SettingsRepository) {
    this.key = settings.pictureSecret()
  }

  private of(subject: string): string {
    return createHmac('sha256', this.key)
      .update(subject)
      .digest('base64url')
      .slice(0, VERSION_LENGTH)
  }

  /** The version of item `id`'s picture of `kind`, shown from `source` at `ref`. */
  item({ id, kind, source, ref }: PictureVersionsItemProps): string {
    return this.of(`item:${id}:${kind}:${source}:${ref}`)
  }

  /** The version of person `id`'s TMDB photo at `photo`; null for none. */
  photo({ id, photo }: PictureVersionsPhotoProps): string | null {
    return photo == null ? null : this.of(`person:${id}:tmdb:${photo}`)
  }

  /** The version of review `id`'s TMDB avatar at `avatar`; null for none. */
  avatar({ id, avatar }: PictureVersionsAvatarProps): string | null {
    return avatar == null ? null : this.of(`review:${id}:tmdb:${avatar}`)
  }
}
