/**
 * Millisecond precision, rounded down. A keyframe rounded up lies after the
 * real one, so `-copypriorss 0` drops it and the run writes no video;
 * rounded down it sits at or just before. The small addend absorbs float
 * error (`4.004 * 1000` is 4003.9999999999995) and is far under the
 * 0.001 ms ffprobe's six decimals can differ by.
 */
const truncateToMilliseconds = (seconds: number): number => Math.floor(seconds * 1000 + 1e-6) / 1000

const PACKET_REPORT = { noTime: 'N/A', keyframe: 'K' } as const

/**
 * The video keyframe times, in seconds and ascending, from ffprobe's
 * `-show_entries packet=pts_time,flags -of csv=p=0` report: one
 * `pts_time,flags` line per packet, in decode order, with `K` among the
 * flags of a keyframe and `N/A` for a packet without a time.
 */
export const parseKeyframes = (output: string): number[] =>
  output
    .split('\n')
    .map((line) => line.trim().split(','))
    .filter(
      ([time, flags]) =>
        time !== '' &&
        time !== PACKET_REPORT.noTime &&
        (flags ?? '').includes(PACKET_REPORT.keyframe),
    )
    .map(([time]) => Number(time))
    .filter(Number.isFinite)
    .map(truncateToMilliseconds)
    .toSorted((a, b) => a - b)
