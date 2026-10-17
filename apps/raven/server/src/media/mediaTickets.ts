import { createHmac } from 'node:crypto'
import { Inject, Injectable } from '@nestjs/common'
import { MEDIA_TICKET_SECONDS, type MediaTicket } from '@raven/core'
import { sameSecret } from '@shared/server'
import { SERVER_CONFIG, type ServerConfig } from '@/config'

const PAYLOAD = /^(\d+)\.(\d+)$/

/**
 * Signs and checks the ticket that lets a media request through without a
 * cookie, for the origins a browser cannot send one to. A ticket names one
 * video and a moment it stops working, and carries an HMAC of both made with
 * RAVEN_MEDIA_SECRET. Without that secret, no ticket is issued or accepted.
 */
@Injectable()
export class MediaTickets {
  constructor(@Inject(SERVER_CONFIG) private readonly config: ServerConfig) {}

  get isOn(): boolean {
    return this.config.mediaPlane.secret != null
  }

  issue({ id, now = Date.now() }: { id: number; now?: number }): MediaTicket {
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`${id} is not a media id`)
    const expiresAt = now + MEDIA_TICKET_SECONDS * 1000
    const payload = `${id}.${expiresAt}`
    const signature = this.sign(payload)
    if (signature == null) throw new Error('RAVEN_MEDIA_SECRET is not set')
    return { ticket: `${Buffer.from(payload).toString('base64url')}.${signature}`, expiresAt }
  }

  verify({ ticket, id, now = Date.now() }: { ticket: string; id: number; now?: number }): boolean {
    const parts = ticket.split('.')
    if (parts.length !== 2) return false
    const [encoded = '', given = ''] = parts
    const payload = Buffer.from(encoded, 'base64url').toString()
    const [, ticketId, expiresAt] = PAYLOAD.exec(payload) ?? []
    if (ticketId == null || expiresAt == null) return false
    if (Number(ticketId) !== id || Number(expiresAt) <= now) return false
    const expected = this.sign(payload)
    return expected != null && sameSecret({ given, expected })
  }

  private sign(payload: string): string | null {
    const { secret } = this.config.mediaPlane
    if (secret == null) return null
    return createHmac('sha256', secret).update(payload).digest('base64url')
  }
}
