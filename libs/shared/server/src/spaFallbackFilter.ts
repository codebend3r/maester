import { readFile } from 'node:fs/promises'
import { type ArgumentsHost, Catch, type ExceptionFilter, NotFoundException } from '@nestjs/common'
import type { FastifyReply, FastifyRequest } from 'fastify'

/**
 * Client-side routes have no file behind them, so any GET outside the
 * server's own prefixes that would 404 gets the web app's index.html and the
 * router takes it from there. A miss under a server prefix stays a JSON 404.
 * The file is read on each request rather than once at boot: it is tiny, and
 * a rebuilt web app under a running server would otherwise be served a page
 * whose hashed assets are gone.
 */
@Catch(NotFoundException)
export class SpaFallbackFilter implements ExceptionFilter {
  private readonly indexPath: string | null
  private readonly serverPrefixes: readonly string[]

  constructor({
    indexPath,
    serverPrefixes,
  }: {
    indexPath: string | null
    serverPrefixes: readonly string[]
  }) {
    this.indexPath = indexPath
    this.serverPrefixes = serverPrefixes
  }

  catch(exception: NotFoundException, host: ArgumentsHost): void {
    const http = host.switchToHttp()
    const request = http.getRequest<FastifyRequest>()
    const reply = http.getResponse<FastifyReply>()
    const isApp =
      request.method === 'GET' &&
      !this.serverPrefixes.some((prefix) => request.url.startsWith(prefix))

    const notFound = () => void reply.code(404).send(exception.getResponse())
    if (this.indexPath == null || !isApp) return notFound()

    readFile(this.indexPath, 'utf8').then(
      (html) =>
        void reply
          .code(200)
          .header('content-type', 'text/html; charset=utf-8')
          .header('cache-control', 'no-cache')
          .send(html),
      notFound,
    )
  }
}
