import type { BufferConfig } from 'react-native-video'

/**
 * How much ExoPlayer holds ahead of the picture. The library has it buffer its minimum, 50
 * seconds, whatever they weigh, and 50 seconds of a 4K remux at 69 Mbit/s is about 430 MB, more
 * than the Google TV Streamer's 384 MB heap: the app spent its time collecting garbage and died of
 * an `OutOfMemoryError` two minutes in. With a 15 second minimum ExoPlayer's own byte budget
 * (about 150 MB) holds past it, so a heavy file buffers what fits and a light one still 50
 * seconds. The library's `DependingOnMemory` strategy is no way out: it forces a garbage
 * collection on the playback thread about once a second. AVPlayer reads none of it.
 */
export const PLAYER_BUFFER = {
  minBufferMs: 15_000,
} as const satisfies BufferConfig
