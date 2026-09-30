// Phone search highlight cases, checked against real CMU pronunciations: search
// `query`, and `entry` must match with exactly `marks` highlighted, in order.
// After adding a row with new words, refresh their pronunciations:
//
//   node scripts/phone-cases-dict.js
export const CASES = [
  // Vowel spellings
  ['eye', 'fire pit', ['i']],
  ['eye', 'right-to-work', ['igh']],
  ['eye', 'Louis Brandeis', ['ei']],
  ['ate', 'eight-legged', ['eight']],
  ['oar', 'Creek War', ['ar']],
  ['ewe', 'tissue paper', ['ue']],
  ['sew', 'soaking wet', ['soa']],
  ['air', 'jump scare', ['are']],
  ['owl', 'beach towel', ['owel']],
  ['ache', 'Breaking Bad', ['eak']],
  ['gnaw', 'NASA astronaut', ['nau']],
  ['bough', 'Bilbao', ['bao']],
  ['hour', 'flower girls', ['ower']],
  ['tire', 'satire', ['tire']],

  // Consonant spellings and silent letters
  ['knight', 'United States', ['nit']],
  ['wrap', 'rhapsodic', ['rhap']],
  ['phone', 'sinfonia', ['fon']],
  ['quiche', 'Waukesha', ['kesh']],
  ['shoe', 'bisexual', ['xu']],
  ['box', 'jukebox', ['box']],
  ['judge', 'judgment', ['judg']],
  ['sing', 'convincing', ['cing']],
  ['laugh', 'laughter', ['laugh']],
  ['tough', 'artificial', ['tif']],
  ['cough', 'Schwarzkopf', ['kopf']],
  ['cat', 'cattle', ['catt']],
  ['night', 'Bob Knight', ['Knight']],

  // A vowel letter keeps its vowel: -ian, -en, -ens aren't a syllabic n
  ['knee', 'Abyssinian', ['ni']],
  ['knee', 'honey', ['ney']],
  ['edge', 'Honda Legend', ['eg']],
  ['height', 'heightens', ['height']],
  ['seven', 'seventeen', ['seven']],

  // Unstressed syllables
  ['are', 'arbiter', ['ar']],
  ['bitter', 'arbiter', ['biter']],

  // Across word breaks
  ['ate', 'hallway test', ['ay', 't']],
  ['ear', 'army recruit', ['y', 'r']],
  ['oil', 'A Boy Like That', ['oy', 'L']],
  ['knight', 'can I talk now', ['n', 'I', 't']],
  ['chord', 'drink order', ['k', 'ord']],
  ['tea', 'not even', ['t', 'e']],
  ['phone', 'self-owning', ['f', 'own']],

  // Weak forms left off WEAK_FORMS
  ['uh', 'a lot', ['a']],
  ['ate', 'threw a tantrum', ['a', 't']],
  ['thee', 'the apple', ['the']],

  // Initialisms
  ['ewe', 'BMW', ['W']],
];
