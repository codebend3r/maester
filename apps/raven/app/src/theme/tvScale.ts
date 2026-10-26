/** The width the TV layouts are drawn for: Apple TV's screen, in points. */
export const TV_DESIGN_WIDTH = 1920

type TvScaleOfProps = { width: number }

/**
 * How much a TV draws the TV layouts' sizes at: its window's width over the 1920 points they are
 * drawn for. Apple TV's window is 1920 points wide, so 1; a 1080p Android TV's is 960 dp, so a
 * half, or every card, line and gap would stand twice as large on its screen.
 */
export const tvScaleOf = ({ width }: TvScaleOfProps): number => width / TV_DESIGN_WIDTH
