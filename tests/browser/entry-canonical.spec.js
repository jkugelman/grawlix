// Canonical-form resolution in the entry panel: the "Rename to" hint upgrades
// from raw segmenter spacing to the reference-canonical spelling (Feature A), and
// empty inline lookups fall back to the resolved form's lookups (Feature B). The
// reference APIs are stubbed so "helen of troy" resolves to "Helen of Troy" and
// everything else stays empty — no real network, deterministic casing.

import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

const panel = page => page.locator('#entry-panel');
const link = page => panel(page).locator('.entry-panel-suggest-link');
const lookup = page => panel(page).locator('.entry-panel-lookup');

// Registered after gotoApp's catch-all 404 lookup stubs, so these more-specific
// handlers win. Only the spaced query "helen of troy" resolves; the bare concat
// and every other query fall through to empty, so the bare entry draws a blank.
async function stubHelenOfTroy(page) {
  await page.route(/action=opensearch/, route => {
    if (/search=helen(?:%20|\+| )of(?:%20|\+| )troy/i.test(route.request().url())) {
      route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify(['helen of troy', ['Helen of Troy'], [''], ['https://en.wikipedia.org/wiki/Helen_of_Troy']]) });
    } else {
      route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
    }
  });
  await page.route(/rest_v1\/page\/summary\/Helen(?:%20|_|\+| )of/i, route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      title: 'Helen of Troy',
      extract: 'Helen was a figure in Greek mythology.',
      extract_html: '<p><b>Helen of Troy</b> was a figure in Greek mythology.</p>',
    }) }));
}

async function seed(page) {
  await gotoApp(page);
  await stubHelenOfTroy(page);
  await page.evaluate(w => window.__grawlixTest.addCustomWordlist(w),
    { name: 'Src', entries: ['helenoftroy', 'helen', 'of', 'troy'], scores: [50, 50, 50, 50] });
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await page.evaluate(c => window.__grawlixTest.setWorkerUnigramCorpus(c),
    { helen: -3, of: -2, troy: -3 });
}

async function openPanelFor(page, norm) {
  const cell = page.locator(`.entry-row[data-entry="${norm}"] .atom-entry`);
  await expect(cell).toBeVisible();
  await cell.click();
  await expect(panel(page)).toBeVisible();
}

test('rename hint upgrades from segmenter spacing to the canonical casing', async ({ page }) => {
  await seed(page);
  await openPanelFor(page, 'helenoftroy');
  await expect(link(page)).toHaveText('helen of troy');   // stage 1: plain spacing
  await expect(link(page)).toHaveText('Helen of Troy');   // stage 2: canonical, in place
});

test('an already-rich entry is offered a strictly richer respelling', async ({ page }) => {
  await gotoApp(page);
  await stubHelenOfTroy(page);
  await page.evaluate(w => window.__grawlixTest.addCustomWordlist(w),
    { name: 'Src', entries: ['helen of troy'], scores: [50] });
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());

  await openPanelFor(page, 'helenoftroy');
  await expect(link(page)).toHaveText('Helen of Troy');   // adds caps, removes nothing
});

// The resolver finds "zoé" for "Zoe": accent added, but it lowercases the Z. isRicher
// must reject it, or the hint strips a deliberate capital — the miss that motivated this.
async function stubZoe(page) {
  await page.route(/en\.wiktionary\.org\/w\/api\.php/, route => {
    if (/srsearch=Zoe&/.test(route.request().url())) {
      route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ query: { search: [{ title: 'zoé' }] } }) });
    } else {
      route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
    }
  });
}

test('a respelling that would strip a capital is suppressed', async ({ page }) => {
  await gotoApp(page);
  await stubZoe(page);
  await page.evaluate(w => window.__grawlixTest.addCustomWordlist(w),
    { name: 'Src', entries: ['Zoe'], scores: [50] });
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());

  await openPanelFor(page, 'zoe');
  await expect(link(page)).toHaveCount(0);
  // Past the debounce: the resolver did find "zoé", so the blank is isRicher's
  // suppression, not a not-yet-resolved race.
  await page.waitForTimeout(900);
  await expect(link(page)).toHaveCount(0);
});

