import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto'
import { Inject, Injectable } from '@nestjs/common'
import { sameSecret } from '@shared/server'
import { SettingsRepository } from '@/settings/settingsRepository'

const ALGORITHM = 'aes-256-gcm'

const IV_BYTES = 12

const TAG_BYTES = 16

/** What each key derived from the one secret is for, so neither can stand in for the other. */
const KEY_USES = { seal: 'raven scrobble tokens', sign: 'raven scrobble sign-in state' } as const

type KeyUse = (typeof KEY_USES)[keyof typeof KEY_USES]

type ScrobbleCipherSealProps = { plain: string; context: string }

type ScrobbleCipherOpenProps = { sealed: string; context: string }

type ScrobbleCipherIsSignedProps = { text: string; signature: string }

/**
 * Seals a scrobble token or session key for the database, and signs the
 * state Last.fm's sign-in carries. Both keys come from the server's
 * `scrobble` secret through HKDF-SHA256, each with its own label. A sealed
 * value is AES-256-GCM under a fresh 12-byte IV, written `iv.tag.cipher` in
 * base64url, and `context` (the account and service) is its associated
 * data, so a row copied onto another account's opens as nothing.
 */
@Injectable()
export class ScrobbleCipher {
  private readonly keys: Record<KeyUse, Buffer>

  constructor(@Inject(SettingsRepository) settings: SettingsRepository) {
    const secret = settings.scrobbleSecret()
    const derive = (use: KeyUse): Buffer => Buffer.from(hkdfSync('sha256', secret, '', use, 32))
    this.keys = { [KEY_USES.seal]: derive(KEY_USES.seal), [KEY_USES.sign]: derive(KEY_USES.sign) }
  }

  seal({ plain, context }: ScrobbleCipherSealProps): string {
    const iv = randomBytes(IV_BYTES)
    const cipher = createCipheriv(ALGORITHM, this.keys[KEY_USES.seal], iv)
    cipher.setAAD(Buffer.from(context))
    const sealed = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
    return [iv, cipher.getAuthTag(), sealed].map((part) => part.toString('base64url')).join('.')
  }

  /** The plain value, or null for one this key did not seal for `context`. */
  open({ sealed, context }: ScrobbleCipherOpenProps): string | null {
    const [iv, tag, body, ...rest] = sealed.split('.').map((part) => Buffer.from(part, 'base64url'))
    if (iv?.length !== IV_BYTES || tag?.length !== TAG_BYTES || !body || rest.length > 0) {
      return null
    }
    try {
      const decipher = createDecipheriv(ALGORITHM, this.keys[KEY_USES.seal], iv)
      decipher.setAAD(Buffer.from(context))
      decipher.setAuthTag(tag)
      return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')
    } catch {
      return null
    }
  }

  /** `text`'s HMAC-SHA256 under the signing key, in base64url. */
  sign(text: string): string {
    return createHmac('sha256', this.keys[KEY_USES.sign]).update(text).digest('base64url')
  }

  isSigned({ text, signature }: ScrobbleCipherIsSignedProps): boolean {
    return sameSecret({ given: signature, expected: this.sign(text) })
  }
}
