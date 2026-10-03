import { readFile } from 'node:fs/promises'
import { type ArgumentsHost, Catch, type ExceptionFilter, NotFoundException } from '@nestjs/common'
import type { FastifyReply, FastifyRequest } from 'fastify'

/**
 * Client-side routes (/library/3, /watch/42) have no file behind them, so
 * any GET outside /api that would 404 gets the web app's index.html and the
 * router takes it from there. API 404s stay JSON. The file is read on each
 * request rather than once at boot: it is tiny, and a rebuilt web app under
 * a running server would otherwise be served a page whose hashed assets are
 * gone.
 */
@Catch(NotFoundException)
export class SpaFallbackFilter implements ExceptionFilter {
  constructor(private readonly indexPath: string | null) {}

  catch(exception: NotFoundException, host: ArgumentsHost): void {
    const http = host.switchToHttp()
    const request = http.getRequest<FastifyRequest>()
    const reply = http.getResponse<FastifyReply>()
    const isApp = request.method === 'GET' && !request.url.startsWith('/api/')

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
