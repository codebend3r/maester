import { Logger } from '@nestjs/common'

// The tests that build the app pass `quiet`; this silences the services a
// test builds by hand too, whose warnings are the failures it asked for.
Logger.overrideLogger(false)
