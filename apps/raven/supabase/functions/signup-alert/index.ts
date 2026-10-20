import nodemailer from 'nodemailer'
import { ALERT_ENV, handleSignupAlert } from '@/alert'

// Edge Functions refuse outbound SMTP on ports 25 and 587, so this uses implicit TLS on 465.
const SMTP_PORT = 465

const readEnv = (name: (typeof ALERT_ENV)[keyof typeof ALERT_ENV]) => {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`${name} is not set`)
  return value
}

const secret = readEnv(ALERT_ENV.secret)
const recipient = readEnv(ALERT_ENV.recipient)
const sender = readEnv(ALERT_ENV.smtpUser)
const webUrl = readEnv(ALERT_ENV.webUrl)

const transport = nodemailer.createTransport({
  host: readEnv(ALERT_ENV.smtpHost),
  port: SMTP_PORT,
  secure: true,
  auth: { user: sender, pass: readEnv(ALERT_ENV.smtpPass) },
})

Deno.serve((request) =>
  handleSignupAlert({
    request,
    secret,
    webUrl,
    send: async ({ subject, text }) => {
      await transport.sendMail({ from: sender, to: recipient, subject, text })
    },
  }),
)
