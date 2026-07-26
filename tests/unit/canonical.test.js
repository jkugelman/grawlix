import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasAccent, startsLowercase, hasInternalCap, isTitleCase,
  pickSameNorm, leadBold, decideWikipediaForm, chooseCanonical, isRicher,
  firstLetterUncertain, settleFirstLetter,
} from '../../site/src/engine/canonical.js';
import { toNorm } from '../../site/src/engine/norm.js';

test('hasInternalCap catches camelCase brands, not space-separated Title Case', () => {
  assert.equal(hasInternalCap('macOS'), true);
  assert.equal(hasInternalCap('eBay'), true);
  assert.equal(hasInternalCap('iPhone'), true);
  assert.equal(hasInternalCap('Helen of Troy'), false);  // caps follow spaces, not letters
  assert.equal(hasInternalCap('MACOS'), false);          // no lowercase to precede a cap
  assert.equal(hasInternalCap('macos'), false);
});

test('startsLowercase / hasAccent / isTitleCase', () => {
  assert.equal(startsLowercase('café'), true);
  assert.equal(startsLowercase('Café'), false);
  assert.equal(startsLowercase('iPhone'), true);
  assert.equal(hasAccent('naïveté'), true);
  assert.equal(hasAccent('cafe'), false);
  assert.equal(isTitleCase('Helen of Troy'), true);   // Troy caps
  assert.equal(isTitleCase('café au lait'), false);
  assert.equal(isTitleCase('macOS'), false);           // single word
});

test('isRicher accepts pure additions of caps, accents, and punctuation', () => {
  assert.equal(isRicher('Helen of Troy', 'helen of troy'), true);   // caps added
  assert.equal(isRicher('café', 'cafe'), true);                     // accent added
  assert.equal(isRicher('naïveté', 'naivete'), true);               // two accents added
  assert.equal(isRicher("O'Hara", 'OHara'), true);                  // apostrophe added, caps kept
  assert.equal(isRicher('Zoé', 'Zoe'), true);                       // accent added, capital kept
});

test('isRicher treats spaces as structural: addable and swappable for punctuation', () => {
  assert.equal(isRicher('well-being', 'well being'), true);     // space → hyphen (punctuation added)
  assert.equal(isRicher('New York', 'NewYork'), true);          // space added
  assert.equal(isRicher('self esteem', 'self-esteem'), false);  // hyphen removed — punctuation is protected
  assert.equal(isRicher('wellbeing', 'well being'), false);     // space removed, nothing added — not richer
});

test('isRicher rejects anything that removes caps, accents, or punctuation', () => {
  assert.equal(isRicher('zoé', 'Zoe'), false);    // accent added BUT capital removed — the reported miss
  assert.equal(isRicher('cafe', 'café'), false);  // accent removed
  assert.equal(isRicher('dna', 'DNA'), false);    // capital removed
  assert.equal(isRicher('dont', "don't"), false); // apostrophe removed
  assert.equal(isRicher('è', 'é'), false);        // accent swapped, not a superset
});

test('isRicher rejects the no-op', () => {
  assert.equal(isRicher('helen of troy', 'helen of troy'), false);
});

test('isRicher bails safe on fold chars rather than mis-aligning', () => {
  // ß/æ norm to two letters, breaking the 1:1 alignment — better no suggestion.
  assert.equal(isRicher('Straße', 'strasse'), false);
  assert.equal(isRicher('Æther', 'aether'), false);
});

test('pickSameNorm keeps only same-norm titles', () => {
  assert.equal(pickSameNorm(['San Diego County', 'San Diego'], toNorm('sandiego')), 'San Diego');
  assert.equal(pickSameNorm(['Gloucestershire'], toNorm('grouchiest')), null);
  assert.equal(pickSameNorm([], 'anything'), null);
});

test('pickSameNorm tier order: internalCap > lowercaseFirst > accent > flat', () => {
  assert.equal(pickSameNorm(['macos', 'macOS', 'Macos'], toNorm('macos')), 'macOS');
  assert.equal(pickSameNorm(['Café', 'café'], toNorm('cafe')), 'café');
  assert.equal(pickSameNorm(['Emigre', 'émigré'], toNorm('emigre')), 'émigré');
});

test('pickSameNorm breaks accent ties toward the most diacritics', () => {
  assert.equal(
    pickSameNorm(['naivete', 'naïvete', 'naiveté', 'naïveté'], toNorm('naivete')),
    'naïveté',
  );
});

