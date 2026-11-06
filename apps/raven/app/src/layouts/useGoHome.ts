import { useRouter } from 'expo-router'

import { APP_ROUTES } from '@/routes'

/** Back to Home, taking the screens above it off the stack rather than stacking another. */
export const useGoHome = (): (() => void) => {
  const router = useRouter()
  return () => router.dismissTo(APP_ROUTES.home)
}
