import { type PlexAccount, type PlexPin, type PlexTv, PlexUnavailable } from '@/plex/plexTv.js'

/**
 * plex.tv in memory. A test approves a PIN with `approve`, optionally only
 * after a number of checks, to stand in for the token trailing the redirect.
 */
export class FakePlexTv implements PlexTv {
  down = false
  private nextPin = 1
  private readonly approvals = new Map<string, { account: PlexAccount; afterChecks: number }>()
  private readonly checks = new Map<string, number>()
  readonly pins: PlexPin[] = []

  private guard(): void {
    if (this.down) throw new PlexUnavailable('plex.tv is down')
  }

  async createPin(): Promise<PlexPin> {
    this.guard()
    const pin = { id: String(this.nextPin), code: `code-${this.nextPin}` }
    this.nextPin += 1
    this.pins.push(pin)
    return pin
  }

  /** The friend approves `pin` as `account`; the token shows up after `afterChecks` checks. */
  approve({
    pin,
    account,
    afterChecks = 0,
  }: {
    pin: PlexPin
    account: PlexAccount
    afterChecks?: number
  }): void {
    this.approvals.set(pin.id, { account, afterChecks })
  }

  checksOf(pin: PlexPin): number {
    return this.checks.get(pin.id) ?? 0
  }

  async checkPin(pin: PlexPin): Promise<string | null> {
    this.guard()
    const seen = this.checksOf(pin)
    this.checks.set(pin.id, seen + 1)
    const approval = this.approvals.get(pin.id)
    if (!approval || seen < approval.afterChecks) return null
    return `token-for-pin-${pin.id}`
  }

  async account(token: string): Promise<PlexAccount> {
    this.guard()
    const found = this.approvals.get(token.replace('token-for-pin-', ''))
    if (!found) throw new PlexUnavailable(`unknown token ${token}`)
    return found.account
  }
}
