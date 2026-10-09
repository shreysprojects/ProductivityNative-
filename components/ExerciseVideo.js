import { useState, useEffect } from 'react'
import { View, Text, Pressable, Linking, ActivityIndicator, StyleSheet } from 'react-native'
import { Image } from 'expo-image'
import { WebView } from '@expo/dom-webview'

// A YouTube demo video for an exercise.
//
// Shows the video's thumbnail with a play button first (plain image, always
// renders), and only builds the inline player when tapped.
//
// YouTube refuses an embed whose request has no Referer header: that is the
// "Video player configuration error" (153). A webview loading the embed URL
// directly sends none, a page served from a local file sends none, and
// Supabase relabels any HTML it hosts as plain text, so there is no page of
// ours to send one. The trick: the webview first loads a tiny youtube.com
// page (robots.txt), and a script hops from there to the embed URL. A
// navigation started by a page carries that page as its referrer, so the
// embed arrives from youtube.com and plays.
//
// The embed page pings back once loaded; if no ping arrives the box says so
// and offers YouTube instead of sitting black. The webview cannot open new
// windows, so links out of the player are caught and handed to the phone.
// @expo/dom-webview ships with SDK 57, so none of this needs a native rebuild.

const COLOR = '#6366f1'
const LOAD_TIMEOUT_MS = 10000
const BOOTSTRAP_URL = 'https://www.youtube.com/robots.txt'
const embedUrl = id => `https://www.youtube.com/embed/${id}?playsinline=1&rel=0&autoplay=1`

// Runs before the bootstrap page renders: hop to the embed straight away.
const hopScript = url => `
(function () {
  if (location.pathname === '/robots.txt') location.replace(${JSON.stringify(url)});
})();
true;
`

// Runs once the embed page has loaded: report in, and catch links out.
const PAGE_SCRIPT = `
(function () {
  if (location.pathname === '/robots.txt') return;
  function send(msg) { try { window.ReactNativeWebView.postMessage(String(msg)) } catch (e) {} }
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
  send('__loaded__')
})();
true;
`

export default function ExerciseVideo({ videoId, height = 210, style }) {
  const [playing, setPlaying] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!playing || loaded) return
    const t = setTimeout(() => setFailed(true), LOAD_TIMEOUT_MS)
    return () => clearTimeout(t)
  }, [playing, loaded])

  if (!videoId) return null
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`
  const open = url => Linking.openURL(url).catch(() => {})

  return (
    <View style={style}>
      <View style={[v.box, { height }]}>
        {!playing ? (
          <Pressable style={v.fill} onPress={() => setPlaying(true)}>
            <Image
              source={{ uri: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` }}
              style={v.fill}
              contentFit="cover"
              transition={150}
            />
            <View style={v.playBadge}>
              <Text style={v.playIcon}>▶</Text>
            </View>
          </Pressable>
        ) : failed ? (
          <View style={[v.fill, v.failWrap]}>
            <Text style={v.failText}>The player couldn't load here.</Text>
            <Pressable style={v.failBtn} onPress={() => open(watchUrl)}>
              <Text style={v.failBtnText}>Watch on YouTube</Text>
            </Pressable>
          </View>
        ) : (
          <View style={v.fill}>
            <WebView
              source={{ uri: BOOTSTRAP_URL }}
              style={v.web}
              allowsInlineMediaPlayback
              mediaPlaybackRequiresUserAction={false}
              scrollEnabled={false}
              bounces={false}
              injectedJavaScriptBeforeContentLoaded={hopScript(embedUrl(videoId))}
              injectedJavaScript={PAGE_SCRIPT}
              onMessage={e => {
                const data = e?.nativeEvent?.data
                if (data === '__loaded__') setLoaded(true)
                else if (/^https?:\/\//.test(String(data ?? ''))) open(data)
              }}
            />
            {!loaded && (
              <View style={v.spinner} pointerEvents="none">
                <ActivityIndicator color="#fff" />
              </View>
            )}
          </View>
        )}
      </View>
      <Pressable onPress={() => open(watchUrl)} style={v.openBtn} hitSlop={6}>
        <Text style={v.openText}>▶  Open on YouTube</Text>
      </Pressable>
    </View>
  )
}

const v = StyleSheet.create({
  box: { width: '100%', borderRadius: 14, overflow: 'hidden', backgroundColor: '#000' },
  fill: { width: '100%', height: '100%' },
  web: { flex: 1, backgroundColor: '#000' },
  playBadge: {
    position: 'absolute', top: '50%', left: '50%', marginLeft: -30, marginTop: -21,
    width: 60, height: 42, borderRadius: 12, backgroundColor: 'rgba(255,0,0,0.9)',
    alignItems: 'center', justifyContent: 'center',
  },
  playIcon: { color: '#fff', fontSize: 18, fontWeight: '800', marginLeft: 3 },
  spinner: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' },
  failWrap: { alignItems: 'center', justifyContent: 'center', gap: 10, padding: 16 },
  failText: { color: '#ddd', fontSize: 13, fontWeight: '600', textAlign: 'center' },
  failBtn: { backgroundColor: '#ff0000', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  failBtnText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  openBtn: { alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 2 },
  openText: { fontSize: 12.5, fontWeight: '700', color: COLOR },
})