// Only the singular "dna sequencer" resolves (a Wikipedia entity); the negative
// lookahead makes the plural query miss, so the plural must recover its casing by
// resolving the singular and re-adding the "s".
async function stubDnaSequencer(page) {
  await page.route(/action=opensearch/, route => {
    if (/search=dna(?:%20|\+| )sequencer(?!s)/i.test(route.request().url())) {
      route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify(['dna sequencer', ['DNA sequencer'], [''], ['https://en.wikipedia.org/wiki/DNA_sequencer']]) });
    } else {
      route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
    }
  });
  await page.route(/rest_v1\/page\/summary\/DNA(?:%20|_|\+| )sequencer(?!s)/i, route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      title: 'DNA sequencer',
      extract: 'A DNA sequencer is a scientific instrument.',
      extract_html: '<p>A <b>DNA sequencer</b> is a scientific instrument.</p>',
    }) }));
}

test('a plural recovers its singular’s casing and re-adds the "s"', async ({ page }) => {
  await gotoApp(page);
  await stubDnaSequencer(page);
  await page.evaluate(w => window.__grawlixTest.addCustomWordlist(w),
    { name: 'Src', entries: ['dnasequencers', 'dna', 'sequencer', 'sequencers'], scores: [50, 50, 50, 50] });
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await page.evaluate(c => window.__grawlixTest.setWorkerUnigramCorpus(c),
    { dna: -3, sequencer: -4, sequencers: -4 });

  await openPanelFor(page, 'dnasequencers');
  await expect(link(page)).toHaveText('dna sequencers');   // stage 1: plain spacing
  await expect(link(page)).toHaveText('DNA sequencers');   // stage 2: singular's casing + "s"
});

// Wiktionary's search lists the caron "Gdaňsk" before the acute "Gdańsk" and both
// tie on richness; Wikipedia's article is the acute. The resolver must corroborate
// with Wikipedia and pick the acute, not the caron that merely sorted first.
async function stubGdansk(page) {
  await page.route(/en\.wiktionary\.org\/w\/api\.php/, route =>
    /srsearch=Gdansk&/.test(route.request().url())
      ? route.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify({ query: { search: [{ title: 'Gdansk' }, { title: 'Gdaňsk' }, { title: 'Gdańsk' }] } }) })
      : route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }));
  await page.route(/action=opensearch/, route =>
    /search=Gdansk/i.test(route.request().url())
      ? route.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify(['Gdansk', ['Gdańsk'], [''], ['https://en.wikipedia.org/wiki/Gda%C5%84sk']]) })
      : route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }));
  await page.route(/rest_v1\/page\/summary\/Gda/i, route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      title: 'Gdańsk', extract: 'Gdańsk is a city in Poland.',
      extract_html: '<p><b>Gdańsk</b> is a city in Poland.</p>',
    }) }));
}

test('an accented city resolves to the Wikipedia-corroborated diacritic', async ({ page }) => {
  await gotoApp(page);
  await stubGdansk(page);
  await page.evaluate(w => window.__grawlixTest.addCustomWordlist(w),
    { name: 'Src', entries: ['Gdansk'], scores: [50] });
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());

  await openPanelFor(page, 'gdansk');
  await expect(link(page)).toHaveText('Gdańsk');   // acute (both sources), not caron (Wiktionary-only)
});

// The bare concat reaches only Wikipedia — its search fuzz-matches across the missing
// space to the force-capped "General assemblies" while Wiktionary's stricter search
// 404s; only the spaced re-query surfaces Wiktionary's correct lowercase form.
async function stubGeneralAssemblies(page) {
  await page.route(/en\.wiktionary\.org\/w\/api\.php/, route =>
    /srsearch=general(?:%20|\+| )assemblies&/i.test(route.request().url())
      ? route.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify({ query: { search: [{ title: 'general assemblies' }] } }) })
      : route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }));
  await page.route(/action=opensearch/, route =>
    /search=general(?:%20|\+| )?assemblies/i.test(route.request().url())
      ? route.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify(['general assemblies', ['General assemblies'], [''], ['https://en.wikipedia.org/wiki/General_assemblies']]) })
      : route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }));
  await page.route(/rest_v1\/page\/summary\/General(?:%20|_|\+| )assemblies/i, route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      title: 'General assembly',   // redirect target; bold lead won't norm-match the plural
      extract: 'A general assembly is a meeting of all the members.',
      extract_html: '<p>A <b>general assembly</b> is a meeting of all the members.</p>',
    }) }));
}

