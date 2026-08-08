import { Component } from 'react'
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native'

// A crash anywhere below this renders a blank screen otherwise — React unmounts
// the whole tree and there is nothing left to draw. Showing the error means a
// broken build is reportable instead of just "the app won't open".
export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <View style={s.page}>
        <ScrollView contentContainerStyle={s.content}>
          <Text style={s.emoji}>😵‍💫</Text>
          <Text style={s.title}>Something went wrong</Text>
          <Text style={s.sub}>
            The app hit an error it couldn't recover from. Tap below to try again — if it
            keeps happening, the message underneath says what broke.
          </Text>

          <Pressable style={s.btn} onPress={() => this.setState({ error: null })}>
            <Text style={s.btnText}>Try again</Text>
          </Pressable>

          <View style={s.detailBox}>
            <Text style={s.detailText} selectable>
              {String(error?.message ?? error)}
            </Text>
          </View>
        </ScrollView>
      </View>
    )
  }
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#12121f' },
  content: { flexGrow: 1, justifyContent: 'center', padding: 28 },
  emoji: { fontSize: 44, textAlign: 'center', marginBottom: 14 },
  title: { fontSize: 22, fontWeight: '800', color: '#fff', textAlign: 'center', letterSpacing: -0.3 },
  sub: {
    fontSize: 14, lineHeight: 21, color: '#a9a9c4',
    textAlign: 'center', marginTop: 10, marginBottom: 24,
  },
  btn: {
    backgroundColor: '#5c5ef0', borderRadius: 16,
    paddingVertical: 15, alignItems: 'center',
  },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  detailBox: {
    marginTop: 24, padding: 14, borderRadius: 12,
    backgroundColor: '#1c1c32', borderWidth: 1, borderColor: '#2e2e4d',
  },
  detailText: { color: '#ff8f8f', fontSize: 12, lineHeight: 18, fontFamily: 'Courier' },
})
