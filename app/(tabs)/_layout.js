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
  // HIDDEN for now (not deleted) — restore by uncommenting:
  // { name: 'meals',    label: 'Nutrition', icon: 'restaurant-outline',  iconActive: 'restaurant', sectionKey: 'tabMeals' },
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
  const { user, loading, profile, profileLoading } = useAuth()
  const { theme } = useTheme()
  const [sections, setSections] = useState({ ...DEFAULT_SECTIONS })

  useEffect(() => {
    if (!user) return
    getSections(user.id).then(setSections)
    return onSectionsChange(setSections)
  }, [user])

  if (loading) return null
  if (!user) return <Redirect href="/(auth)/login" />
  if (!profileLoading && !profile) return <Redirect href="/(auth)/complete-profile" />

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
      <Tabs.Screen name="meals"    options={{ title: 'Nutrition' }} />
      <Tabs.Screen name="calendar" options={{ title: 'Calendar' }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
      <Tabs.Screen name="explore"  options={{ title: 'Explore Routines' }} />
    </Tabs>
  )
}
