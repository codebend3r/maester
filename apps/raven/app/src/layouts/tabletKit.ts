import { deviceNavKind } from '@/platform/devicePlatform'
import { NAV_KINDS } from '@/platform/platform'

/**
 * Whether a touch page is laid out for an iPad, the device that moves by the side menu: its
 * header holds the search field, a library's main pages are tabs beside its name, every toolbar
 * chip keeps its words, and Settings runs the screen's width. Read at render, so a test can stand
 * in another device.
 */
export const isTabletLayout = (): boolean => deviceNavKind() === NAV_KINDS.drawer
