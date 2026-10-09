import { useState, useEffect } from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { Tabs, Redirect } from 'expo-router'
import { useAuth } from '../../lib/AuthContext'
import { useTheme } from '../../lib/ThemeContext'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { getSections, onSectionsChange, DEFAULT_SECTIONS } from '../../lib/sectionsStorage'

const TABS = [
  { name: 'index',    label: 'Routines',  icon: 'today-outline',       iconActive: 'today' },
  // Meals is always shown: the BOTTOM TABS toggle group in Settings is hidden,
  // so no sectionKey here — a stale `tabMeals: false` can't make it vanish.
  { name: 'meals',    label: 'Meals',     icon: 'restaurant-outline',  iconActive: 'restaurant' },
  // HIDDEN for now (not deleted) — restore by uncommenting:
  // { name: 'explore',  label: 'Explore',   icon: 'compass-outline',     iconActive: 'compass',    sectionKey: 'tabExplore' },
  { name: 'calendar', label: 'Calendar',  icon: 'calendar-outline',    iconActive: 'calendar',   sectionKey: 'tabCalendar' },
  { name: 'settings', label: 'Settings',  icon: 'settings-outline',    iconActive: 'settings' },
]

function CustomTabBar({ state, navigation, theme, sections }) {
  const insets = useSafeAreaInsets()
  const visibleTabs = TABS.filter(t => !t.sectionKey || sections[t.sectionKey] !== false)

  return (
    <View style={[tb.bar, {
      backgroundColor: theme.tabBar,
      paddingBottom: Math.max(insets.bottom, 10),
    }]}>
      {visibleTabs.map((tab) => {
        const routeIndex = state.routes.findIndex(r => r.name === tab.name)
        if (routeIndex === -1) return null
        const focused = state.index === routeIndex

        return (
          <Pressable
            key={tab.name}
            style={tb.item}
            onPress={() => { if (!focused) navigation.navigate(tab.name) }}
          >
            <View style={[tb.pill, focused && {
                backgroundColor: theme.accent + '22',
                borderColor: theme.accent,
              }]}>
              <Ionicons
                name={focused ? tab.iconActive : tab.icon}
                size={23}
                color={focused ? theme.accent : theme.muted}
              />
            </View>
            <Text style={[tb.label, { color: focused ? theme.accent : theme.muted }]}>
              {tab.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

const tb = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    paddingTop: 10,
    elevation: 0,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    gap: 5,
  },
  pill: {
    width: 56,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
})

export default function TabsLayout() {
  const { user, loading, profile, profileLoading, profileError } = useAuth()
  const { theme } = useTheme()
  const [sections, setSections] = useState({ ...DEFAULT_SECTIONS })
  const userId = user?.id ?? null

  useEffect(() => {
    if (!userId) return
    getSections(userId).then(setSections)
    return onSectionsChange(setSections)
  }, [userId])

  if (loading) return null
  if (!user) return <Redirect href="/(auth)/login" />
  // Set-up is only for a profile known to be missing or to have no username
  // yet (sign-up makes a row without one; Google and Apple accounts start
  // that way). A profile that could not be READ is not missing: sending
  // those users to set-up renamed the account and wiped its bio and photo.
  if (!profileLoading && !profileError && !profile?.username) {
    return <Redirect href="/(auth)/complete-profile" />
  }

  return (
    <Tabs
      tabBar={(props) => <CustomTabBar {...props} theme={theme} sections={sections} />}
      screenOptions={{
        headerStyle: { backgroundColor: theme.header },
        headerShadowVisible: false,
        headerTintColor: theme.text,
        headerTitleStyle: { fontWeight: '700', fontSize: 17 },
        sceneStyle: { backgroundColor: theme.bg },
      }}
    >
      <Tabs.Screen name="index"    options={{ title: 'My Routines' }} />
      <Tabs.Screen name="meals"    options={{ title: 'Meals' }} />
      <Tabs.Screen name="calendar" options={{ title: 'Calendar' }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
      <Tabs.Screen name="explore"  options={{ title: 'Explore Routines' }} />
    </Tabs>
  )
}
