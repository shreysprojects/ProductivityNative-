import { useState } from 'react'
import { View, Image, StyleSheet, Pressable, Modal, Text } from 'react-native'

const BASE  = require('../assets/images/muscle-map.png')

const LAYERS = {
  f_neck:        require('../assets/muscles/f_neck.png'),
  f_shoulder_l:  require('../assets/muscles/f_shoulder_l.png'),  // add file to re-enable
  f_shoulder_r:  require('../assets/muscles/f_shoulder_r.png'),  // add file to re-enable
  f_bicep_l:     require('../assets/muscles/f_bicep_l.png'),
  f_bicep_r:     require('../assets/muscles/f_bicep_r.png'),
  f_forearm_l:   require('../assets/muscles/f_forearm_l.png'),
  f_forearm_r:   require('../assets/muscles/f_forearm_r.png'),
  f_chest:       require('../assets/muscles/f_chest.png'),
  f_abs:         require('../assets/muscles/f_abs.png'),
  f_oblique_l:   require('../assets/muscles/f_oblique_l.png'),
  f_oblique_r:   require('../assets/muscles/f_oblique_r.png'),
  f_hip_l:       require('../assets/muscles/f_hip_l.png'),
  f_hip_r:       require('../assets/muscles/f_hip_r.png'),
  f_quad_l:      require('../assets/muscles/f_quad_l.png'),
  f_quad_r:      require('../assets/muscles/f_quad_r.png'),
  f_calf_l:      require('../assets/muscles/f_calf_l.png'),
  f_calf_r:      require('../assets/muscles/f_calf_r.png'),
  b_neck:        require('../assets/muscles/b_neck.png'),
  b_trap_l:      require('../assets/muscles/b_trap_l.png'),
  b_trap_r:      require('../assets/muscles/b_trap_r.png'),
  b_shoulder_l:  require('../assets/muscles/b_shoulder_l.png'),
  b_shoulder_r:  require('../assets/muscles/b_shoulder_r.png'),
  b_tricep_l:    require('../assets/muscles/b_tricep_l.png'),
  b_tricep_r:    require('../assets/muscles/b_tricep_r.png'),
  b_upper_back:  require('../assets/muscles/b_upper_back.png'),
  b_lat_l:       require('../assets/muscles/b_lat_l.png'),
  b_lat_r:       require('../assets/muscles/b_lat_r.png'),
  b_lower_back:  require('../assets/muscles/b_lower_back.png'),
  b_glute_l:     require('../assets/muscles/b_glute_l.png'),
  b_glute_r:     require('../assets/muscles/b_glute_r.png'),
  b_hamstring_l: require('../assets/muscles/b_hamstring_l.png'),
  b_hamstring_r: require('../assets/muscles/b_hamstring_r.png'),
  b_calf_l:      require('../assets/muscles/b_calf_l.png'),
  b_calf_r:      require('../assets/muscles/b_calf_r.png'),
}

const MUSCLE_TO_REGIONS = {
  'Neck':                           ['f_neck', 'b_neck'],
  'Traps':                          ['b_trap_l', 'b_trap_r'],
  'Upper Traps':                    ['b_trap_l', 'b_trap_r'],
  'Upper Back':                     ['b_upper_back', 'b_trap_l', 'b_trap_r'],
  'Thoracic Spine':                 ['b_upper_back', 'b_lower_back'],
  'Spine':                          ['b_upper_back', 'b_lower_back'],
  'Lower Back':                     ['b_lower_back'],
  'Lats':                           ['b_lat_l', 'b_lat_r'],
  'Shoulder Blades':                ['b_upper_back'],
  'Back':                           ['b_upper_back', 'b_lat_l', 'b_lat_r', 'b_lower_back'],
  'Chest':                          ['f_chest'],
  'Pectorals':                      ['f_chest'],
  'Shoulders':                      ['f_shoulder_l', 'f_shoulder_r', 'b_shoulder_l', 'b_shoulder_r'],
  'Delts':                          ['f_shoulder_l', 'f_shoulder_r', 'b_shoulder_l', 'b_shoulder_r'],
  'Anterior Deltoid':               ['f_shoulder_l', 'f_shoulder_r'],
  'Posterior Deltoid':              ['b_shoulder_l', 'b_shoulder_r'],
  'Rotator Cuff':                   ['f_shoulder_l', 'f_shoulder_r', 'b_shoulder_l', 'b_shoulder_r'],
  'Posterior Capsule':              ['b_shoulder_l', 'b_shoulder_r'],
  'Biceps':                         ['f_bicep_l', 'f_bicep_r'],
  'Triceps':                        ['b_tricep_l', 'b_tricep_r'],
  'Arms':                           ['f_bicep_l', 'f_bicep_r', 'b_tricep_l', 'b_tricep_r'],
  'Forearms':                       ['f_forearm_l', 'f_forearm_r'],
  'Wrist Flexors':                  ['f_forearm_l', 'f_forearm_r'],
  'Wrist Extensors':                ['f_forearm_l', 'f_forearm_r'],
  'Abdominals':                     ['f_abs'],
  'Abs':                            ['f_abs'],
  'Core':                           ['f_abs', 'f_oblique_l', 'f_oblique_r'],
  'Obliques':                       ['f_oblique_l', 'f_oblique_r'],
  'Intercostals':                   ['f_oblique_l', 'f_oblique_r'],
  'Serratus Anterior':              ['f_oblique_l', 'f_oblique_r'],
  'Hip Flexors':                    ['f_hip_l', 'f_hip_r'],
  'Psoas':                          ['f_hip_l', 'f_hip_r'],
  'Hip Rotators':                   ['b_glute_l', 'b_glute_r', 'f_hip_l', 'f_hip_r'],
  'Groin':                          ['f_hip_l', 'f_hip_r'],
  'Adductors':                      ['f_hip_l', 'f_hip_r'],
  'Glutes':                         ['b_glute_l', 'b_glute_r'],
  'Piriformis':                     ['b_glute_l', 'b_glute_r'],
  'Hip External Rotators':          ['b_glute_l', 'b_glute_r'],
  'Hip External/Internal Rotators': ['b_glute_l', 'b_glute_r'],
  'TFL':                            ['f_hip_l', 'f_hip_r'],
  'IT Band':                        ['f_quad_l', 'f_quad_r'],
  'Outer Thigh':                    ['f_quad_l', 'f_quad_r'],
  'Quadriceps':                     ['f_quad_l', 'f_quad_r'],
  'Quads':                          ['f_quad_l', 'f_quad_r'],
  'Legs':                           ['f_quad_l', 'f_quad_r', 'b_hamstring_l', 'b_hamstring_r'],
  'Hamstrings':                     ['b_hamstring_l', 'b_hamstring_r'],
  'Calves':                         ['f_calf_l', 'f_calf_r', 'b_calf_l', 'b_calf_r'],
  'Gastrocnemius':                  ['f_calf_l', 'f_calf_r', 'b_calf_l', 'b_calf_r'],
  'Soleus':                         ['f_calf_l', 'f_calf_r', 'b_calf_l', 'b_calf_r'],
}

