export const STRETCH_CATEGORIES = ['Full Body', 'Upper Body', 'Lower Body', 'Core', 'Back', 'Hips & Glutes', 'Shoulders & Chest']

export const STRETCHES = [
  // ── Upper Body ────────────────────────────────────────────────────────────
  {
    id: 's1',
    name: 'Neck Side Stretch',
    category: 'Upper Body',
    muscles: ['Neck', 'Traps'],
    duration: 30,
    bilateral: true,
    steps: [
      'Sit or stand tall, shoulders relaxed.',
      'Slowly tilt your right ear toward your right shoulder.',
      'Feel the stretch on the left side of your neck.',
      'Hold, then repeat on the other side.',
    ],
    tips: 'Do not roll your head backward — keep the motion lateral.',
  },
  {
    id: 's2',
    name: 'Chin Tuck',
    category: 'Upper Body',
    muscles: ['Neck', 'Upper Back'],
    duration: 20,
    bilateral: false,
    steps: [
      'Sit or stand with good posture.',
      'Gently pull your chin straight back, creating a "double chin."',
      'Hold for 5 seconds, then release.',
      'Repeat 5–8 times.',
    ],
    tips: 'Keep your eyes level — do not look down.',
  },
  {
    id: 's3',
    name: 'Cross-Body Shoulder Stretch',
    category: 'Shoulders & Chest',
    muscles: ['Posterior Deltoid', 'Rotator Cuff'],
    duration: 30,
    bilateral: true,
    steps: [
      'Stand or sit upright.',
      'Bring your right arm across your chest.',
      'Use your left hand to press the upper arm closer to your chest.',
      'Hold, feeling the stretch in the back of your shoulder.',
    ],
    tips: 'Keep your shoulder down — do not shrug.',
  },
  {
    id: 's4',
    name: 'Chest Opener (Clasped Hands)',
    category: 'Shoulders & Chest',
    muscles: ['Pectorals', 'Anterior Deltoid', 'Biceps'],
    duration: 30,
    bilateral: false,
    steps: [
      'Stand tall and clasp your hands behind your back.',
      'Squeeze your shoulder blades together.',
      'Lift your hands slightly while opening your chest forward.',
      'Hold and breathe deeply.',
    ],
    tips: 'Avoid arching your lower back — engage your core.',
  },
  {
    id: 's5',
    name: 'Doorway Chest Stretch',
    category: 'Shoulders & Chest',
    muscles: ['Pectorals', 'Anterior Deltoid'],
    duration: 30,
    bilateral: false,
    steps: [
      'Stand in a doorway and place both forearms on the door frame at 90°.',
      'Step one foot forward and gently lean through the doorway.',
      'Feel the stretch across your chest.',
      'Hold, breathing steadily.',
    ],
    tips: 'Adjust arm height to target upper, mid, or lower chest.',
  },
  {
    id: 's6',
    name: 'Tricep Overhead Stretch',
    category: 'Upper Body',
    muscles: ['Triceps'],
    duration: 30,
    bilateral: true,
    steps: [
      'Raise your right arm overhead and bend it at the elbow.',
      'Your right hand should reach toward your upper back.',
      'Use your left hand to gently press down on the right elbow.',
      'Hold, then switch sides.',
    ],
    tips: 'Keep your torso upright — do not lean sideways.',
  },
  {
    id: 's7',
    name: 'Bicep Wall Stretch',
    category: 'Upper Body',
    muscles: ['Biceps', 'Anterior Deltoid'],
    duration: 30,
    bilateral: true,
    steps: [
      'Stand facing a wall. Extend your right arm and press your palm flat against it, thumb pointing up.',
      'Slowly rotate your body away from the wall.',
      'Feel the stretch along the front of your arm and shoulder.',
      'Hold, then repeat on the other side.',
    ],
    tips: 'Start with a gentle rotation — do not force it.',
  },
  {
    id: 's8',
    name: 'Wrist Flexor Stretch',
    category: 'Upper Body',
    muscles: ['Wrist Flexors', 'Forearms'],
    duration: 20,
    bilateral: true,
    steps: [
      'Extend your right arm in front at shoulder height, palm facing up.',
      'Use your left hand to gently pull the fingers down toward the floor.',
      'Feel the stretch along the inside of your forearm.',
      'Hold, then switch sides.',
    ],
    tips: 'Ideal before and after activities involving gripping.',
  },
  {
    id: 's9',
    name: 'Wrist Extensor Stretch',
    category: 'Upper Body',
    muscles: ['Wrist Extensors', 'Forearms'],
    duration: 20,
    bilateral: true,
    steps: [
      'Extend your right arm in front at shoulder height, palm facing down.',
      'Use your left hand to gently pull the fingers toward the floor.',
      'Feel the stretch along the top of your forearm.',
      'Hold, then switch sides.',
    ],
    tips: 'Especially useful for desk workers and climbers.',
  },

  // ── Shoulders & Chest ────────────────────────────────────────────────────
  {
    id: 's10',
    name: 'Thread the Needle',
    category: 'Shoulders & Chest',
    muscles: ['Upper Back', 'Posterior Deltoid', 'Thoracic Spine'],
    duration: 30,
    bilateral: true,
    steps: [
      'Start on all fours, wrists under shoulders, knees under hips.',
      'Slide your right arm under your body to the left, palm facing up.',
      'Rest your right shoulder and cheek on the mat.',
      'Hold, feeling the rotation in your upper back, then switch.',
    ],
    tips: 'Keep your hips level — do not rotate your hips.',
  },

  // ── Back ─────────────────────────────────────────────────────────────────
  {
    id: 's11',
    name: 'Cat-Cow Stretch',
    category: 'Back',
    muscles: ['Spine', 'Lower Back', 'Neck'],
    duration: 40,
    bilateral: false,
    steps: [
      'Start on all fours, wrists under shoulders, knees under hips.',
      'Inhale: drop your belly, lift your head and tailbone (Cow).',
      'Exhale: round your spine toward the ceiling, tuck chin and pelvis (Cat).',
      'Flow between the two for the duration.',
    ],
    tips: 'Move slowly and sync with your breath.',
  },
  {
    id: 's12',
    name: "Child's Pose",
    category: 'Back',
    muscles: ['Lower Back', 'Lats', 'Hips'],
    duration: 45,
    bilateral: false,
    steps: [
      'Kneel and sit your hips back toward your heels.',
      'Walk your hands forward on the mat and lower your forehead down.',
      'Extend your arms fully to stretch your lats.',
      'Breathe deeply and relax into the pose.',
    ],
    tips: 'For a wider hip stretch, spread your knees apart.',
  },
  {
    id: 's13',
    name: 'Seated Spinal Twist',
    category: 'Back',
    muscles: ['Thoracic Spine', 'Obliques', 'Piriformis'],
    duration: 30,
    bilateral: true,
    steps: [
      'Sit on the floor with legs extended. Bend your right knee and cross it over your left leg.',
      'Place your right foot flat on the floor outside your left knee.',
      'Place your right hand behind you and hook your left elbow over your right knee.',
      'Inhale tall, then exhale and rotate right. Hold, then switch.',
    ],
    tips: 'Lengthen your spine on each inhale before deepening the twist.',
  },
  {
    id: 's14',
    name: 'Lower Back Knee Hug',
    category: 'Back',
    muscles: ['Lower Back', 'Glutes'],
    duration: 30,
    bilateral: false,
    steps: [
      'Lie on your back with knees bent.',
      'Bring both knees toward your chest.',
      'Wrap your arms around your shins and gently pull your knees closer.',
      'Rock side to side slightly for a massage effect.',
    ],
    tips: 'Great first stretch of the morning or after long sitting.',
  },
  {
    id: 's15',
    name: 'Cobra Stretch',
    category: 'Back',
    muscles: ['Abdominals', 'Hip Flexors', 'Lower Back'],
    duration: 30,
    bilateral: false,
    steps: [
      'Lie face-down with hands under your shoulders, elbows close to your body.',
      'Press your hands into the floor and lift your chest.',
      'Keep your hips on the ground and shoulders away from ears.',
      'Hold, breathing steadily.',
    ],
    tips: 'Only go as high as comfortable — do not strain the lower back.',
  },

  // ── Core ─────────────────────────────────────────────────────────────────
  {
    id: 's16',
    name: 'Side Stretch (Standing)',
    category: 'Core',
    muscles: ['Obliques', 'Lats', 'Intercostals'],
    duration: 30,
    bilateral: true,
    steps: [
      'Stand with feet hip-width apart.',
      'Raise your right arm overhead and lean to the left.',
      'Keep both feet grounded and your core engaged.',
      'Hold, then switch sides.',
    ],
    tips: 'Press your hips in the opposite direction of the lean for a deeper stretch.',
  },
  {
    id: 's17',
    name: 'Kneeling Hip Flexor Stretch',
    category: 'Core',
    muscles: ['Hip Flexors', 'Psoas', 'Quads'],
    duration: 45,
    bilateral: true,
    steps: [
      'Kneel on your right knee, left foot forward at 90°.',
      'Shift your hips forward until you feel a stretch in the right hip/groin.',
      'Keep your torso upright and core engaged.',
      'Hold, then switch sides.',
    ],
    tips: 'Squeeze the glute of the kneeling leg to deepen the hip flexor stretch.',
  },
  {
    id: 's18',
    name: 'Lying Abdominal Stretch',
    category: 'Core',
    muscles: ['Abdominals', 'Hip Flexors'],
    duration: 30,
    bilateral: false,
    steps: [
      'Lie face-up with arms extended overhead on the floor.',
      'Reach your arms and legs away from each other as far as possible.',
      'Point your toes and fingers and hold the full-body stretch.',
    ],
    tips: 'Take a deep breath in as you stretch — exhale and release.',
  },

  // ── Lower Body ────────────────────────────────────────────────────────────
  {
    id: 's19',
    name: 'Standing Quad Stretch',
    category: 'Lower Body',
    muscles: ['Quadriceps'],
    duration: 30,
    bilateral: true,
    steps: [
      'Stand on your left foot. Bend your right knee and hold your right ankle.',
      'Pull your heel toward your glute, keeping your knees together.',
      'Stand tall, engaging your core for balance.',
      'Hold, then switch legs.',
    ],
    tips: 'Use a wall for balance if needed.',
  },
  {
    id: 's20',
    name: 'Standing Hamstring Stretch',
    category: 'Lower Body',
    muscles: ['Hamstrings'],
    duration: 30,
    bilateral: true,
    steps: [
      'Stand and place your right heel on a slightly elevated surface (step, bench).',
      'Keep your right leg straight and flex your foot.',
      'Hinge at the hips, leaning slightly forward.',
      'Hold the stretch, then switch.',
    ],
    tips: 'Keep your back flat — do not round your spine.',
  },
  {
    id: 's21',
    name: 'Seated Hamstring Stretch',
    category: 'Lower Body',
    muscles: ['Hamstrings', 'Calves'],
    duration: 40,
    bilateral: true,
    steps: [
      'Sit on the floor with both legs extended.',
      'Extend your right leg and bend your left, placing the sole against your inner right thigh.',
      'Hinge at the hips and reach toward your right foot.',
      'Hold, then switch sides.',
    ],
    tips: 'Loop a towel around your foot if you cannot reach.',
  },
  {
    id: 's22',
    name: 'Supine Hamstring Stretch',
    category: 'Lower Body',
    muscles: ['Hamstrings'],
    duration: 40,
    bilateral: true,
    steps: [
      'Lie on your back.',
      'Raise your right leg toward the ceiling, keeping it as straight as possible.',
      'Clasp your hands behind your thigh or calf.',
      'Gently pull the leg toward you. Hold, then switch.',
    ],
    tips: 'Do not lock your knee — keep a slight bend if needed.',
  },
  {
    id: 's23',
    name: 'Calf Stretch (Wall)',
    category: 'Lower Body',
    muscles: ['Gastrocnemius', 'Soleus'],
    duration: 30,
    bilateral: true,
    steps: [
      'Stand facing a wall, hands resting on it.',
      'Step your right foot back about 2 feet.',
      'Keep the right heel flat on the ground and bend the left knee.',
      'Press gently forward to feel the calf stretch. Hold, then switch.',
    ],
    tips: 'Bend the back knee slightly to shift focus to the soleus (deeper calf).',
  },
  {
    id: 's24',
    name: 'Standing IT Band Stretch',
    category: 'Lower Body',
    muscles: ['IT Band', 'TFL', 'Outer Thigh'],
    duration: 30,
    bilateral: true,
    steps: [
      'Stand near a wall. Cross your right leg behind your left.',
      'Lean your left hip away from the wall while pressing into it for support.',
      'Feel the stretch along the outer right hip and thigh.',
      'Hold, then switch sides.',
    ],
    tips: 'Especially helpful for runners and cyclists.',
  },
  {
    id: 's25',
    name: 'Inner Thigh (Adductor) Stretch',
    category: 'Lower Body',
    muscles: ['Adductors', 'Groin'],
    duration: 40,
    bilateral: false,
    steps: [
      'Sit on the floor and bring the soles of your feet together (butterfly position).',
      'Hold your feet with your hands.',
      'Gently press your knees toward the floor with your elbows.',
      'Hinge forward slightly at the hips for a deeper stretch.',
    ],
    tips: 'Do not push your knees down with force — use gentle pressure.',
  },

  // ── Hips & Glutes ────────────────────────────────────────────────────────
  {
    id: 's26',
    name: 'Pigeon Pose',
    category: 'Hips & Glutes',
    muscles: ['Piriformis', 'Hip External Rotators', 'Glutes'],
    duration: 60,
    bilateral: true,
    steps: [
      'From a plank, bring your right knee forward and place it behind your right wrist.',
      'Slide your left leg back and lower your hips toward the floor.',
      'Square your hips and lower your torso down over your right shin.',
      'Hold, breathing deeply, then switch sides.',
    ],
    tips: 'Place a folded blanket under your right hip if it does not reach the floor.',
  },
  {
    id: 's27',
    name: 'Figure-4 Glute Stretch',
    category: 'Hips & Glutes',
    muscles: ['Piriformis', 'Glutes', 'Hip External Rotators'],
    duration: 40,
    bilateral: true,
    steps: [
      'Lie on your back with knees bent and feet flat.',
      'Cross your right ankle over your left knee.',
      'Flex your right foot and lift the left foot off the floor.',
      'Thread your hands through and clasp behind your left thigh. Pull toward chest.',
    ],
    tips: 'Press your right knee away from you gently for a deeper stretch.',
  },
  {
    id: 's28',
    name: 'Seated Glute Stretch',
    category: 'Hips & Glutes',
    muscles: ['Glutes', 'Piriformis'],
    duration: 30,
    bilateral: true,
    steps: [
      'Sit upright in a chair.',
      'Place your right ankle over your left knee.',
      'Sit tall and gently press down on your right knee.',
      'Lean slightly forward with a flat back for more intensity.',
    ],
    tips: 'Great for desk workers — can be done without leaving your chair.',
  },
  {
    id: 's29',
    name: 'Hip Circles (Standing)',
    category: 'Hips & Glutes',
    muscles: ['Hip Flexors', 'Glutes', 'Hip Rotators'],
    duration: 30,
    bilateral: false,
    steps: [
      'Stand with feet hip-width apart, hands on hips.',
      'Make large, slow circles with your hips in one direction.',
      'Complete the reps, then reverse direction.',
    ],
    tips: 'Move slowly to increase range of motion.',
  },
  {
    id: 's30',
    name: 'Lizard Lunge',
    category: 'Hips & Glutes',
    muscles: ['Hip Flexors', 'Groin', 'Hamstrings'],
    duration: 45,
    bilateral: true,
    steps: [
      'Step your right foot forward outside your right hand into a low lunge.',
      'Lower your left knee to the ground.',
      'Sink your hips toward the floor and breathe.',
      'Hold, then switch sides.',
    ],
    tips: 'Drop onto your forearms for a deeper hip stretch.',
  },

  // ── Full Body ─────────────────────────────────────────────────────────────
  {
    id: 's31',
    name: "World's Greatest Stretch",
    category: 'Full Body',
    muscles: ['Hip Flexors', 'Thoracic Spine', 'Hamstrings', 'Groin'],
    duration: 45,
    bilateral: true,
    steps: [
      'Start in a deep lunge, right foot forward, left knee on the ground.',
      'Place your right hand on the floor inside your right foot.',
      'Rotate your left arm up toward the ceiling, opening your chest.',
      'Hold, then bring the hand back down. Switch sides.',
    ],
    tips: 'One of the most effective single stretches for the entire body.',
  },
  {
    id: 's32',
    name: 'Downward Dog',
    category: 'Full Body',
    muscles: ['Hamstrings', 'Calves', 'Lats', 'Shoulders'],
    duration: 40,
    bilateral: false,
    steps: [
      'Start on all fours. Tuck your toes and lift your hips up and back.',
      'Straighten your legs and press your heels toward the floor.',
      'Spread your fingers wide and press through your palms.',
      'Hold, breathing deeply through the stretch.',
    ],
    tips: 'Pedal your feet alternately to warm up the calves.',
  },
  {
    id: 's33',
    name: 'Standing Forward Fold',
    category: 'Full Body',
    muscles: ['Hamstrings', 'Calves', 'Lower Back'],
    duration: 40,
    bilateral: false,
    steps: [
      'Stand with feet hip-width apart.',
      'Hinge at the hips and fold forward, letting your arms hang.',
      'Bend your knees slightly if needed.',
      'Nod your head yes and no to release neck tension.',
    ],
    tips: 'Let gravity do the work — do not force the stretch.',
  },
  {
    id: 's34',
    name: 'Wall Angels',
    category: 'Full Body',
    muscles: ['Thoracic Spine', 'Shoulder Blades', 'Lats'],
    duration: 30,
    bilateral: false,
    steps: [
      'Stand with your back against a wall, feet 6 inches out.',
      'Press your lower back, upper back, and head against the wall.',
      'Raise your arms to 90° (W shape), then slowly slide them up (Y shape).',
      'Keep contact with the wall throughout the movement.',
    ],
    tips: 'Move slowly — quality over speed.',
  },
  {
    id: 's35',
    name: 'Inchworm',
    category: 'Full Body',
    muscles: ['Hamstrings', 'Calves', 'Shoulders', 'Core'],
    duration: 40,
    bilateral: false,
    steps: [
      'Stand with feet together. Hinge at the hips and touch the floor.',
      'Walk your hands forward until you are in a push-up position.',
      'Hold for 2 seconds, then walk your feet to meet your hands.',
      'Stand up and repeat.',
    ],
    tips: 'Keep your legs as straight as tolerated during the walk.',
  },

  // ── Additional targeted ───────────────────────────────────────────────────
  {
    id: 's36',
    name: 'Hip Flexor + Quad (Couch Stretch)',
    category: 'Hips & Glutes',
    muscles: ['Hip Flexors', 'Quadriceps'],
    duration: 60,
    bilateral: true,
    steps: [
      'Kneel with your back to a couch/wall.',
      'Place your right shin up against the couch, right knee on the ground.',
      'Step your left foot forward, creating a 90° angle.',
      'Squeeze your right glute and push your hips forward. Hold, then switch.',
    ],
    tips: 'One of the most effective hip flexor stretches available.',
  },
  {
    id: 's37',
    name: 'Thoracic Extension over Foam Roller',
    category: 'Back',
    muscles: ['Thoracic Spine', 'Pectorals'],
    duration: 45,
    bilateral: false,
    steps: [
      'Sit in front of a foam roller placed perpendicular to your spine.',
      'Lean back so the roller is at your mid-back, hands behind head.',
      'Let your head drop back and extend over the roller.',
      'Slowly roll up and down the thoracic spine.',
    ],
    tips: 'Avoid rolling over your lower back or neck.',
  },
  {
    id: 's38',
    name: 'Hip 90/90 Stretch',
    category: 'Hips & Glutes',
    muscles: ['Hip External/Internal Rotators', 'Glutes', 'Adductors'],
    duration: 45,
    bilateral: true,
    steps: [
      'Sit with your right leg bent at 90° in front and your left leg bent at 90° to the side.',
      'Sit tall with both knees on the ground (or as close as possible).',
      'Hold the position and breathe. Switch legs after the set time.',
    ],
    tips: 'Excellent for hip mobility. Progress by leaning forward over the front leg.',
  },
  {
    id: 's39',
    name: 'Shoulder Sleeper Stretch',
    category: 'Shoulders & Chest',
    muscles: ['Posterior Capsule', 'Rotator Cuff'],
    duration: 30,
    bilateral: true,
    steps: [
      'Lie on your right side with your right arm out at 90°, elbow bent.',
      'Use your left hand to gently push your right forearm down toward the floor.',
      'Keep your right shoulder on the ground.',
      'Hold, then switch sides.',
    ],
    tips: 'Critical for shoulder health and preventing impingement.',
  },
  {
    id: 's40',
    name: 'Ankle Circles',
    category: 'Lower Body',
    muscles: ['Ankle Flexors', 'Ankle Stabilizers'],
    duration: 20,
    bilateral: true,
    steps: [
      'Sit or stand on one foot.',
      'Lift the other foot slightly off the ground.',
      'Slowly rotate the ankle clockwise for 10 reps.',
      'Reverse direction for 10 reps, then switch feet.',
    ],
    tips: 'Especially important before running or any jumping activity.',
  },
]

