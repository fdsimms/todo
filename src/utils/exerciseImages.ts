import { LIBRARY_ID_PREFIX } from './exerciseLibrary';

/**
 * Photos for the built-in exercises, from free-exercise-db
 * (github.com/yuhonas/free-exercise-db), a public-domain (Unlicense) set of
 * about 800 exercises with a start and an end photo each. See
 * docs/arch/workouts.md.
 *
 * **Nothing is bundled.** The photos are fetched from the dataset's own
 * hosting when someone opens an exercise, and only while Settings › Workouts ›
 * Exercise photos is on (it ships off: this is a request nobody made by a tap,
 * and "no key, no traffic" is not a privacy answer on its own, CLAUDE.md).
 * Bundling about 300 photos at 50 to 70 KB each was the alternative and was
 * rejected for the size of the app.
 *
 * **The map is written by hand and checked by hand.** Matching by name paired
 * "Barbell bench press" with the dumbbell one and "Dumbbell curl" with a
 * dumbbell clean, and a photo of the wrong movement is worse than none. So an
 * exercise with no confident match is left out (about a seventh of the
 * library: isometrics, carries, cardio with no machine, the variations the set
 * has no photo of), and the page simply has no photos for it. A handful of
 * entries are the nearest variation rather than the same movement, and say so
 * where they sit. A custom
 * exercise never has any, and neither does one the person has renamed away
 * from a built-in's id, since the key is the id and the id is forever.
 */

