// A curated emoji set for the picker (no library needed): the emoji, then words to search it by.
// Your phone keyboard's emojis work everywhere too; this is for quick picking and reactions.

const raw: Record<string, string> = {
  Smileys: `😀 grin happy smile|😃 smile happy joy|😄 laugh happy|😁 beam grin|😆 laugh squint|😅 sweat relief|🤣 rofl rolling laugh|😂 joy tears laugh lol|🙂 slight smile|🙃 upside down silly|😉 wink|😊 blush happy|😇 angel innocent|🥰 love hearts adore|😍 heart eyes love|🤩 star struck wow|😘 kiss blow|😋 yum tasty|😛 tongue|😜 wink tongue crazy|🤪 zany crazy|😝 tongue squint|🤗 hug|🤭 oops giggle|🤫 shush quiet|🤔 think hmm|🫡 salute|🤐 zip mouth|🤨 raised eyebrow|😐 neutral meh|😑 expressionless|😶 speechless|🫥 dotted invisible|😏 smirk|😒 unamused|🙄 eye roll|😬 grimace awkward|😮‍💨 exhale sigh|😌 relieved calm|😔 pensive sad|😪 sleepy|😴 sleep zzz|😷 mask sick|🥵 hot|🥶 cold freezing|🥴 woozy dizzy|😵‍💫 dizzy spiral|🤯 mind blown|🤠 cowboy|🥳 party celebrate|🥸 disguise|😎 cool sunglasses|🤓 nerd|🧐 monocle|😕 confused|🫤 diagonal mouth meh|😟 worried|🙁 frown|😮 wow open mouth|😯 hushed|😲 astonished|😳 flushed embarrassed|🥺 pleading puppy eyes|🥹 holding tears grateful|😦 frowning|😧 anguished|😨 fearful scared|😰 anxious sweat|😥 sad relieved|😢 cry tear|😭 sob crying|😱 scream shock|😖 confounded|😣 persevere|😞 disappointed|😓 downcast sweat|😩 weary|😫 tired|🥱 yawn bored|😤 triumph huff|😡 angry rage|😠 mad angry|🤬 swearing cursing|😈 devil smile|💀 skull dead lol|🤡 clown|👻 ghost|👽 alien|🤖 robot|💩 poop|🫠 melting|🫣 peek shy|🤤 drool`,
  Love: `❤️ red heart love|🧡 orange heart|💛 yellow heart|💚 green heart|💙 blue heart|💜 purple heart|🖤 black heart|🤍 white heart|🤎 brown heart|🩷 pink heart|🩵 light blue heart|🩶 grey heart|❤️‍🔥 heart on fire passion|❤️‍🩹 mending heart|💔 broken heart|💕 two hearts|💞 revolving hearts|💓 beating heart|💗 growing heart|💖 sparkling heart|💘 cupid arrow|💝 heart gift|💟 heart decoration|💌 love letter|💋 kiss lips|🫶 heart hands|💑 couple|💐 bouquet flowers`,
  Gestures: `👍 thumbs up yes like|👎 thumbs down no|👏 clap applause|🙌 raise hands praise|👐 open hands|🤲 palms up|🙏 pray thanks please|🤝 handshake deal|✌️ peace victory|🤞 fingers crossed luck|🫰 finger heart|🤟 love you|🤘 rock on metal|🤙 call me shaka|👌 ok perfect|🤌 pinched italian|👈 left|👉 right|👆 up|👇 down|☝️ index up|✋ raised hand stop|🤚 back hand|🖐️ hand fingers|🖖 vulcan|👋 wave hi bye|💪 strong muscle flex|🫵 you point|✊ fist|👊 punch fist bump|🤛 left fist|🤜 right fist|🫂 hug people|💅 nails sassy|🙋 raise hand me|🤷 shrug idk|🤦 facepalm|🙇 bow|💃 dance woman|🕺 dance man|👯 dancers party|🧘 calm zen|👀 eyes look|👂 ear listen|🧠 brain smart`,
  'Music & party': `🎵 music note|🎶 notes melody|🎧 headphones listen|🎤 mic sing karaoke|🎸 guitar rock|🎹 piano keys|🥁 drum beat|🎷 sax jazz|🎺 trumpet|🎻 violin|🪕 banjo|🪘 long drum|📻 radio|🔊 loud speaker volume|🔉 speaker|🔇 mute|📢 loudspeaker|🎼 score|💿 cd|📀 dvd|🎙️ studio mic podcast|🎚️ slider|🎛️ knobs|🎉 party popper tada|🎊 confetti|🥂 cheers toast|🍾 champagne|🎂 birthday cake|🎁 gift present|🎈 balloon|🪩 disco ball|✨ sparkles magic|🌟 star glow|⭐ star|💫 dizzy star|🔥 fire lit hot|⚡ zap lightning energy|💥 boom|🎆 fireworks|🎇 sparkler|🪅 pinata|🏆 trophy winner|🥇 gold first|🎯 bullseye target|🎮 game|🕹️ joystick|🎬 film movie|🎭 theatre`,
  'Nature & food': `🌞 sun|🌙 moon night|🌈 rainbow|☁️ cloud|🌧️ rain|⛈️ storm|❄️ snow|🌊 wave ocean|🌸 cherry blossom|🌹 rose|🌻 sunflower|🌺 hibiscus|🍀 clover luck|🌴 palm beach|🌵 cactus|🍂 autumn leaves|🐶 dog puppy|🐱 cat kitty|🐼 panda|🦊 fox|🐸 frog|🐵 monkey|🙈 see no evil|🙉 hear no evil|🙊 speak no evil|🦄 unicorn|🐝 bee|🦋 butterfly|🐢 turtle|🐙 octopus|🐬 dolphin|🦉 owl|🐧 penguin|🍕 pizza|🍔 burger|🍟 fries|🌮 taco|🍣 sushi|🍜 noodles ramen|🍩 donut|🍪 cookie|🍫 chocolate|🍦 ice cream|🍿 popcorn|🍉 watermelon|🍓 strawberry|🍑 peach|🥑 avocado|🌶️ spicy pepper|☕ coffee|🍵 tea|🧋 boba bubble tea|🍺 beer|🍷 wine|🍹 cocktail|🧃 juice`,
  Symbols: `💯 hundred perfect|✅ check done yes|❌ cross no|❗ exclamation|❓ question|‼️ double bang|⁉️ interrobang|💤 sleep zzz|💢 anger|💬 speech chat|💭 thought|🗯️ shout|👑 crown king queen|💎 gem diamond|🔔 bell|🔕 no bell|📌 pin|🔗 link|🎗️ ribbon|☮️ peace|☯️ yin yang|♾️ infinity|🆗 ok|🆒 cool|🆕 new|🔝 top|🔜 soon|🚀 rocket launch|🛸 ufo|🌍 earth world|🏳️‍🌈 pride rainbow flag|🏁 finish flag|🚩 red flag|📸 photo camera|💡 idea bulb|⏰ alarm time|⌛ hourglass|🔁 repeat|🔀 shuffle|▶️ play|⏸️ pause|⏭️ next|⏮️ previous|🆙 up|☀️ sunny`,
}

