// A one-page YouTube player for the app's exercise demo videos.
//
// YouTube refuses an embed whose request carries no Referer header ("Video
// player configuration error", 153). A webview in the app loading YouTube's
// embed URL directly has no referrer, and neither does a page served from a
// local file. This function serves a real https page that frames the video,
// so the iframe request arrives with this origin as its referrer and plays.
//
// Deployed with --no-verify-jwt: it returns nothing but static HTML and needs
// no identity. The only input is an 11-character video id.

const ID = /^[A-Za-z0-9_-]{11}$/

Deno.serve((req) => {
  const v = (new URL(req.url).searchParams.get('v') ?? '').trim()
  if (!ID.test(v)) return new Response('Not found', { status: 404 })

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<meta name="referrer" content="strict-origin-when-cross-origin">
<title>Exercise demo</title>
<style>
  html, body { margin: 0; height: 100%; background: #000; overflow: hidden; }
  iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
</style>
</head>
<body>
<iframe
  src="https://www.youtube.com/embed/${v}?playsinline=1&rel=0&autoplay=1"
  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
  allowfullscreen
  referrerpolicy="strict-origin-when-cross-origin"></iframe>
<script>
  try { window.ReactNativeWebView && window.ReactNativeWebView.postMessage('__loaded__') } catch (e) {}
</script>
</body>
</html>`

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
      'X-Frame-Options': 'DENY',
    },
  })
})
