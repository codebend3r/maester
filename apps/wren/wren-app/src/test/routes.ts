import { WREN_ROUTE_PARAMS, type pageHref } from '@/routes'

type PagePathOfProps = {
  page: Parameters<typeof pageHref>[0]['page']
  /** The id in the path; a word for a test of an address that names no id. */
  id: number | string
}

/** A page's address as a test opens it: its route with the id put in, `/album/7`. */
export const pagePathOf = ({ page, id }: PagePathOfProps): string =>
  page.replace(`[${WREN_ROUTE_PARAMS.id}]`, String(id))
