import type { CuePicture, PictureCue } from '@raven/core'

/** A width and a height: the screen's, or a picture cue's canvas. */
export type FrameSize = { width: number; height: number }

/** Where a picture is drawn in the frame, in the frame's own points. */
type Placed = { left: number; top: number; width: number; height: number }

type PlacedPictureOfProps = {
  /** The room the video is fitted into: the player's whole view. */
  frame: FrameSize
  canvas: PictureCue['canvas']
  picture: Pick<CuePicture, 'x' | 'y' | 'width' | 'height'>
}

/**
 * Where one picture of a picture cue sits over the video. The disc places its subtitles on a
 * canvas the shape of its own frame, with the film centred in it, so the canvas is fitted
 * whole into the view and centred, as the video is: a film cropped to its picture keeps its
 * subtitles where the disc put them, in the bars when that is where they were. A canvas or a
 * frame with no size places nothing.
 */
export const placedPictureOf = ({
  frame,
  canvas,
  picture,
}: PlacedPictureOfProps): Placed | null => {
  if (canvas.width <= 0 || canvas.height <= 0 || frame.width <= 0 || frame.height <= 0) return null
  const scale = Math.min(frame.width / canvas.width, frame.height / canvas.height)
  return {
    left: (frame.width - canvas.width * scale) / 2 + picture.x * scale,
    top: (frame.height - canvas.height * scale) / 2 + picture.y * scale,
    width: picture.width * scale,
    height: picture.height * scale,
  }
}
