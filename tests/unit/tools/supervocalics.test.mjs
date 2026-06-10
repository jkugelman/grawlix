import { test } from 'node:test';
import { visible, sameVisible } from './harness.mjs';

test('keeps entries where each of A E I O U appears exactly once', async () => {
  sameVisible(await visible(['sequoia', 'education', 'hello', 'banana'],
    [{ tool: 'supervocalics' }]),
    ['education', 'sequoia']);
});

test('a doubled vowel disqualifies an entry — each vowel must appear exactly once', async () => {
  sameVisible(await visible(['aeronautic'], [{ tool: 'supervocalics' }]), []);
});

test('Y is not counted as a vowel', async () => {
  sameVisible(await visible(['layout'], [{ tool: 'supervocalics' }]), []);
});