// Maps stretch id → pose key used by StretchFigure component
export const STRETCH_POSES = {
  s1: 'side_bend',       // Neck Side Stretch
  s2: 'standing',        // Chin Tuck
  s3: 'arm_cross',       // Cross-Body Shoulder
  s4: 'standing',        // Chest Opener
  s5: 'standing',        // Doorway Chest
  s6: 'overhead_arm',    // Tricep Overhead
  s7: 'standing',        // Bicep Wall Stretch
  s8: 'standing',        // Wrist Flexor
  s9: 'standing',        // Wrist Extensor
  s10: 'all_fours',      // Thread the Needle
  s11: 'all_fours',      // Cat-Cow
  s12: 'all_fours',      // Child's Pose
  s13: 'seated_floor',   // Seated Spinal Twist
  s14: 'lying_back',     // Knee Hug
  s15: 'lying_back',     // Cobra
  s16: 'side_bend',      // Side Stretch Standing
  s17: 'kneeling_lunge', // Kneeling Hip Flexor
  s18: 'lying_back',     // Lying Abdominal
  s19: 'standing',       // Standing Quad
  s20: 'forward_fold',   // Standing Hamstring
  s21: 'seated_floor',   // Seated Hamstring
  s22: 'lying_back',     // Supine Hamstring
  s23: 'standing',       // Calf Wall
  s24: 'standing',       // IT Band
  s25: 'seated_floor',   // Butterfly
  s26: 'kneeling_lunge', // Pigeon Pose
  s27: 'lying_back',     // Figure-4 Glute
  s28: 'seated_floor',   // Seated Glute
  s29: 'standing',       // Hip Circles
  s30: 'kneeling_lunge', // Lizard Lunge
  s31: 'kneeling_lunge', // World's Greatest
  s32: 'all_fours',      // Downward Dog
  s33: 'forward_fold',   // Standing Forward Fold
  s34: 'standing',       // Wall Angels
  s35: 'all_fours',      // Inchworm
  s36: 'kneeling_lunge', // Couch Stretch
  s37: 'lying_back',     // Foam Roller
  s38: 'seated_floor',   // Hip 90/90
  s39: 'lying_back',     // Shoulder Sleeper
  s40: 'standing',       // Ankle Circles
}