test('a phrase Wikipedia force-caps but Wiktionary lowercases keeps the lowercase', async ({ page }) => {
  await gotoApp(page);
  await stubGeneralAssemblies(page);
  await page.evaluate(w => window.__grawlixTest.addCustomWordlist(w),
    { name: 'Src', entries: ['generalassemblies', 'general', 'assemblies'], scores: [50, 50, 50] });
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await page.evaluate(c => window.__grawlixTest.setWorkerUnigramCorpus(c),
    { general: -3, assemblies: -4 });

  await openPanelFor(page, 'generalassemblies');
  await expect(link(page)).toHaveText('general assemblies');   // stage 1: plain spacing
  // Past the debounce: the spaced re-query must bring in Wiktionary and keep the
  // lowercase, not flip to Wikipedia's bare-match "General assemblies".
  await page.waitForTimeout(900);
  await expect(link(page)).toHaveText('general assemblies');
});

// Mirror of the case above: "theirs" is a real spaceless word, so the suppressor
// must keep it and retract the "the irs" split. Wikipedia is left to 404, so only
// Wiktionary's spaceless form stands.
async function stubTheirs(page) {
  await page.route(/en\.wiktionary\.org\/w\/api\.php/, route =>
    /srsearch=theirs&/i.test(route.request().url())
      ? route.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify({ query: { search: [{ title: 'theirs' }] } }) })
      : route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }));
}

test('a real spaceless word is kept whole, retracting the segmenter split', async ({ page }) => {
  await gotoApp(page);
  await stubTheirs(page);
  await page.evaluate(w => window.__grawlixTest.addCustomWordlist(w),
    { name: 'Src', entries: ['theirs', 'the', 'irs'], scores: [50, 50, 50] });
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await page.evaluate(c => window.__grawlixTest.setWorkerUnigramCorpus(c),
    { the: -1, irs: -3 });

  await openPanelFor(page, 'theirs');
  await expect(link(page)).toHaveText('the irs');   // stage 1: the segmenter's split
  // Resolved form equals the entry → no rename: the suppressor retracts the split.
  await page.waitForTimeout(900);
  await expect(link(page)).toHaveCount(0);
});

// Wiktionary's full-text search surfaces the accented singular "cliché" for the
// plural query "cliches" but the singular query "cliche" returns nothing — so only
// the short-circuit (reusing the plural's own results) can recover the accent; the
// long path, which looks the singular up on its own, would land on "cliches".
async function stubCliche(page) {
  await page.route(/en\.wiktionary\.org\/w\/api\.php/, route => {
    if (/srsearch=cliches&/.test(route.request().url())) {
      route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ query: { search: [{ title: 'cliché' }] } }) });
    } else {
      route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
    }
  });
}

test('a plural short-circuits to the singular already in its own results', async ({ page }) => {
  await gotoApp(page);
  await stubCliche(page);
  await page.evaluate(w => window.__grawlixTest.addCustomWordlist(w),
    { name: 'Src', entries: ['cliches'], scores: [50] });
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await page.evaluate(c => window.__grawlixTest.setWorkerUnigramCorpus(c), { cliches: -1 });

  await openPanelFor(page, 'cliches');
  await expect(link(page)).toHaveText('clichés');   // accent recovered from the singular, "s" re-added
});

test('a segmented part inherits its casing from the wordlist', async ({ page }) => {
  await gotoApp(page);   // reference lookups are stubbed to 404, so the wordlist casing stands
  await page.evaluate(w => window.__grawlixTest.addCustomWordlist(w),
    { name: 'Src', entries: ['dnasplicer', 'DNA', 'splicer'], scores: [50, 50, 50] });
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await page.evaluate(c => window.__grawlixTest.setWorkerUnigramCorpus(c), { dna: -3, splicer: -4 });

  await openPanelFor(page, 'dnasplicer');
  await expect(link(page)).toHaveText('DNA splicer');   // "dna" cased from the list's DNA entry
});

test('a part the list also spells lowercase is left uncased', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(w => window.__grawlixTest.addCustomWordlist(w),
    { name: 'Src', entries: ['dnasplicer', 'DNA', 'dna', 'splicer'], scores: [50, 50, 50, 50] });
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await page.evaluate(c => window.__grawlixTest.setWorkerUnigramCorpus(c), { dna: -3, splicer: -4 });

  await openPanelFor(page, 'dnasplicer');
  // The list carries a plain "dna" too, so the lowercase reading wins over DNA.
  await expect(link(page)).toHaveText('dna splicer');
});

test('empty inline lookups fall back to the resolved form', async ({ page }) => {
  await seed(page);
  await openPanelFor(page, 'helenoftroy');
  await expect(lookup(page).locator('.lookup-alt-note')).toHaveText('Showing results for “Helen of Troy”');
  await expect(lookup(page).locator('.lookup-prose-title')).toHaveText('Helen of Troy');
  // The Wiktionary link (renamed from Dictionary) points at the resolved page, not
  // the raw concatenation that 404s.
  const wikt = lookup(page).locator('.lookup-link', { hasText: 'Wiktionary' });
  await expect(wikt).toHaveAttribute('href', /\/wiki\/Helen(%20| )of(%20| )Troy$/);
});

