import { defineAxeSuite } from '@tooling/web/axe'
import { APP_PATHS } from '@/lib/appPaths'

defineAxeSuite({
  paths: [
    APP_PATHS.home,
    APP_PATHS.libraries,
    APP_PATHS.favourites,
    APP_PATHS.history,
    APP_PATHS.comingSoon,
    APP_PATHS.settings,
  ],
})
