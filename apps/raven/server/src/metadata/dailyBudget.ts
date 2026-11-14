import { utcDayOf } from '@/clock'

type DailyBudgetProps = {
  /** Calls a day, counted again from midnight UTC. */
  limit: number
}

/** The calls a metered API allows a day: counted as they are made, and counted again from midnight UTC. */
export class DailyBudget {
  private readonly limit: number
  private readonly count = { day: utcDayOf(Date.now()), used: 0 }

  constructor({ limit }: DailyBudgetProps) {
    this.limit = limit
  }

  /** The UTC day being counted, starting a new count once it has passed. */
  day(): string {
    const today = utcDayOf(Date.now())
    if (this.count.day !== today) {
      this.count.day = today
      this.count.used = 0
    }
    return this.count.day
  }

  /** The calls made today. */
  used(): number {
    this.day()
    return this.count.used
  }

  /** The calls left today. */
  left(): number {
    return Math.max(0, this.limit - this.used())
  }

  /** Counts one call; its number today. */
  spend(): number {
    this.day()
    this.count.used += 1
    return this.count.used
  }

  /** Counts today as used up, as when the API says so, so calls wait for midnight UTC. */
  exhaust(): void {
    this.day()
    this.count.used = this.limit
  }
}
