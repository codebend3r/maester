import { GlobalRegistrator } from '@happy-dom/global-registrator'
import HTMLElementConfig from 'happy-dom/lib/config/HTMLElementConfig'

type RegisterHappyDomProps = {
  /** The page's address, whose origin a relative fetch and a cookie belong to. */
  url: string
}

/**
 * Bun test has no DOM by default. This registers happy-dom's globals (window, document, etc.);
 * raven's web app and Wren's call it from the first file their `bunfig.toml` preloads, before any
 * test module, or Testing Library, evaluates.
 */
export const registerHappyDom = ({ url }: RegisterHappyDomProps): void => {
  GlobalRegistrator.register({ url })
  /*
   * happy-dom does not know <search>, so it makes an HTMLUnknownElement and React warns the tag
   * is unrecognized. It is a plain HTMLElement holding flow content, as <section> is.
   */
  Object.assign(HTMLElementConfig, { search: HTMLElementConfig.section })
}