/** The key is the library slug (the id without `lib:`), the value is free-exercise-db's id. */
const FREE_EXERCISE_DB_IDS: Readonly<Record<string, string>> = {
  'barbell-bench-press': 'Barbell_Bench_Press_-_Medium_Grip',
  'incline-barbell-bench-press': 'Barbell_Incline_Bench_Press_-_Medium_Grip',
  'decline-barbell-bench-press': 'Decline_Barbell_Bench_Press',
  'close-grip-bench-press': 'Close-Grip_Barbell_Bench_Press',
  'barbell-floor-press': 'Floor_Press',
  'dumbbell-bench-press': 'Dumbbell_Bench_Press',
  'incline-dumbbell-bench-press': 'Incline_Dumbbell_Press',
  'decline-dumbbell-bench-press': 'Decline_Dumbbell_Bench_Press',
  'dumbbell-fly': 'Dumbbell_Flyes',
  'incline-dumbbell-fly': 'Incline_Dumbbell_Flyes',
  'machine-chest-press': 'Machine_Bench_Press',
  'smith-machine-bench-press': 'Smith_Machine_Bench_Press',
  'smith-machine-incline-press': 'Smith_Machine_Incline_Bench_Press',
  'pec-deck': 'Butterfly',
  'cable-fly': 'Cable_Crossover',
  'low-to-high-cable-fly': 'Low_Cable_Crossover',
  'high-to-low-cable-fly': 'Cable_Crossover',
  'push-up': 'Pushups',
  'incline-push-up': 'Incline_Push-Up',
  'decline-push-up': 'Decline_Push-Up',
  'diamond-push-up': 'Push-Ups_-_Close_Triceps_Position',
  'chest-dip': 'Dips_-_Chest_Version',
  'weighted-dip': 'Parallel_Bar_Dip',
  'assisted-dip': 'Dip_Machine',
  'ring-dip': 'Ring_Dips',
  'deadlift': 'Barbell_Deadlift',
  'sumo-deadlift': 'Sumo_Deadlift',
  'romanian-deadlift': 'Romanian_Deadlift',
  'stiff-leg-deadlift': 'Stiff-Legged_Barbell_Deadlift',
  'trap-bar-deadlift': 'Trap_Bar_Deadlift',
  'deficit-deadlift': 'Deficit_Deadlift',
  'rack-pull': 'Rack_Pulls',
  'good-morning': 'Good_Morning',
  'barbell-row': 'Bent_Over_Barbell_Row',
  't-bar-row': 'T-Bar_Row_with_Handle',
  'dumbbell-row': 'One-Arm_Dumbbell_Row',
  'two-arm-dumbbell-row': 'Bent_Over_Two-Dumbbell_Row',
  'chest-supported-dumbbell-row': 'Dumbbell_Incline_Row',
  'seated-cable-row': 'Seated_Cable_Rows',
  'single-arm-cable-row': 'Seated_One-arm_Cable_Pulley_Rows',
  'inverted-row': 'Inverted_Row',
  'pull-up': 'Pullups',
  'chin-up': 'Chin-Up',
  'weighted-pull-up': 'Weighted_Pull_Ups',
  'band-assisted-pull-up': 'Band_Assisted_Pull-Up',
  'muscle-up': 'Muscle_Up',
  'lat-pulldown': 'Wide-Grip_Lat_Pulldown',
  'close-grip-lat-pulldown': 'Close-Grip_Front_Lat_Pulldown',
  'straight-arm-pulldown': 'Straight-Arm_Pulldown',
  'back-extension': 'Hyperextensions_Back_Extensions',
  'reverse-hyperextension': 'Reverse_Hyperextension',
  'barbell-shrug': 'Barbell_Shrug',
  'dumbbell-shrug': 'Dumbbell_Shrug',
  'face-pull': 'Face_Pull',
  'band-pull-apart': 'Band_Pull_Apart',
  'overhead-press': 'Standing_Military_Press',
  'push-press': 'Push_Press',
  'seated-barbell-shoulder-press': 'Seated_Barbell_Military_Press',
  'dumbbell-shoulder-press': 'Dumbbell_Shoulder_Press',
  'arnold-press': 'Arnold_Dumbbell_Press',
  'machine-shoulder-press': 'Machine_Shoulder_Military_Press',
  'smith-machine-shoulder-press': 'Smith_Machine_Overhead_Shoulder_Press',
  'dumbbell-lateral-raise': 'Side_Lateral_Raise',
  'cable-lateral-raise': 'Cable_Seated_Lateral_Raise',
  'dumbbell-front-raise': 'Front_Dumbbell_Raise',
  'barbell-upright-row': 'Upright_Barbell_Row',
  'reverse-dumbbell-fly': 'Reverse_Flyes',
  'reverse-pec-deck': 'Reverse_Machine_Flyes',
  'cable-reverse-fly': 'Cable_Rear_Delt_Fly',
  'handstand-push-up': 'Handstand_Push-Ups',
  'barbell-curl': 'Barbell_Curl',
  'ez-bar-curl': 'EZ-Bar_Curl',
  'dumbbell-curl': 'Dumbbell_Bicep_Curl',
  'hammer-curl': 'Hammer_Curls',
  'incline-dumbbell-curl': 'Incline_Dumbbell_Curl',
  'preacher-curl': 'Preacher_Curl',
  'machine-preacher-curl': 'Machine_Preacher_Curls',
  'concentration-curl': 'Concentration_Curls',
  'spider-curl': 'Spider_Curl',
  'cable-curl': 'Standing_Biceps_Cable_Curl',
  'reverse-curl': 'Reverse_Barbell_Curl',
  'triceps-pushdown': 'Triceps_Pushdown',
  'rope-pushdown': 'Triceps_Pushdown_-_Rope_Attachment',
  'overhead-cable-triceps-extension': 'Cable_Rope_Overhead_Triceps_Extension',
  'overhead-dumbbell-triceps-extension': 'Standing_Dumbbell_Triceps_Extension',
  'skull-crusher': 'EZ-Bar_Skullcrusher',
  'jm-press': 'JM_Press',
  'machine-triceps-extension': 'Machine_Triceps_Extension',
  'dumbbell-kickback': 'Tricep_Dumbbell_Kickback',
  'bench-dip': 'Bench_Dips',
  'wrist-curl': 'Palms-Up_Barbell_Wrist_Curl_Over_A_Bench',
  'reverse-wrist-curl': 'Palms-Down_Wrist_Curl_Over_A_Bench',
  'farmers-carry': 'Farmers_Walk',
  'back-squat': 'Barbell_Squat',
  'front-squat': 'Front_Barbell_Squat',
  'box-squat': 'Box_Squat',
  'zercher-squat': 'Zercher_Squats',
  'goblet-squat': 'Goblet_Squat',
  'smith-machine-squat': 'Smith_Machine_Squat',
  'hack-squat': 'Hack_Squat',
  'leg-press': 'Leg_Press',
  'bodyweight-squat': 'Bodyweight_Squat',
  'jump-squat': 'Freehand_Jump_Squat',
  'split-squat': 'Split_Squat_with_Dumbbells',
  'reverse-lunge': 'Dumbbell_Rear_Lunge',
  'barbell-lunge': 'Barbell_Lunge',
  'step-up': 'Dumbbell_Step_Ups',
  'leg-extension': 'Leg_Extensions',
  'lying-leg-curl': 'Lying_Leg_Curls',
  'seated-leg-curl': 'Seated_Leg_Curl',
  'glute-ham-raise': 'Glute_Ham_Raise',
  'hip-thrust': 'Barbell_Hip_Thrust',
  'glute-bridge': 'Barbell_Glute_Bridge',
  'single-leg-glute-bridge': 'Single_Leg_Glute_Bridge',
  'cable-pull-through': 'Pull_Through',
  'cable-glute-kickback': 'One-Legged_Cable_Kickback',
  'hip-abduction-machine': 'Thigh_Abductor',
  'hip-adduction-machine': 'Thigh_Adductor',
  'standing-calf-raise': 'Standing_Calf_Raises',
  'seated-calf-raise': 'Seated_Calf_Raise',
  'leg-press-calf-raise': 'Calf_Press_On_The_Leg_Press_Machine',
  'sled-push': 'Sled_Push',
  'plank': 'Plank',
  'side-plank': 'Side_Bridge',
  'crunch': 'Crunches',
  'bicycle-crunch': 'Air_Bike',
  'sit-up': 'Sit-Up',
  'cable-crunch': 'Cable_Crunch',
  'machine-crunch': 'Ab_Crunch_Machine',
  'hanging-leg-raise': 'Hanging_Leg_Raise',
  'ab-wheel-rollout': 'Ab_Roller',
  'dead-bug': 'Dead_Bug',
  'russian-twist': 'Russian_Twist',
  'mountain-climber': 'Mountain_Climbers',
  'pallof-press': 'Pallof_Press',
  'cable-woodchop': 'Standing_Cable_Wood_Chop',
  'landmine-rotation': 'Landmine_180s',
  'power-clean': 'Power_Clean',
  'hang-clean': 'Hang_Clean',
  'clean-and-jerk': 'Clean_and_Jerk',
  'snatch': 'Snatch',
  'kettlebell-clean': 'One-Arm_Kettlebell_Clean',
  'box-jump': 'Front_Box_Jump',
  'medicine-ball-slam': 'One-Arm_Medicine_Ball_Slam',
  'battle-ropes': 'Battling_Ropes',
  'treadmill-run': 'Running_Treadmill',
  'incline-treadmill-walk': 'Walking_Treadmill',
  'cycling': 'Bicycling',
  'stationary-bike': 'Bicycling_Stationary',
  'rowing-machine': 'Rowing_Stationary',
  'elliptical': 'Elliptical_Trainer',
  'stair-climber': 'Stairmaster',
  'jump-rope': 'Rope_Jumping',
  // The same movement, or the nearest the set has: a Pendlay row shows the
  // barbell row it comes from, a pistol squat the kettlebell one, and so on.
  'dumbbell-pullover': 'Bent-Arm_Dumbbell_Pullover',
  'dumbbell-romanian-deadlift': 'Stiff-Legged_Dumbbell_Deadlift',
  'pendlay-row': 'Bent_Over_Barbell_Row',
  'machine-row': 'Leverage_Iso_Row',
  'kettlebell-swing': 'One-Arm_Kettlebell_Swings',
  'kettlebell-press': 'One-Arm_Kettlebell_Military_Press_To_The_Side',
  'dumbbell-skull-crusher': 'Lying_Dumbbell_Tricep_Extension',
  'pause-squat': 'Barbell_Squat',
  'pistol-squat': 'Kettlebell_Pistol_Squat',
  'sissy-squat': 'Weighted_Sissy_Squat',
  'walking-lunge': 'Bodyweight_Walking_Lunge',
  'hanging-knee-raise': 'Hanging_Leg_Raise',
  'captains-chair-knee-raise': 'Knee_Hip_Raise_On_Parallel_Bars',
  'toes-to-bar': 'Hanging_Pike',
  'lying-leg-raise': 'Flat_Bench_Lying_Leg_Raise',
  'v-up': 'Jackknife_Sit-Up',
  'turkish-get-up': 'Kettlebell_Turkish_Get-Up_Squat_style',
  'banded-lateral-walk': 'Monster_Walk',
};

/** Where the dataset's photos are served from: its README's own hosted address. */
export const EXERCISE_IMAGE_BASE_URL =
  'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/';

export interface ExercisePhotos {
  /** The first photo of the movement, the starting position. */
  start: string;
  /** The second, the other end of the movement. */
  end: string;
}

/** Every library slug that has photos, for the test that keeps the map honest. */
export const PHOTOGRAPHED_SLUGS: readonly string[] = Object.keys(FREE_EXERCISE_DB_IDS);

/** The photos for an exercise id, or null for a custom one and for a built-in the map leaves out. */
export function exercisePhotos(exerciseId: string): ExercisePhotos | null {
  if (!exerciseId.startsWith(LIBRARY_ID_PREFIX)) return null;
  const dbId = FREE_EXERCISE_DB_IDS[exerciseId.slice(LIBRARY_ID_PREFIX.length)];
  if (!dbId) return null;
  const base = `${EXERCISE_IMAGE_BASE_URL}${dbId}/`;
  return { start: `${base}0.jpg`, end: `${base}1.jpg` };
}