export interface EmojiItem { e: string; words: string }
export const EMOJI_GROUPS: { name: string; items: EmojiItem[] }[] = Object.entries(raw).map(([name, list]) => ({
  name,
  items: list.split('|').map(entry => {
    const i = entry.indexOf(' ')
    return { e: entry.slice(0, i), words: entry.slice(i + 1) }
  }),
}))

export function searchEmoji(q: string): EmojiItem[] {
  const words = q.toLowerCase().trim().split(/\s+/).filter(Boolean)
  if (!words.length) return []
  return EMOJI_GROUPS.flatMap(g => g.items).filter(it => words.every(w => it.words.includes(w)))
}

// ---- recently used (this device) ----
const RECENT_KEY = 'jam:emoji-recent'
export function recentEmoji(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') } catch { return [] }
}
export function noteEmoji(e: string) {
  const next = [e, ...recentEmoji().filter(x => x !== e)].slice(0, 16)
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)) } catch { /* private mode */ }
}

/** 1–3 emojis and nothing else: shown big, without a bubble. */
export function isJumbo(text: string): boolean {
  const t = text.trim()
  if (!t || t.length > 24) return false
  if (!/^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|\s)+$/u.test(t) || /[#*0-9]/.test(t)) return false
  const graphemes = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(t.replace(/\s+/g, ''))]
  return graphemes.length >= 1 && graphemes.length <= 3
}
