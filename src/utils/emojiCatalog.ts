/**
 * The emoji offered by `EmojiPickerSheet`.
 *
 * Deliberately a curated few hundred rather than the full Unicode set: this
 * picker exists to name a *category* — Work, Home, Errands, Money, Fitness —
 * and a complete keyboard-sized grid buries those behind a thousand faces. The
 * sheet's keyboard fallback reaches anything that isn't here.
 *
 * Each entry is written as `"<emoji> <keywords…>"` so a row stays one readable
 * line; `parse` splits it on the first space.
 */

export interface EmojiEntry {
  /** The emoji itself. */
  char: string;
  /** Space-separated search terms, lowercase. */
  keywords: string;
}

export interface EmojiGroup {
  name: string;
  /** Ionicons name for the group's tab. */
  icon: string;
  entries: EmojiEntry[];
}

const parse = (specs: string[]): EmojiEntry[] =>
  specs.map(spec => {
    const at = spec.indexOf(' ');
    return { char: spec.slice(0, at), keywords: spec.slice(at + 1).toLowerCase() };
  });

export const EMOJI_GROUPS: EmojiGroup[] = [
  {
    name: 'People',
    icon: 'happy-outline',
    entries: parse([
      '😀 smile happy grin face',
      '🙂 slight smile face',
      '😄 laugh happy joy',
      '😍 love heart eyes adore',
      '🥳 party celebrate birthday',
      '😎 cool sunglasses',
      '🤔 think thinking hmm',
      '😴 sleep tired rest nap',
      '😅 sweat nervous relief',
      '🥱 yawn tired bored',
      '😤 determined focus steam',
      '🤯 mind blown overwhelmed',
      '🫠 melting stress',
      '🤖 robot bot automation',
      '👋 wave hello hi greeting',
      '👍 thumbs up ok good yes',
      '🙏 pray thanks please gratitude',
      '💪 muscle strong strength gym',
      '👀 eyes look watch review',
      '🧠 brain mind think learn focus',
      '🦷 tooth teeth dental',
      '🧑‍💻 developer coding work laptop',
      '👩‍🍳 cook chef kitchen',
      '🧑‍🏫 teacher school class',
      '👶 baby kids child',
      '🧑‍🤝‍🧑 people friends social',
      '👨‍👩‍👧 family kids home',
      '🧘 meditate calm yoga mindfulness',
      '💤 sleep rest zzz',
      '🫶 heart hands love care',
    ]),
  },
  {
    name: 'Nature',
    icon: 'leaf-outline',
    entries: parse([
      '🐶 dog puppy pet',
      '🐱 cat kitten pet',
      '🐟 fish aquarium pet',
      '🐦 bird pet',
      '🌱 plant sprout grow garden',
      '🪴 plant pot houseplant water',
      '🌳 tree outdoors park',
      '🌸 blossom flower spring',
      '🌻 sunflower flower',
      '🍀 clover luck lucky',
      '🌍 earth world global travel',
      '☀️ sun sunny day weather',
      '🌤️ weather partly cloudy',
      '🌧️ rain weather wet',
      '❄️ snow cold winter freeze',
      '🌙 moon night evening',
      '⭐ star favourite important',
      '🔥 fire hot streak burn urgent',
      '💧 water drop hydrate',
      '🌊 wave ocean sea swim',
      '🌈 rainbow colour pride',
      '🌵 cactus desert plant',
      '🍂 autumn fall leaves season',
      '🐝 bee insect garden',
      '🦋 butterfly change',
      '🐾 paws pet animal',
      '🌞 sun morning bright',
      '🏔️ mountain hike outdoors',
    ]),
  },
  {
    name: 'Food',
    icon: 'restaurant-outline',
    entries: parse([
      '🍎 apple fruit healthy',
      '🍌 banana fruit',
      '🥑 avocado food healthy',
      '🥗 salad healthy lunch food',
      '🍞 bread bakery groceries',
      '🥕 carrot vegetable groceries',
      '🍕 pizza food dinner',
      '🍔 burger food fast',
      '🍣 sushi food dinner',
      '🍝 pasta food dinner',
      '🍳 cooking breakfast eggs',
      '🥘 cooking dinner meal',
      '🍱 lunch bento meal prep',
      '🧁 cupcake dessert baking treat',
      '🍰 cake dessert birthday',
      '🍫 chocolate treat snack',
      '☕ coffee caffeine morning',
      '🍵 tea drink calm',
      '🥤 drink soda',
      '🍺 beer drink pub social',
      '🍷 wine drink dinner',
      '🥂 celebrate toast cheers',
      '🧊 ice cold water',
      '🛒 groceries shopping food store',
      '🥛 milk dairy groceries',
      '🍯 honey sweet',
    ]),
  },
  {
    name: 'Activity',
    icon: 'basketball-outline',
    entries: parse([
      '⚽ football soccer sport',
      '🏀 basketball sport',
      '🎾 tennis sport',
      '🏸 badminton sport',
      '🏊 swim swimming sport',
      '🚴 cycling bike sport ride',
      '🏃 run running jog exercise cardio',
      '🚶 walk walking steps',
      '🏋️ gym weights lifting workout fitness',
      '🤸 stretch mobility exercise',
      '🥾 hike hiking walk outdoors',
      '⛷️ ski snow winter sport',
      '🎯 target goal focus aim',
      '🏆 trophy win goal achievement',
      '🎮 games gaming play video',
      '🎲 games board dice play',
      '🎸 guitar music practice band',
      '🎹 piano music practice',
      '🎤 sing music karaoke podcast',
      '🎨 art paint draw creative hobby',
      '📷 photo camera photography',
      '🎬 film movie video watch',
      '📚 books read reading study learn',
      '✏️ write writing draft notes',
      '🧩 puzzle problem hobby',
      '🪡 sewing craft hobby',
      '🎣 fishing hobby outdoors',
      '🧗 climb climbing sport',
    ]),
  },
  {
    name: 'Places',
    icon: 'airplane-outline',
    entries: parse([
      '🏠 home house personal',
      '🏡 home garden house',
      '🏢 office work building company',
      '🏫 school study class education',
      '🏥 hospital health doctor medical',
      '🏦 bank money finance',
      '🏪 shop store errands convenience',
      '⛪ church faith worship',
      '🏋️‍♀️ gym fitness workout',
      '🚗 car drive commute errands',
      '🚕 taxi cab ride',
      '🚌 bus transit commute',
      '🚆 train transit commute rail',
      '✈️ flight plane travel trip holiday',
      '🚲 bike bicycle commute',
      '🛵 scooter moped delivery',
      '🚢 boat ship cruise travel',
      '🗺️ map plan travel explore',
      '🧳 luggage packing trip travel',
      '🏝️ island beach holiday vacation',
      '⛺ camping tent outdoors',
      '🌆 city urban evening',
      '🛣️ road trip drive',
      '🅿️ parking car',
    ]),
  },
  {
    name: 'Objects',
    icon: 'briefcase-outline',
    entries: parse([
      '💼 work briefcase job business',
      '💻 laptop computer work coding',
      '🖥️ desktop computer setup',
      '📱 phone mobile call',
      '⌨️ keyboard typing computer',
      '🖨️ printer print office',
      '📝 notes write memo todo',
      '📋 clipboard list checklist tasks',
      '📅 calendar schedule date plan',
      '⏰ alarm clock time reminder',
      '⏳ timer deadline waiting time',
      '📊 chart stats report data analytics',
      '📈 growth progress chart metrics',
      '✉️ email mail inbox message',
      '📦 package delivery parcel shipping',
      '💰 money finance budget savings',
      '💳 card payment bills spending',
      '🧾 receipt bills expenses invoice',
      '🔑 keys access security',
      '🔒 lock secure password privacy',
      '🛠️ tools diy repair maintenance fix',
      '🔧 wrench repair fix maintenance',
      '🧹 clean cleaning chores tidy sweep',
      '🧺 laundry washing chores basket',
      '🧽 sponge clean dishes chores',
      '🧴 lotion skincare care',
      '🪥 toothbrush teeth hygiene routine',
      '💊 medicine pills health meds',
      '🩺 doctor health checkup medical',
      '🛏️ bed sleep bedroom rest',
      '🚿 shower bathroom routine',
      '🪑 furniture chair home',
      '🎁 gift present birthday',
      '🕯️ candle calm evening',
      '📖 journal diary reading',
      '🔋 battery energy charge',
      '💡 idea lightbulb inspiration',
      '🗑️ bin trash rubbish declutter',
    ]),
  },
  {
    name: 'Symbols',
    icon: 'heart-outline',
    entries: parse([
      '❤️ heart love favourite',
      '🧡 heart orange love',
      '💛 heart yellow love',
      '💚 heart green love',
      '💙 heart blue love',
      '💜 heart purple love',
      '✅ done complete check tick',
      '☑️ checkbox done task',
      '❗ important urgent alert',
      '⚠️ warning caution careful',
      '🔔 reminder notification bell alert',
      '📌 pin pinned important',
      '🚩 flag priority mark',
      '♻️ recycle sustainable green reuse',
      '🔁 repeat recurring loop routine',
      '⚡ energy fast quick power',
      '✨ sparkle new magic nice',
      '💯 hundred perfect goal',
      '🆕 new fresh',
      '🔴 red circle colour dot',
      '🟠 orange circle colour dot',
      '🟡 yellow circle colour dot',
      '🟢 green circle colour dot',
      '🔵 blue circle colour dot',
      '🟣 purple circle colour dot',
      '⚫ black circle colour dot',
      '⚪ white circle colour dot',
      '🔺 triangle red priority',
      '➕ plus add new',
      '❓ question unknown ask',
    ]),
  },
];

/** Every catalog entry, flattened — the search corpus. */
export const ALL_EMOJI: EmojiEntry[] = EMOJI_GROUPS.flatMap(g => g.entries);

/**
 * Catalog entries matching `query`, best first.
 *
 * A keyword that *starts* with the query outranks one that merely contains it,
 * so "car" puts 🚗 ahead of 🃏-style incidental matches; ties keep catalog
 * order. An empty query matches nothing — the caller shows the groups instead.
 */
export function searchEmoji(query: string, limit = 60): EmojiEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const starts: EmojiEntry[] = [];
  const contains: EmojiEntry[] = [];
  for (const entry of ALL_EMOJI) {
    if (entry.char === q) { starts.push(entry); continue; }
    const words = entry.keywords.split(' ');
    if (words.some(w => w.startsWith(q))) starts.push(entry);
    else if (entry.keywords.includes(q)) contains.push(entry);
  }
  return [...starts, ...contains].slice(0, limit);
}
