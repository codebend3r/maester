import { jest } from '@jest/globals'
import { ActionSheetIOS } from 'react-native'

type AnswerSheetProps = { answer: string }

/** What a sheet showed: its title, the line under it, and its options. */
type ShownSheet = { title: string | null; message: string | null; options: string[] }

/** Answers every action sheet the screen opens with `answer`, and keeps all each showed. */
export const answerSheetShown = ({ answer }: AnswerSheetProps): ShownSheet[] => {
  const shown: ShownSheet[] = []
  jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation((options, done) => {
    shown.push({
      title: options.title ?? null,
      message: options.message ?? null,
      options: options.options,
    })
    done(options.options.indexOf(answer))
  })
  return shown
}

/** Answers every action sheet the screen opens with `answer`, and keeps what each offered. */
export const answerSheet = ({ answer }: AnswerSheetProps): string[][] => {
  const offered: string[][] = []
  jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation((options, done) => {
    offered.push(options.options)
    done(options.options.indexOf(answer))
  })
  return offered
}