function toTitleCase(str) {
  return str.replace(/\b\w/g, c => c.toUpperCase())
}

function getHighlightedIds(muscles) {
  const ids = new Set()
  muscles.forEach(m => {
    const regions = MUSCLE_TO_REGIONS[m] ?? MUSCLE_TO_REGIONS[toTitleCase(m)] ?? []
    regions.forEach(id => ids.add(id))
  })
  return ids
}

// Renders the base image + all active muscle overlays at a given width
function BodyMap({ width, primary, secondary }) {
  const height = width * (450 / 554)
  return (
    <View style={{ width, height }}>
      <Image source={BASE} style={{ width, height }} resizeMode="stretch" />
      {Object.entries(LAYERS).map(([id, src]) => {
        const isPrimary   = primary.has(id)
        const isSecondary = secondary.has(id)
        if (!isPrimary && !isSecondary) return null
        return (
          <Image
            key={id}
            source={src}
            style={[StyleSheet.absoluteFill, { width, height, opacity: isPrimary ? 0.85 : 0.35 }]}
            resizeMode="stretch"
          />
        )
      })}
    </View>
  )
}

export default function MuscleMap({ muscles = [], secondaryMuscles = [], size = 160, interactive = true }) {
  const [expanded, setExpanded] = useState(false)
  const primary   = getHighlightedIds(muscles)
  const secondary = getHighlightedIds(secondaryMuscles)

  if (!interactive) {
    return <BodyMap width={size} primary={primary} secondary={secondary} />
  }

  return (
    <>
      <Pressable
        onPress={() => setExpanded(true)}
        style={({ pressed }) => [s.tapTarget, pressed && { opacity: 0.75 }]}
      >
        <BodyMap width={size} primary={primary} secondary={secondary} />
        <Text style={s.expandHint}>tap to enlarge</Text>
      </Pressable>

      <Modal visible={expanded} transparent animationType="fade" onRequestClose={() => setExpanded(false)}>
        <View style={s.overlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setExpanded(false)} />
          <View style={s.card}>
            <Pressable onPress={() => setExpanded(false)} style={s.closeBtn} hitSlop={12}>
              <Text style={s.closeBtnText}>✕</Text>
            </Pressable>
            <Text style={s.cardTitle}>Muscles Targeted</Text>
            <BodyMap width={300} primary={primary} secondary={secondary} />
            {(muscles.length > 0 || secondaryMuscles.length > 0) && (
              <View style={s.muscleList}>
                {muscles.map(m => (
                  <View key={m} style={s.muscleChip}>
                    <Text style={s.muscleChipText}>{toTitleCase(m)}</Text>
                  </View>
                ))}
                {secondaryMuscles.filter(m => !muscles.includes(m)).map(m => (
                  <View key={m} style={s.muscleChipSecondary}>
                    <Text style={s.muscleChipSecondaryText}>{toTitleCase(m)}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        </View>
      </Modal>
    </>
  )
}

const s = StyleSheet.create({
  tapTarget:  { alignItems: 'center' },
  expandHint: { fontSize: 9, color: '#bbb', marginTop: 5, letterSpacing: 0.3 },

  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center', alignItems: 'center',
  },
  card: {
    backgroundColor: '#fff', borderRadius: 24,
    paddingHorizontal: 20, paddingTop: 20, paddingBottom: 24,
    width: '90%', alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2, shadowRadius: 20, elevation: 16,
  },
  closeBtn:     { position: 'absolute', top: 16, right: 16, width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  closeBtnText: { fontSize: 16, color: '#999', fontWeight: '700' },
  cardTitle:    { fontSize: 14, fontWeight: '800', color: '#333', letterSpacing: 0.3, marginBottom: 16 },
  muscleList:   { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginTop: 14 },
  muscleChip:              { backgroundColor: '#fff0f0', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: '#fca5a5' },
  muscleChipText:          { fontSize: 12, fontWeight: '600', color: '#ef4444' },
  muscleChipSecondary:     { backgroundColor: '#fafafa', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: '#e5e5e5' },
  muscleChipSecondaryText: { fontSize: 12, fontWeight: '500', color: '#999' },
})
