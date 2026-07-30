export function formatPrice(amount) {
  const numericAmount = Number(amount);

  return `${numericAmount.toLocaleString("uz-UZ")} so'm`;
}

export const PHONE_REGEX = /^\+?\d{9,15}$/;

export function normalizePhoneNumber(rawPhone) {
  const digitsOnly = rawPhone.replace(/[\s()-]/g, "");
  return digitsOnly.startsWith("+") ? digitsOnly : `+${digitsOnly}`;
}

export function buildGoogleMapsLink(latitude, longitude) {
  return `https://www.google.com/maps?q=${latitude},${longitude}`;
}

export function sanitizeForMarkdown(text) {
  return String(text).replace(/[_*`[\]]/g, "");
}

const MULTI_CHAR_LATIN_TO_CYRILLIC = [
  ["yo", "ё"],
  ["yu", "ю"],
  ["ya", "я"],
  ["ye", "е"],
  ["sh", "ш"],
  ["ch", "ч"],
  ["o'", "ў"],
  ["o‘", "ў"],
  ["oʻ", "ў"],
  ["g'", "ғ"],
  ["g‘", "ғ"],
  ["gʻ", "ғ"],
];

const SINGLE_CHAR_LATIN_TO_CYRILLIC = {
  a: "а",
  b: "б",
  c: "к",
  d: "д",
  e: "е",
  f: "ф",
  g: "г",
  h: "ҳ",
  i: "и",
  j: "ж",
  k: "к",
  l: "л",
  m: "м",
  n: "н",
  o: "о",
  p: "п",
  q: "қ",
  r: "р",
  s: "с",
  t: "т",
  u: "у",
  v: "в",
  x: "х",
  y: "й",
  z: "з",
};

const URL_PATTERN = /(https?:\/\/[^\s)]+)/g;
const LATIN_LETTER_PATTERN = /[a-zA-Z]/;

function applyMatchedCase(originalChunk, cyrillicReplacement) {
  if (originalChunk === originalChunk.toUpperCase() && originalChunk !== originalChunk.toLowerCase()) {
    return cyrillicReplacement.toUpperCase();
  }

  if (originalChunk[0] === originalChunk[0].toUpperCase() && originalChunk[0] !== originalChunk[0].toLowerCase()) {
    return cyrillicReplacement[0].toUpperCase() + cyrillicReplacement.slice(1);
  }

  return cyrillicReplacement;
}

function transliterateLatinSegment(segment) {
  let result = "";
  let i = 0;

  while (i < segment.length) {
    let matchedMultiChar = false;

    for (const [latin, cyrillic] of MULTI_CHAR_LATIN_TO_CYRILLIC) {
      const chunk = segment.slice(i, i + latin.length);

      if (chunk.toLowerCase() === latin) {
        result += applyMatchedCase(chunk, cyrillic);
        i += latin.length;
        matchedMultiChar = true;
        break;
      }
    }

    if (matchedMultiChar) {
      continue;
    }

    const char = segment[i];
    const lowerChar = char.toLowerCase();
    const cyrillicChar = SINGLE_CHAR_LATIN_TO_CYRILLIC[lowerChar];

    if (cyrillicChar) {
      const isWordStart = i === 0 || !LATIN_LETTER_PATTERN.test(segment[i - 1]);
      const replacement = lowerChar === "e" && isWordStart ? "э" : cyrillicChar;
      result += applyMatchedCase(char, replacement);
    } else {
      result += char;
    }

    i += 1;
  }

  return result;
}

export function transliterateToCyrillic(text) {
  if (!text) {
    return text;
  }

  const segments = String(text).split(URL_PATTERN);

  return segments
    .map((segment, index) => (index % 2 === 1 ? segment : transliterateLatinSegment(segment)))
    .join("");
}