// Deliberate stub mismatch: "Age of the Pyramids" is a redirect, so its summary is
// the target article ("Old Kingdom of Egypt") whose bold lead doesn't norm-match.
// The hint keeps the title; the card renders the target from that same fetch.
async function stubAgeOfPyramids(page) {
  await page.route(/action=opensearch/, route => {
    if (/search=ageofthepyramids/i.test(route.request().url())) {
      route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify(['ageofthepyramids', ['Age of the Pyramids'], [''], ['https://en.wikipedia.org/wiki/Age_of_the_Pyramids']]) });
    } else {
      route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
    }
  });
  await page.route(/rest_v1\/page\/summary\/Age(?:%20|_|\+| )of/i, route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      title: 'Old Kingdom of Egypt',
      extract: 'The Old Kingdom is also known as the Age of the Pyramids.',
      extract_html: '<p>The <b>Old Kingdom</b> is also known as the Age of the Pyramids.</p>',
    }) }));
}

test('a redirect target renders in the card while the hint keeps the entry’s title', async ({ page }) => {
  await gotoApp(page);
  await stubAgeOfPyramids(page);
  await page.evaluate(w => window.__grawlixTest.addCustomWordlist(w),
    { name: 'Src', entries: ['ageofthepyramids'], scores: [50] });
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());

  await openPanelFor(page, 'ageofthepyramids');
  await expect(link(page)).toHaveText('Age of the Pyramids');   // bold "Old Kingdom" ≠ norm → title kept
  await expect(lookup(page).locator('.lookup-alt-note')).toHaveText('Showing results for “Age of the Pyramids”');
  await expect(lookup(page).locator('.lookup-prose-title')).toHaveText('Old Kingdom of Egypt');
});

// Wikipedia offers the force-capped title "Ground frost"; Wiktionary — the
// lowercase authority — is made to fail (503, which is a failure, not an empty
// 404). The resolver must degrade to the plain segmenter spacing rather than cache
// Wikipedia's force-capped partial, so the answer doesn't depend on the flaky fetch.
async function stubGroundFrost(page) {
  await page.route(/action=opensearch/, route => {
    if (/search=ground(?:%20|\+| )frost/i.test(route.request().url())) {
      route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify(['ground frost', ['Ground frost'], [''], ['https://en.wikipedia.org/wiki/Ground_frost']]) });
    } else {
      route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
    }
  });
  await page.route(/rest_v1\/page\/summary\/Ground(?:%20|_|\+| )frost/i, route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      title: 'Ground frost', extract: 'Ground frost refers to ice.',
      extract_html: '<p><b>Ground frost</b> refers to ice.</p>',
    }) }));
  await page.route(/en\.wiktionary\.org\/w\/api\.php/, route =>
    route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
}

test('a failed reference fetch degrades to the local spacing, not a force-capped partial', async ({ page }) => {
  await gotoApp(page);
  await stubGroundFrost(page);
  await page.evaluate(w => window.__grawlixTest.addCustomWordlist(w),
    { name: 'Src', entries: ['groundfrost', 'ground', 'frost'], scores: [50, 50, 50] });
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await page.evaluate(c => window.__grawlixTest.setWorkerUnigramCorpus(c), { ground: -3, frost: -4 });

  await openPanelFor(page, 'groundfrost');
  await expect(link(page)).toHaveText('ground frost');   // not Wikipedia's "Ground frost"
});

test('the inline Wiktionary card renders structured definitions', async ({ page }) => {
  await gotoApp(page);
  await page.route(/rest_v1\/page\/definition\/cat$/i, route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      en: [{ partOfSpeech: 'Noun', language: 'English',
        definitions: [{ definition: 'A <a href="/wiki/feline">feline</a> animal &amp; pet.' }] }],
    }) }));
  await page.evaluate(w => window.__grawlixTest.addCustomWordlist(w), { name: 'Src', entries: ['cat'], scores: [50] });
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());

  await openPanelFor(page, 'cat');
  const wikt = lookup(page).locator('.lookup-sec', { hasText: 'Wiktionary' });
  await expect(wikt.locator('.lookup-pos')).toHaveText('Noun');
  await expect(wikt.locator('.lookup-def li')).toHaveText('A feline animal & pet.');   // tags stripped, entity decoded
});
