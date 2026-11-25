/**
 * Where raven is, as Settings shows it: the origin the build names when this page's `/api` is a
 * proxy to it (Netlify's), port included, else the page's own origin, which is then raven's or
 * the dev server's in front of it. An unset origin is built in as an empty string.
 */
export const serverAddress = (): string => import.meta.env.VITE_API_ORIGIN || window.location.origin
