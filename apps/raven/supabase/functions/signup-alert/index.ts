import { createTransport } from 'nodemailer'
import { handleMemberMail } from '@/alert'

const ALERT_ENV = {
  secret: 'SIGNUP_ALERT_SECRET',
  recipient: 'SIGNUP_ALERT_TO',
  smtpHost: 'SMTP_HOST',
  smtpUser: 'SMTP_USER',
  smtpPass: 'SMTP_PASS',
  webUrl: 'RAVEN_WEB_URL',
} as const

// Edge Functions refuse outbound SMTP on ports 25 and 587, so this uses implicit TLS on 465.
const SMTP_PORT = 465

// raven web's ADMIN_PATH, where the owner's Users section approves and removes members.
const ADMIN_PATH = '/admin'

// raven web's home, which asks a signed-out member to sign in.
const HOME_PATH = '/'

const readEnv = (name: (typeof ALERT_ENV)[keyof typeof ALERT_ENV]) => {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`${name} is not set`)
  return value
}

const secret = readEnv(ALERT_ENV.secret)
const recipient = readEnv(ALERT_ENV.recipient)
const sender = readEnv(ALERT_ENV.smtpUser)
const webUrl = readEnv(ALERT_ENV.webUrl)
const links = { admin: new URL(ADMIN_PATH, webUrl).href, signIn: new URL(HOME_PATH, webUrl).href }

const transport = createTransport({
  host: readEnv(ALERT_ENV.smtpHost),
  port: SMTP_PORT,
  secure: true,
  auth: { user: sender, pass: readEnv(ALERT_ENV.smtpPass) },
})

Deno.serve((request) =>
  handleMemberMail({
    request,
    secret,
    owner: recipient,
    links,
    send: async ({ to, subject, text, html }) => {
      await transport.sendMail({ from: sender, to, subject, text, html })
    },
  }),
)
