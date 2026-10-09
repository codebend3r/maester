/** The time now. Injected so tests can move it; the server provides `() => new Date()`. */
export type Clock = () => Date

/** The DI token the clock is provided under. */
export const CLOCK = Symbol('CLOCK')

export const systemClock: Clock = () => new Date()

export const addMs = ({ date, ms }: { date: Date; ms: number }): Date =>
  new Date(date.getTime() + ms)
