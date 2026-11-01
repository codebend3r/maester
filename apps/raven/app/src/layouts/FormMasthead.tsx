import { View } from 'react-native'

import { FORM_COPY } from '@/layouts/copy'
import type { FormStyles } from '@/layouts/formStyles'
import { Logo } from '@/layouts/Logo'
import { Text, TEXT_VARIANTS } from '@/layouts/Text'

type FormMastheadProps = {
  title: string
  logoWidth: number
  formStyles: FormStyles
}

/**
 * What tops every form: the mark, the name in the display font as the page's heading, and the
 * step's own title under it.
 */
export const FormMasthead = ({ title, logoWidth, formStyles }: FormMastheadProps) => (
  <View style={formStyles.masthead}>
    <Logo width={logoWidth} />
    <Text variant={TEXT_VARIANTS.display} accessibilityRole="header" style={formStyles.wordmark}>
      {FORM_COPY.wordmark}
    </Text>
    <Text style={formStyles.subtitle}>{title}</Text>
  </View>
)
