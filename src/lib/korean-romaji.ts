// Builds one English-script retry for Korean spellings of Japanese place names.
// It is used only after a Korean search returns no provider results. The UI labels
// these results so the user checks the real provider name and address before choosing.

const initials = ["g", "kk", "n", "d", "tt", "r", "m", "b", "pp", "s", "ss", "", "j", "jj", "ch", "k", "t", "p", "h"];
const vowels = ["a", "e", "ya", "ye", "o", "e", "yo", "ye", "o", "wa", "we", "we", "yo", "u", "wo", "we", "wi", "yu", "u", "i", "i"];
// Korean renders Japanese voiceless stops as plain consonants at the start of a word.
const wordStart: Record<string, string> = { g: "k", d: "t" };
const consonantRomaji: Record<string, string> = { kk: "k", tt: "t", pp: "p", ss: "s", jj: "ts" };

// Common Korean place-type words and their usual English names in Japanese map data.
const placeTypes: [string, string][] = [
  ["백화점", "Department Store"], ["미술관", "Art Museum"], ["박물관", "Museum"], ["수족관", "Aquarium"],
  ["동물원", "Zoo"], ["시장", "Market"], ["공원", "Park"], ["신사", "Shrine"], ["공항", "Airport"],
  ["온천", "Onsen"], ["운하", "Canal"], ["타워", "Tower"], ["호텔", "Hotel"], ["대학", "University"],
  ["폭포", "Falls"], ["해변", "Beach"], ["역", "Station"], ["성", "Castle"],
];

function syllable(code: number, first: boolean) {
  const initial = initials[Math.floor(code / 588)];
  const vowel = vowels[Math.floor((code % 588) / 28)];
  let onset = consonantRomaji[initial] ?? (first ? wordStart[initial] ?? initial : initial);
  if (onset === "s" && vowel.startsWith("y")) return { text: "sh" + vowel.slice(1), onset: "s" };
  if (onset === "s" && vowel === "i") return { text: "shi", onset: "s" };
  if ((initial === "ss" || initial === "jj" || initial === "ch") && vowel === "u" && Math.floor((code % 588) / 28) === 18) {
    return { text: "tsu", onset: "t" };
  }
  if (initial === "j" && Math.floor((code % 588) / 28) === 18) return { text: "zu", onset: "z" };
  if (initial === "j" && vowel === "a") onset = "z";
  if (initial === "j" && vowel === "e") onset = "z";
  if (initial === "h" && vowel === "u") return { text: "fu", onset: "f" };
  if (onset === "j" && vowel.startsWith("y")) return { text: "j" + vowel.slice(1), onset: "j" };
  if (onset === "ch" && vowel.startsWith("y")) return { text: "ch" + vowel.slice(1), onset: "c" };
  return { text: onset + vowel, onset: onset.charAt(0) };
}

function romanizeWord(word: string) {
  const codes = [...word].map((character) => character.charCodeAt(0) - 0xac00);
  if (!codes.length || codes.some((code) => code < 0 || code > 11171)) return null;
  let text = "";
  let doubleNext = false;
  codes.forEach((code, index) => {
    const part = syllable(code, index === 0);
    text += doubleNext && part.onset && !"aeiouy".includes(part.onset) ? part.onset + part.text : part.text;
    doubleNext = false;
    const final = code % 28;
    if (final === 4 || final === 21) text += "n";
    else if (final === 19) doubleNext = true;
  });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Returns an English-script retry query for a Hangul query, or null when it cannot build one. */
export function koreanPlaceRetry(query: string) {
  if (!/\p{Script=Hangul}/u.test(query)) return null;
  const parts: string[] = [];
  for (const token of query.split(/\s+/).filter(Boolean)) {
    if (!/\p{Script=Hangul}/u.test(token)) { parts.push(token); continue; }
    const type = placeTypes.find(([korean]) => token.endsWith(korean));
    if (type && token === type[0]) { parts.push(type[1]); continue; }
    const stem = type ? token.slice(0, -type[0].length) : token;
    const word = romanizeWord(stem);
    if (!word) return null;
    parts.push(type ? word + " " + type[1] : word);
  }
  const retry = parts.join(" ");
  return retry && retry !== query ? retry : null;
}
