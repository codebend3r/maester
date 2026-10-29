import type { LoadingKit, LoadingProps } from '@/layouts/loadingKit'
import { LoadingMark } from '@/layouts/LoadingMark'
import { TV_SIZES } from '@/theme/tvSizes'

/** A TV's loading screen, read from across the room; Back is the remote's own key. */
const Loading = ({ label }: LoadingProps) => (
  <LoadingMark gap={TV_SIZES.space5} label={label} markWidth={TV_SIZES.space8 * 2} />
)

export const focusLoading: LoadingKit = { Loading }
