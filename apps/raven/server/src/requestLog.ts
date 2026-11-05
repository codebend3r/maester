import type { FastifyInstance } from 'fastify'

/** The environment the request log reads. */
export const REQUEST_LOG_ENV = { logRequests: 'RAVEN_LOG_REQUESTS' } as const

type RequestLogLineProps = {
  method: string
  url: string
  statusCode: number
  elapsedMs: number
}

/** One answered request as a line: `GET /api/home 200 12ms`. */
export const requestLogLine = ({
  method,
  url,
  statusCode,
  elapsedMs,
}: RequestLogLineProps): string =>
  `${method.padEnd(6)} ${url} ${statusCode} ${Math.round(elapsedMs)}ms`

type RegisterRequestLogProps = {
  fastify: FastifyInstance
  log: (line: string) => void
}

/** Logs every request once its answer has gone out. */
export const registerRequestLog = ({ fastify, log }: RegisterRequestLogProps): void => {
  fastify.addHook('onResponse', async (request, reply) => {
    log(
      requestLogLine({
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        elapsedMs: reply.elapsedTime,
      }),
    )
  })
}
