import { View, StyleSheet } from 'react-native'
import YouTubeEmbed from './YouTubeEmbed'

// The native wrapper around the YouTube DOM component: a fixed 16:9-ish box
// with rounded corners, inline playback allowed so the video plays in place.
export default function ExerciseVideo({ videoId, height = 210, style }) {
  if (!videoId) return null
  return (
    <View style={[v.box, { height }, style]}>
      <YouTubeEmbed
        videoId={videoId}
        dom={{
          style: { width: '100%', height },
          scrollEnabled: false,
          allowsInlineMediaPlayback: true,
          mediaPlaybackRequiresUserAction: false,
        }}
      />
    </View>
  )
}

const v = StyleSheet.create({
  box: { width: '100%', borderRadius: 14, overflow: 'hidden', backgroundColor: '#000' },
})
