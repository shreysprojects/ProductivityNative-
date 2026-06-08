import { useRef, useEffect } from 'react'
import { Animated } from 'react-native'
import Svg, { Circle, Line, G } from 'react-native-svg'

const COLOR = '#10b981'
const SW = 3.5
const LC = 'round'

const AnimatedLine = Animated.createAnimatedComponent(Line)
const AnimatedCircle = Animated.createAnimatedComponent(Circle)

function usePoseAnim() {
  const anim = useRef(new Animated.Value(0)).current
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 1000, useNativeDriver: false }),
        Animated.timing(anim, { toValue: 0, duration: 1000, useNativeDriver: false }),
      ])
    )
    loop.start()
    return () => loop.stop()
  }, [])
  return anim
}

const POSES = {
  standing(c, anim) {
    const x2 = anim.interpolate({ inputRange: [0, 1], outputRange: [58, 54] })
    const y2 = anim.interpolate({ inputRange: [0, 1], outputRange: [44, 40] })
    return (
      <G stroke={c} strokeWidth={SW} strokeLinecap={LC}>
        <Circle cx="40" cy="9" r="7" fill="none" />
        <Line x1="40" y1="16" x2="40" y2="55" />
        <Line x1="40" y1="27" x2="22" y2="44" />
        <AnimatedLine stroke={c} strokeWidth={SW} strokeLinecap={LC} x1="40" y1="27" x2={x2} y2={y2} />
        <Line x1="40" y1="55" x2="27" y2="85" />
        <Line x1="40" y1="55" x2="53" y2="85" />
      </G>
    )
  },

  side_bend(c, anim) {
    const tipY = anim.interpolate({ inputRange: [0, 1], outputRange: [2, -2] })
    return (
      <G stroke={c} strokeWidth={SW} strokeLinecap={LC}>
        <Circle cx="44" cy="9" r="7" fill="none" />
        <Line x1="44" y1="16" x2="42" y2="56" />
        <Line x1="43" y1="27" x2="60" y2="10" />
        <AnimatedLine stroke={c} strokeWidth={SW} strokeLinecap={LC} x1="60" y1="10" x2="65" y2={tipY} />
        <Line x1="43" y1="27" x2="28" y2="44" />
        <Line x1="42" y1="56" x2="30" y2="85" />
        <Line x1="42" y1="56" x2="55" y2="85" />
      </G>
    )
  },

  arm_cross(c, anim) {
    const x2 = anim.interpolate({ inputRange: [0, 1], outputRange: [66, 70] })
    const y2 = anim.interpolate({ inputRange: [0, 1], outputRange: [36, 33] })
    return (
      <G stroke={c} strokeWidth={SW} strokeLinecap={LC}>
        <Circle cx="40" cy="9" r="7" fill="none" />
        <Line x1="40" y1="16" x2="40" y2="55" />
        <AnimatedLine stroke={c} strokeWidth={SW} strokeLinecap={LC} x1="40" y1="27" x2={x2} y2={y2} />
        <Line x1="40" y1="27" x2="20" y2="22" />
        <Line x1="20" y1="22" x2="62" y2="36" />
        <Line x1="40" y1="55" x2="27" y2="85" />
        <Line x1="40" y1="55" x2="53" y2="85" />
      </G>
    )
  },

  overhead_arm(c, anim) {
    const tipY = anim.interpolate({ inputRange: [0, 1], outputRange: [4, 0] })
    return (
      <G stroke={c} strokeWidth={SW} strokeLinecap={LC}>
        <Circle cx="40" cy="9" r="7" fill="none" />
        <Line x1="40" y1="16" x2="40" y2="55" />
        <Line x1="40" y1="27" x2="52" y2="4" />
        <AnimatedLine stroke={c} strokeWidth={SW} strokeLinecap={LC} x1="52" y1={tipY} x2="44" y2="16" />
        <Line x1="40" y1="27" x2="55" y2="6" />
        <Line x1="40" y1="55" x2="27" y2="85" />
        <Line x1="40" y1="55" x2="53" y2="85" />
      </G>
    )
  },

  all_fours(c, anim) {
    const neckY2 = anim.interpolate({ inputRange: [0, 1], outputRange: [44, 40] })
    return (
      <G stroke={c} strokeWidth={SW} strokeLinecap={LC}>
        <Circle cx="16" cy="38" r="7" fill="none" />
        <AnimatedLine stroke={c} strokeWidth={SW} strokeLinecap={LC} x1="23" y1="38" x2="32" y2={neckY2} />
        <Line x1="32" y1="44" x2="65" y2="44" />
        <Line x1="34" y1="44" x2="28" y2="68" />
        <Line x1="40" y1="44" x2="34" y2="68" />
        <Line x1="60" y1="44" x2="58" y2="68" />
        <Line x1="65" y1="44" x2="70" y2="68" />
        <Line x1="28" y1="68" x2="16" y2="72" />
        <Line x1="34" y1="68" x2="22" y2="72" />
        <Line x1="58" y1="68" x2="52" y2="78" />
        <Line x1="70" y1="68" x2="73" y2="78" />
      </G>
    )
  },

  forward_fold(c, anim) {
    const handY = anim.interpolate({ inputRange: [0, 1], outputRange: [75, 80] })
    return (
      <G stroke={c} strokeWidth={SW} strokeLinecap={LC}>
        <Circle cx="40" cy="70" r="7" fill="none" />
        <Line x1="40" y1="63" x2="40" y2="32" />
        <Line x1="40" y1="32" x2="27" y2="85" />
        <Line x1="40" y1="32" x2="53" y2="85" />
        <AnimatedLine stroke={c} strokeWidth={SW} strokeLinecap={LC} x1="40" y1="50" x2="28" y2={handY} />
        <Line x1="40" y1="50" x2="52" y2="75" />
      </G>
    )
  },

  lying_back(c, anim) {
    const kneeY = anim.interpolate({ inputRange: [0, 1], outputRange: [22, 18] })
    return (
      <G stroke={c} strokeWidth={SW} strokeLinecap={LC}>
        <Circle cx="12" cy="45" r="7" fill="none" />
        <Line x1="19" y1="45" x2="70" y2="45" />
        <Line x1="32" y1="45" x2="26" y2="30" />
        <Line x1="44" y1="45" x2="50" y2="30" />
        <AnimatedLine stroke={c} strokeWidth={SW} strokeLinecap={LC} x1="60" y1="45" x2="58" y2={kneeY} />
        <Line x1="68" y1="45" x2="72" y2="22" />
        <Line x1="58" y1="22" x2="42" y2="20" />
        <Line x1="72" y1="22" x2="56" y2="20" />
      </G>
    )
  },

  kneeling_lunge(c, anim) {
    const footX = anim.interpolate({ inputRange: [0, 1], outputRange: [14, 10] })
    return (
      <G stroke={c} strokeWidth={SW} strokeLinecap={LC}>
        <Circle cx="48" cy="9" r="7" fill="none" />
        <Line x1="48" y1="16" x2="46" y2="48" />
        <Line x1="47" y1="28" x2="30" y2="44" />
        <Line x1="47" y1="28" x2="65" y2="44" />
        <Line x1="46" y1="48" x2="28" y2="65" />
        <AnimatedLine stroke={c} strokeWidth={SW} strokeLinecap={LC} x1="28" y1="65" x2={footX} y2="78" />
        <Line x1="46" y1="48" x2="58" y2="62" />
        <Line x1="58" y1="62" x2="68" y2="94" />
        <Line x1="68" y1="94" x2="72" y2="86" />
      </G>
    )
  },

  seated_floor(c, anim) {
    const armX = anim.interpolate({ inputRange: [0, 1], outputRange: [22, 18] })
    const armY = anim.interpolate({ inputRange: [0, 1], outputRange: [52, 48] })
    return (
      <G stroke={c} strokeWidth={SW} strokeLinecap={LC}>
        <Circle cx="40" cy="18" r="7" fill="none" />
        <Line x1="40" y1="25" x2="40" y2="58" />
        <AnimatedLine stroke={c} strokeWidth={SW} strokeLinecap={LC} x1="40" y1="36" x2={armX} y2={armY} />
        <Line x1="40" y1="36" x2="60" y2="45" />
        <Line x1="30" y1="58" x2="55" y2="58" />
        <Line x1="30" y1="58" x2="16" y2="80" />
        <Line x1="16" y1="80" x2="36" y2="88" />
        <Line x1="55" y1="58" x2="70" y2="80" />
        <Line x1="70" y1="80" x2="50" y2="88" />
      </G>
    )
  },
}

export default function StretchFigure({ pose = 'standing', size = 80 }) {
  const anim = usePoseAnim()
  const poseFn = POSES[pose] ?? POSES.standing
  const height = size * (100 / 80)
  return (
    <Svg width={size} height={height} viewBox="0 0 80 100">
      {poseFn(COLOR, anim)}
    </Svg>
  )
}