test('pickSameNorm uses Wikipedia corroboration only to break an exact tie', () => {
  const gdansk = ['Gdansk', 'Gdaňsk', 'Gdańsk'];   // caron sorts before the acute
  // Gdańsk and Gdaňsk tie on score and diacritic count, so without a hint the
  // first-listed (caron) wins; Wikipedia's article corroborates the acute.
  assert.equal(pickSameNorm(gdansk, toNorm('gdansk')), 'Gdaňsk');
  assert.equal(pickSameNorm(gdansk, toNorm('gdansk'), 'Gdańsk'), 'Gdańsk');
  // Corroboration is the LAST tiebreak — it never pulls down to a less-accented
  // form even when Wikipedia returned that flatter spelling.
  assert.equal(pickSameNorm(['café', 'Cafe'], toNorm('cafe'), 'Cafe'), 'café');
});

test('leadBold extracts the lead, strips tags/entities and trailing suffixes', () => {
  assert.equal(leadBold('<p>The <b>iPhone</b> is a line…').text, 'iPhone');
  assert.equal(leadBold('<p><b>macOS</b> is a…').text, 'macOS');
  assert.equal(leadBold('<p><b>Helen of <i>Troy</i></b> was…').text, 'Helen of Troy');
  assert.equal(leadBold('<p><b>AT&amp;T</b> is…').text, 'AT&T');
  assert.equal(leadBold('<p><b>Apple Inc.</b> is…').text, 'Apple');
  assert.equal(leadBold('<p><b>Helen of Troy (company)</b> is…').text, 'Helen of Troy');
  assert.equal(leadBold('<p>no bold here</p>').text, null);
});

test('leadBold flags a sentence-initial bold through intervening wrappers', () => {
  assert.equal(leadBold('<p><b>Ground frost</b> is a…').atStart, true);
  assert.equal(leadBold('<p><i><b>Café au lait</b></i> is coffee…').atStart, true);
  assert.equal(leadBold('<p>In fashion, an <b>accessory</b> is…').atStart, false);
  assert.equal(leadBold('<p>The <b>Bunsen burner</b>, named after…').atStart, false);
  assert.equal(leadBold('<p>no bold here</p>').atStart, false);
});

test('firstLetterUncertain: only a multiword form capitalized on the first letter alone', () => {
  assert.equal(firstLetterUncertain('Fashion accessory'), true);
  assert.equal(firstLetterUncertain('Ground frost'), true);
  assert.equal(firstLetterUncertain("Parkinson's disease"), true);
  assert.equal(firstLetterUncertain('Café au lait'), true);
  assert.equal(firstLetterUncertain('Helen of Troy'), false);  // later capital corroborates
  assert.equal(firstLetterUncertain('DNA sequencer'), false);  // downcasing would give dNA
  assert.equal(firstLetterUncertain('macOS'), false);          // single word
  assert.equal(firstLetterUncertain('Zeus'), false);           // single word — no evidence
  assert.equal(firstLetterUncertain('iPhone case'), false);    // already lowercase-initial
  assert.equal(firstLetterUncertain('fashion accessory'), false);
});

test('settleFirstLetter rules on the leading letter alone, keeping the cap without evidence', () => {
  assert.equal(settleFirstLetter('Fashion accessory', 'fashion'), 'fashion accessory');
  assert.equal(settleFirstLetter('Ground frost', 'ground'), 'ground frost');
  assert.equal(settleFirstLetter("Parkinson's disease", "Parkinson's"), "Parkinson's disease");
  assert.equal(settleFirstLetter('French toast', 'French'), 'French toast');
  // Absent → keep. A first word in none of the wordlists is the rare/proper-noun case
  // the fallback is betting on, so the cap it preserves is the correct one.
  assert.equal(settleFirstLetter('Chandrasekhar limit', null), 'Chandrasekhar limit');
  // Only position 0 changes: adopting the wordlist's spelling would flatten the accent.
  assert.equal(settleFirstLetter('Café au lait', 'cafe'), 'café au lait');
});

test('decideWikipediaForm trusts a norm-matching bold, else keeps the force-capped title', () => {
  assert.equal(decideWikipediaForm('iPhone', 'IPhone', toNorm('iphone')), 'iPhone');
  assert.equal(decideWikipediaForm('macOS', 'MacOS', toNorm('macos')), 'macOS');
  assert.equal(decideWikipediaForm('Apple Inc', 'Apple', toNorm('apple')), 'Apple');
  assert.equal(decideWikipediaForm(null, 'Helen of Troy', toNorm('helenoftroy')), 'Helen of Troy');
});

test('chooseCanonical: Wiktionary wins ties, Wikipedia only for an exclusive internal cap', () => {
  assert.equal(chooseCanonical('café au lait', 'Café au lait'), 'café au lait');  // neither internal-cap → wiktionary
  assert.equal(chooseCanonical('macos', 'macOS'), 'macOS');                       // only wikipedia is stylized
  assert.equal(chooseCanonical('eBay', 'Ebay'), 'eBay');                          // wiktionary already stylized
  assert.equal(chooseCanonical('émigré', null), 'émigré');
  assert.equal(chooseCanonical(null, 'Helen of Troy'), 'Helen of Troy');
  assert.equal(chooseCanonical(null, null), null);
});
