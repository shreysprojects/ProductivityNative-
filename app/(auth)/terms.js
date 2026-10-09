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

export default function Terms() {
  const { theme } = useTheme()
  const insets = useSafeAreaInsets()

  return (
    <View style={[s.page, { backgroundColor: theme.bg }]}>
      <View style={[s.header, { paddingTop: insets.top + 8, borderBottomColor: theme.divider, backgroundColor: theme.header }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={s.backBtn}>
          <Text style={[s.backText, { color: theme.accent }]}>← Back</Text>
        </Pressable>
        <Text style={[s.title, { color: theme.text }]} numberOfLines={1}>Terms &amp; Conditions</Text>
        <View style={s.headerRight} />
      </View>

      <ScrollView
        style={s.scroll}
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[s.meta, { color: theme.muted }]}>Effective 5 August 2026 · Last updated 5 August 2026</Text>

        <P>
          These terms are the agreement between you and LifeLayer. By creating an account you accept them, so
          please read them. You must be 13 or older to use LifeLayer.
        </P>

        <Section title="LifeLayer is not medical advice">
          <P>
            LifeLayer provides general productivity, fitness and wellness information.{' '}
            <Text style={s.strong}>It is not medical, nutritional, or health advice.</Text>
          </P>
          <P>
            Calorie and macro targets, workout suggestions and AI-generated recommendations are estimates for
            general guidance only. Talk to a qualified professional before acting on anything you see here,
            especially if you have a medical condition or injury, are pregnant, or are making significant changes
            to your diet or training. Never ignore or delay professional advice because of something in this app.
          </P>
        </Section>

        <Section title="Your account">
          <P>
            You are responsible for keeping your login details secure and for everything that happens under your
            account. Please give accurate information when you sign up, and keep it to one account per person.
          </P>
        </Section>

        <Section title="Acceptable use: zero tolerance">
          <P>
            <Text style={s.strong}>
              LifeLayer has zero tolerance for objectionable content and abusive behaviour.
            </Text>{' '}
            You may not post, share or send content that is:
          </P>
          <Bullet>Sexual or sexually explicit</Bullet>
          <Bullet>Violent, or that threatens or encourages violence</Bullet>
          <Bullet>Hateful, harassing, bullying or discriminatory</Bullet>
          <Bullet>Illegal, or that promotes illegal activity</Bullet>
          <Bullet>Spam, scams or repetitive promotional content</Bullet>
          <Bullet>Someone's personal contact information, including your own</Bullet>
          <P>
            All public content is filtered automatically before it is posted and may also be reviewed by us. Every
            post and shared routine can be <Text style={s.strong}>reported</Text>, and you can{' '}
            <Text style={s.strong}>block</Text> any user so you no longer see their content and they can no longer
            reach you.
          </P>
          <P>
            <Text style={s.strong}>
              We review every report and remove violating content and terminate the accounts responsible within 24
              hours.
            </Text>{' '}
            Abusive users may be removed without notice.
          </P>
        </Section>

        <Section title="Your content">
          <P>
            What you create stays yours. To make the app work, you give LifeLayer a limited licence to store your
            content and display it back to you, and to show anything you choose to share with the other users you
            share it with. That licence ends when you delete the content or your account.
          </P>
          <P>
            You are responsible for what you post, and you must have the right to post it.
          </P>
        </Section>

        <Section title="AI features">
          <P>
            AI outputs are generated automatically. They can be inaccurate, incomplete or unsuitable for you, and
            must not be relied on as professional advice. Usage limits apply to AI features, and the features
            themselves may change or be withdrawn.
          </P>
        </Section>

        <Section title="Availability and liability">
          <P>
            LifeLayer is provided "as is" and "as available", without warranties of any kind. We do not guarantee
            uninterrupted access, and we cannot guarantee that data will never be lost, so please keep your own
            copies of anything important to you.
          </P>
          <P>
            To the extent the law allows, we are not liable for indirect or consequential damages arising from
            your use of the app.
          </P>
        </Section>

        <Section title="Ending your account">
          <P>
            You can delete your account at any time in Settings, which permanently removes your data. We may
            suspend or terminate accounts that break these terms.
          </P>
        </Section>

        <Section title="Changes to these terms">
          <P>
            If these terms change we will post the update on this page. Continuing to use LifeLayer after that
            means you accept the new terms.
          </P>
        </Section>

        <Section title="Governing law">
          <P>
            These terms are governed by the laws of Ontario, Canada.
          </P>
        </Section>

        <Section title="Contact">
          <P>
            Questions about these terms: jainshrey012@gmail.com.
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
