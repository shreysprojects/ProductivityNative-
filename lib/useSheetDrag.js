import { useRef, useEffect } from 'react'
import { Animated, PanResponder, Keyboard, Dimensions, StyleSheet } from 'react-native'

// Pull-down-to-dismiss for a bottom sheet. One hook, the same feel everywhere:
// a long pull or a quick flick slides the sheet away and closes it, a short
// pull snaps back, starting a drag closes the keyboard, and the backdrop fades
// with the pull.
//
//   const drag = useSheetDrag(onClose, { visible })
//
//   <Modal visible={visible} onRequestClose={drag.close}>
//     <Animated.View pointerEvents="none" style={[backdropStyle, { opacity: drag.backdrop }]} />
//     <Pressable style={StyleSheet.absoluteFill} onPress={drag.close} />
//     <Animated.View style={[sheetStyle, { transform: [{ translateY: drag.dragY }] }]}>
//       <View {...drag.handlePan.panHandlers} style={drag.grabStyle}>
//         <View style={handleStyle} />          {/* and the title, if it isn't tappable */}
//       </View>
//       ...
//
// For a sheet whose body is a ScrollView, wrap it in
//   <View {...drag.bodyPan.panHandlers} style={{ flexShrink: 1 }}>
// and give the ScrollView onScroll={drag.onScroll} scrollEventThrottle={16}
// bounces={false}: the body then also dismisses on a clear downward pull, but
// only once it is scrolled to the top, so ordinary scrolling is untouched.
//
// `visible` resets the sheet's position each time it opens (for modals that
// stay mounted and toggle `visible`); leave it out for sheets that mount fresh.

export function useSheetDrag(onClose, { visible = true } = {}) {
  const dragY = useRef(new Animated.Value(0)).current
  const backdrop = useRef(dragY.interpolate({
    inputRange: [0, 260], outputRange: [1, 0], extrapolate: 'clamp',
  })).current
  const atTop = useRef(true)

  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // Slide the rest of the way out, tell the owner, then reset for next time.
  function close() {
    Keyboard.dismiss()
    Animated.timing(dragY, {
      toValue: Dimensions.get('window').height, duration: 180, useNativeDriver: true,
    }).start(() => {
      if (onCloseRef.current) onCloseRef.current()
      dragY.setValue(0)
    })
  }
  const closeRef = useRef(close)
  closeRef.current = close

  useEffect(() => {
    if (visible) {
      dragY.setValue(0)
      atTop.current = true
    }
  }, [visible])   // eslint-disable-line react-hooks/exhaustive-deps

  // The pan handlers are created once, so they reach the latest close through a ref.
  const handlers = useRef({
    onPanResponderGrant: () => { Keyboard.dismiss() },
    onPanResponderMove: (_, g) => { dragY.setValue(Math.max(0, g.dy)) },
    // A ScrollView asks for the gesture back once it starts moving; refusing
    // keeps a pull that began as a dismissal a dismissal.
    onPanResponderTerminationRequest: () => false,
    onPanResponderRelease: (_, g) => {
      if (g.dy > 120 || (g.dy > 40 && g.vy > 0.6)) closeRef.current()
      else Animated.spring(dragY, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start()
    },
    onPanResponderTerminate: () => {
      Animated.spring(dragY, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start()
    },
  }).current

  // The handle (and title): always draggable.
  const handlePan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    ...handlers,
  })).current

  // A scrolling body: only a clear downward pull from the top of the scroll.
  const bodyPan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => atTop.current && g.dy > 8 && g.dy > Math.abs(g.dx),
    ...handlers,
  })).current

  const onScroll = e => { atTop.current = e.nativeEvent.contentOffset.y <= 0 }

  return { dragY, backdrop, close, handlePan, bodyPan, onScroll, grabStyle: styles.grab }
}

const styles = StyleSheet.create({
  // A little extra height around the handle so it is a real target.
  grab: { paddingVertical: 6 },
})
