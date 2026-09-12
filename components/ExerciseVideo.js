import { View, Text, Pressable, Linking, StyleSheet } from 'react-native'
import { WebView } from '@expo/dom-webview'

// A YouTube demo video for an exercise, played inline.
//
// It loads YouTube's own embed page as the webview's document rather than an
// iframe inside a local page: YouTube refuses embeds that arrive without a
// referrer, and a page served from file:// (which is what a published bundle
// is) has none. That refusal is the "Video player configuration error" (153).
//
// The webview cannot open new windows, so links out of the player, such as
// "Watch on YouTube", are caught inside the page and handed to the phone,
// which opens the YouTube app or the browser. @expo/dom-webview ships with
// SDK 57, so none of this needs a native rebuild.

const COLOR = '#6366f1'

const CATCH_LINKS = `
(function () {
  function send(url) { try { window.ReactNativeWebView.postMessage(String(url)) } catch (e) {} }
  window.open = function (url) { send(url); return null }
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a') : null
    if (!a || !a.href) return
    if (/youtube\\.com\\/watch|youtu\\.be\\/|youtube\\.com\\/(channel|@|c\\/)/.test(a.href)) {
      e.preventDefault()
      e.stopPropagation()
      send(a.href)
    }
  }, true)
})();
true;
`

export default function ExerciseVideo({ videoId, height = 210, style }) {
  if (!videoId) return null
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`
  const open = url => Linking.openURL(url).catch(() => {})
  return (
    <View style={style}>
      <View style={[v.box, { height }]}>
        <WebView
          source={{ uri: `https://www.youtube.com/embed/${videoId}?playsinline=1&rel=0&modestbranding=1` }}
          style={v.web}
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          scrollEnabled={false}
          bounces={false}
          injectedJavaScript={CATCH_LINKS}
          onMessage={e => { const url = e?.nativeEvent?.data; if (url) open(url) }}
        />
      </View>
      <Pressable onPress={() => open(watchUrl)} style={v.openBtn} hitSlop={6}>
        <Text style={v.openText}>▶  Open on YouTube</Text>
      </Pressable>
    </View>
  )
}

const v = StyleSheet.create({
  box: { width: '100%', borderRadius: 14, overflow: 'hidden', backgroundColor: '#000' },
  web: { flex: 1, backgroundColor: '#000' },
  openBtn: { alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 2 },
  openText: { fontSize: 12.5, fontWeight: '700', color: COLOR },
})
