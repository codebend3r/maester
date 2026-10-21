import { mediaMutationsFor } from '@raven/ui/headless'
import { api } from '@/lib/api'

export const { useMediaMutations } = mediaMutationsFor({ api })
