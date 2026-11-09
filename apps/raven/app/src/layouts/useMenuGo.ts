import { usePathname, useRouter } from 'expo-router'

import { menuMoveOf } from '@/layouts/touchMenuKit'
import { APP_ROUTES, type Href } from '@/routes'

/**
 * How a menu entry or a tab goes to its page, the iPad's side menu and the iPhone's tab bar
 * alike: Home takes the screens above it off the stack, anything else is pushed on Home and
 * takes the page's place elsewhere, and the page already showing is left as it is.
 */
export const useMenuGo = (): ((href: Href) => void) => {
  const router = useRouter()
  const pathname = usePathname()
  return (href: Href) => {
    if (href.pathname === APP_ROUTES.home) {
      router.dismissTo(APP_ROUTES.home)
      return
    }
    if (href.pathname === pathname) return
    router[menuMoveOf({ pathname })](href)
  }
}
