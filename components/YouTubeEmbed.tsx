'use dom'

// A YouTube demo video for an exercise, rendered through Expo's DOM component
// webview (part of SDK 57, so no extra native module and it works in Expo Go).
// Props must stay serialisable. Size it from the native side with the `dom`
// prop's style; this fills whatever box it is given.

export default function YouTubeEmbed({ videoId }: { videoId: string }) {
  return (
    <div style={{ margin: 0, padding: 0, background: '#000', width: '100%', height: '100%' }}>
      <iframe
        src={`https://www.youtube-nocookie.com/embed/${videoId}?playsinline=1&rel=0&modestbranding=1`}
        title="Exercise demo"
        style={{ border: 0, width: '100%', height: '100%', display: 'block' }}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
        allowFullScreen
      />
    </div>
  )
}
