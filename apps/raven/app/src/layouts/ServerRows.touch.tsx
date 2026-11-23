import { Icon } from '@raven/native'
import { hasSeveralServers } from '@raven/native/headless'
import { Pressable, StyleSheet, View } from 'react-native'

import { SERVER_SWITCHER_COPY } from '@/layouts/copy'
import { Text } from '@/layouts/Text'
import { useActiveServer } from '@/stores/activeServer'
import { OPACITIES, SIZES } from '@/theme/appTheme'
import { APP_ICONS } from '@/theme/icons'
import { themedStyles, useTheme } from '@/theme/useTheme'

type ServerRowsProps = {
  /** Hears a server picked once it is the one in use, so the menu can shut and open its Home. */
  onChosen: () => void
}

/**
 * The menus' server switcher under the thumb, as the web's: every server on the list under
 * their heading, the one in use checked. Picking another switches to it, and the menu opens its
 * Home, since the page open was the last server's. Nothing is drawn while there is one server.
 */
export const ServerRows = ({ onChosen }: ServerRowsProps) => {
  const servers = useActiveServer((state) => state.servers)
  const activeId = useActiveServer((state) => state.activeId)
  const activate = useActiveServer((state) => state.activate)
  const text = useTheme((theme) => theme.palette.text)
  const styles = useStyles()
  const choose = (id: string) => {
    if (id !== activeId) activate(id)
    onChosen()
  }
  return (
    hasSeveralServers({ servers }) && (
      <View style={styles.rows}>
        <Text accessibilityRole="header" style={styles.heading}>
          {SERVER_SWITCHER_COPY.servers}
        </Text>
        {servers.map((server) => {
          const isActive = server.id === activeId
          return (
            <Pressable
              key={server.id}
              accessibilityLabel={
                isActive
                  ? SERVER_SWITCHER_COPY.inUse(server.name)
                  : SERVER_SWITCHER_COPY.row(server.name)
              }
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
              onPress={() => choose(server.id)}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              <Icon colour={text} name={APP_ICONS.globe} size={SIZES.textXl} />
              <Text numberOfLines={1} style={styles.name}>
                {server.name}
              </Text>
              {isActive && <Icon colour={text} name={APP_ICONS.check} size={SIZES.text} />}
            </Pressable>
          )
        })}
      </View>
    )
  )
}

const useStyles = themedStyles((colours) =>
  StyleSheet.create({
    rows: { gap: SIZES.space1 },
    heading: {
      color: colours.muted,
      fontSize: SIZES.textSm,
      fontWeight: '600',
      paddingTop: SIZES.space2,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SIZES.space2,
      minHeight: SIZES.fieldHeight,
      borderRadius: SIZES.radius,
    },
    name: { flexShrink: 1, color: colours.text, fontSize: SIZES.textLg, fontWeight: '600' },
    pressed: { opacity: OPACITIES.pressed },
  }),
)
