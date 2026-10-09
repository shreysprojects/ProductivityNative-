import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native'
import { router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../../lib/ThemeContext'

function Section({ title, children }) {
  const { theme } = useTheme()
  return (
    <View style={s.section}>
      <Text style={[s.h2, { color: theme.text }]}>{title}</Text>
      {children}
    </View>
  )
}

function P({ children }) {
  const { theme } = useTheme()
  return <Text style={[s.p, { color: theme.subtext }]}>{children}</Text>
}

function Bullet({ children }) {
  const { theme } = useTheme()
  return (
    <View style={s.bulletRow}>
      <Text style={[s.p, s.dot, { color: theme.accent }]}>•</Text>
      <Text style={[s.p, s.bulletText, { color: theme.subtext }]}>{children}</Text>
    </View>
  )
}

export default function Privacy() {
  const { theme } = useTheme()
  const insets = useSafeAreaInsets()

  return (
    <View style={[s.page, { backgroundColor: theme.bg }]}>
      <View style={[s.header, { paddingTop: insets.top + 8, borderBottomColor: theme.divider, backgroundColor: theme.header }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={s.backBtn}>
          <Text style={[s.backText, { color: theme.accent }]}>← Back</Text>
        </Pressable>
        <Text style={[s.title, { color: theme.text }]} numberOfLines={1}>Privacy Policy</Text>
        <View style={s.headerRight} />
      </View>

      <ScrollView
        style={s.scroll}
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[s.meta, { color: theme.muted }]}>Effective 25 August 2026 · Last updated 25 August 2026</Text>

        <P>
          LifeLayer is a personal productivity and fitness app. This policy explains what we collect, why we
          collect it, and what control you have over it. We have tried to keep it short and readable.
        </P>
        <P>
          LifeLayer is run by a single independent developer. You can reach us any time at jainshrey012@gmail.com.
        </P>

        <Section title="Information you give us">
          <P>
            <Text style={s.strong}>Account details.</Text> Your email address, display name, username, and
            optionally your age. We use these to create your account, keep it secure, and let friends find you.
            Sign-in is handled by Supabase, our authentication and database provider, and you can sign in with
            email and password, Google, or Apple.
          </P>
          <P>
            <Text style={s.strong}>Health and fitness details you enter.</Text> Depending on the features you
            use, this can include:
          </P>
          <Bullet>Weight, height, age, biological sex, activity level and goals</Bullet>
          <Bullet>Workouts, exercises and sets</Bullet>
          <Bullet>Meals and macros</Bullet>
          <Bullet>Routines and streaks</Bullet>
          <Bullet>Journal entries</Bullet>
          <P>
            We use this only to power the features you are using: calculating your calorie and macro targets,
            showing your progress, and keeping your streaks accurate.
          </P>
          <P>
            <Text style={s.strong}>Photos.</Text> You are never required to add a photo. If you choose to, there
            are four cases. A profile picture is uploaded and visible to other users. Fitness progress and
            workout photos <Text style={s.strong}>stay on your device and are never uploaded</Text> anywhere.
            Photos you attach to a routine task or step are uploaded to our app's cloud storage (a Supabase
            storage bucket) so they follow you across devices; you can keep up to 10 of these, and you can
            delete any of them at any time. A selfie used for the AI skin and hair analysis is sent for that
            one analysis only, as described below.
          </P>
        </Section>

        <Section title="AI features and third-party processing">
          <P>
            Some features are powered by AI: routine generation, routine advice,
            importing a workout from a screenshot, importing a class schedule from a screenshot of your
            timetable, and skin and hair analysis. When you use one of these, the relevant text or image is sent
            through our secure server to OpenAI for one-time processing, and the result comes back to you.
          </P>
          <P>
            <Text style={s.strong}>We do not store those images or inputs after the request finishes.</Text>{' '}
            OpenAI processes them as our service provider so that we can return your result.
          </P>
          <P>
            Content you post publicly, and profile pictures, are automatically screened for safety before they go
            live. That screening uses the same provider.
          </P>
        </Section>

        <Section title="What other people can see">
          <P>
            Routines and posts you choose to share are public inside the app, along with your username, display
            name, bio and profile picture, and your age or gender if you have chosen to show them.
          </P>
          <P>
            Everything else is private by default. Your logs, meals, journal entries and progress are visible only
            to friends you have accepted, or to nobody at all, depending on your visibility setting. You can change
            that setting at any time.
          </P>
        </Section>

        <Section title="Where your data is stored and how it is protected">
          <P>
            Your data is stored with Supabase, a hosted Postgres platform, and protected by per-user row-level
            security. That means the database itself enforces that you can only read your own data plus whatever
            you have explicitly chosen to share.
          </P>
          <P>
            Your sign-in session is stored in your device's secure keychain, and all traffic between the app and
            our servers is encrypted in transit.
          </P>
        </Section>

        <Section title="What we do not do">
          <Bullet>No advertising</Bullet>
          <Bullet>No analytics or tracking SDKs</Bullet>
          <Bullet>No selling or sharing your data with data brokers</Bullet>
          <Bullet>No tracking you across other apps or websites, ever</Bullet>
        </Section>

        <Section title="Your choices and rights">
          <Bullet>Edit or delete any of your content at any time.</Bullet>
          <Bullet>Change who can see your data from your privacy settings.</Bullet>
          <Bullet>
            Delete your account and all associated data from inside the app, in Settings → Delete Account. This is
            immediate and permanent.
          </Bullet>
          <Bullet>Request a copy of your data by emailing jainshrey012@gmail.com.</Bullet>
        </Section>

        <Section title="Children">
          <P>
            LifeLayer is not intended for anyone under 13. You must be 13 or older to create an account, and we do
            not knowingly collect data from children under 13. If you believe a child under 13 has created an
            account, email us and we will remove it.
          </P>
        </Section>

        <Section title="How long we keep your data">
          <P>
            We keep your data for as long as your account exists. When you delete your account, the data is deleted
            with it.
          </P>
        </Section>

        <Section title="Changes to this policy">
          <P>
            If this policy changes, we will update this page and the "Last updated" date at the top.
          </P>
          <P>
            25 August 2026: Updated to describe routine photo storage and AI chat features.
          </P>
        </Section>

        <Section title="Contact">
          <P>
            Questions, requests, or concerns: jainshrey012@gmail.com.
          </P>
        </Section>
      </ScrollView>
    </View>
  )
}

const s = StyleSheet.create({
  page: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { minWidth: 70 },
  backText: { fontSize: 16, fontWeight: '600' },
  title: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700' },
  headerRight: { minWidth: 70 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 18 },
  meta: { fontSize: 13, fontWeight: '600', marginBottom: 16 },
  section: { marginTop: 26 },
  h2: { fontSize: 17, fontWeight: '700', marginBottom: 10 },
  p: { fontSize: 15, lineHeight: 23, marginBottom: 12 },
  strong: { fontWeight: '700' },
  bulletRow: { flexDirection: 'row', paddingRight: 4 },
  dot: { width: 18, marginBottom: 8 },
  bulletText: { flex: 1, marginBottom: 8 },
})
