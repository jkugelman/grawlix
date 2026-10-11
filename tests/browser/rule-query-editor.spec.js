// The rescore rule editor's query fields: suggestions from the first click,
// highlighting and error messages, and each rule's live match counts from the
// worker.

import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp, scopeViaSelector, openRescoreEditor } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

const editor  = page => page.locator('#manage-dialog .manage-rules');
const rows    = page => editor(page).locator('#rescore-rules .rule-row');
const suggest = page => page.locator('#rule-suggest');
const option  = (page, label) => suggest(page).locator('.score-picker-opt', { has: page.locator('.rule-suggest-label', { hasText: new RegExp(`^${label}$`) }) });

async function seed(page, { name = 'Src', entries, scores, rules = [] }) {
  await page.evaluate(args => window.__grawlixTest.addCustomWordlist(args), { name, entries, scores });
  // Always set, even to [], or a short list's auto-seeded rules shadow the test's.
  await page.evaluate(([n, r]) => window.__grawlixTest.setRescoreRules(n, r), [name, rules]);
  await scopeViaSelector(page, name);
  await openRescoreEditor(page);
}

test('the condition box suggests fields, then values, and builds a rule', async ({ page }) => {
  await gotoApp(page);
  await seed(page, { entries: ['ocean', 'tide'], scores: [50, 40] });
  await editor(page).locator('.rule-add-btn').click();
  const query = rows(page).first().locator('.rule-query');
  await expect(query).toBeFocused();
  await expect(option(page, 'score')).toBeVisible();

  await page.keyboard.press('Enter');
  await expect(query).toHaveValue('score: ');
  await expect(suggest(page)).toContainText('Values for score');

  await page.keyboard.type('50');
  await page.keyboard.press('Enter');
  await expect(query).toHaveValue('score: 50 ');
  await expect(rows(page).first().locator('.rule-count')).toHaveText('1 entry');
  await expect(suggest(page).locator('.rule-suggest-foot')).toHaveText('ocean');
});

test('each rule shows its live count, and its matches while it is edited', async ({ page }) => {
  await gotoApp(page);
  await seed(page, { entries: ['ocean', 'tide'], scores: [50, 40], rules: [
    { query: 'score: 50', output: '60', note: '' },
  ] });
  const row = rows(page).first();
  await expect(row.locator('.rule-count')).toHaveText('1 entry');
  await expect(editor(page).locator('.rules-rest')).toHaveText('1 of 2 entries match no rule and keep their score.');

  await row.locator('.rule-query').click();
  await expect(suggest(page).locator('.rule-suggest-foot')).toHaveText('ocean');

  await row.locator('.rule-query').fill('score: 40+');
  await expect(row.locator('.rule-count')).toHaveText('2 entries');
});

test('an entry counts toward the first rule that matches it', async ({ page }) => {
  await gotoApp(page);
  await seed(page, { entries: ['ocean', 'tide'], scores: [50, 40], rules: [
    { query: 'score: 40+', output: '30', note: '' },
    { query: 'score: 50', output: '60', note: '' },
  ] });
  await expect(rows(page).first().locator('.rule-count')).toHaveText('2 entries');
  await expect(rows(page).nth(1).locator('.rule-meta')).toHaveText('No entries match.');
});

test('a broken condition says what is wrong and does nothing', async ({ page }) => {
  await gotoApp(page);
  await seed(page, { entries: ['ocean'], scores: [50], rules: [
    { query: 'score: 50', output: '60', note: '' },
  ] });
  const row = rows(page).first();
  await row.locator('.rule-query').fill('scor: 50');
  await row.locator('.rule-query').blur();
  await expect(row.locator('.rule-status')).toHaveText('There’s no “scor” field. Did you mean “score”?'.replace('’', "'"));
  await expect(row.locator('.rule-query-hl .q-err')).toHaveText('scor');
  await expect(row.locator('.rule-meta')).toContainText('does nothing');
});

test('value suggestions show how many entries each one matches', async ({ page }) => {
  await gotoApp(page);
  await seed(page, { entries: ['Pius VII', 'ocean', 'NASA', 'Bay of Pigs'], scores: [50, 50, 50, 50] });
  await editor(page).locator('.rule-add-btn').click();
  await page.keyboard.type('is: ');
  await expect(option(page, 'proper').locator('.score-picker-hint')).toHaveText('2');
  await expect(option(page, 'initialism').locator('.score-picker-hint')).toHaveText('1');
  await expect(option(page, 'plain').locator('.score-picker-hint')).toHaveText('1');
});

test('Escape closes the suggestions, not the dialog', async ({ page }) => {
  await gotoApp(page);
  await seed(page, { entries: ['ocean'], scores: [50] });
  await editor(page).locator('.rule-add-btn').click();
  await expect(suggest(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(suggest(page)).toBeHidden();
  await expect(page.locator('#manage-dialog')).toBeVisible();
});

test('a valid rule is rewritten cleanly once a field loses focus; a broken one is not', async ({ page }) => {
  await gotoApp(page);
  await seed(page, { entries: ['ocean'], scores: [50], rules: [
    { query: 'score: 50', output: '60', note: '' },
  ] });
  const row = rows(page).first();
  const query = row.locator('.rule-query');
  await query.fill('Score:50 AND');
  await query.blur();
  await expect(query).toHaveValue('Score:50 AND');

  await query.fill('Score:050   not IS: proper');
  await query.blur();
  await expect(query).toHaveValue('score: 50 and is not: proper');
  await expect(row.locator('.rule-count')).toHaveText('1 entry');

  const out = row.locator('.rule-out');
  await out.fill(' 065 ');
  await out.blur();
  await expect(out).toHaveValue('65');
  await page.locator('#manage-dialog .manage-apply-btn').click();
  await expect.poll(() => page.evaluate(() => window.__grawlixTest.getWordlist('Src').rescoreRules[0])).toEqual({ query: 'score: 50 and is not: proper', output: '65' });
});

test('the output box offers the tiers', async ({ page }) => {
  await gotoApp(page);
  await seed(page, { entries: ['ocean'], scores: [50], rules: [
    { query: 'score: 50', output: '', note: '' },
  ] });
  const out = rows(page).first().locator('.rule-out');
  await out.click();
  await expect(option(page, 'unchanged')).toBeVisible();
  await suggest(page).locator('.score-picker-opt', { has: page.locator('.score-picker-label', { hasText: /^Good / }) }).click();
  await expect(out).toHaveValue('60');
  await expect(rows(page).first().locator('.rule-count')).toHaveText('1 entry');
});

test('focusing a valid condition leaves the rule its height; its status rides the list', async ({ page }) => {
  await gotoApp(page);
  await seed(page, { entries: ['ocean'], scores: [50], rules: [
    { query: 'score: 50', output: '60', note: '' },
  ] });
  const row = rows(page).first();
  await expect(row.locator('.rule-count')).toHaveText('1 entry');
  const before = (await row.boundingBox()).height;
  await row.locator('.rule-query').click();
  await expect(suggest(page).locator('.rule-suggest-status')).toContainText('The score this wordlist gives the entry.');
  expect((await row.boundingBox()).height).toBe(before);
});

test('on a bare list, a rule that needs capitals explains why it matches nothing', async ({ page }) => {
  await gotoApp(page);
  await seed(page, { name: 'Bare', entries: ['ocean', 'nasa'], scores: [50, 50], rules: [
    { query: 'is: initialism', output: '30', note: '' },
  ] });
  await expect(rows(page).first().locator('.rule-meta')).toContainText('Bare has no capitalization or spaces');
});
