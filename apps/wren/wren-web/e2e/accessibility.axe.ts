import { defineAxeSuite } from '@tooling/web/axe'
import { WREN_ROUTES } from '@/routes'

defineAxeSuite({
  paths: [WREN_ROUTES.home, WREN_ROUTES.library, WREN_ROUTES.search, WREN_ROUTES.settings],
})
