import { test } from 'node:test';
import { visible, sameVisible } from './harness.mjs';

test('keeps entries that appear as a subsequence of the input', async () => {
  sameVisible(await visible(['joey', 'joke', 'key', 'major', 'zebra'],
    [{ tool: 'joeys', params: { entry: 'MAJORKEY' } }]),
    ['joey', 'joke', 'key', 'major']);
});

test('subsequence order matters — same letters in a different order are not a joey', async () => {
  sameVisible(await visible(['ace', 'eca'],
    [{ tool: 'joeys', params: { entry: 'ABCDEF' } }]),
    ['ace']);
});

test('the input itself is excluded — a joey must be shorter than its kangaroo', async () => {
  sameVisible(await visible(['majorkey', 'major'],
    [{ tool: 'joeys', params: { entry: 'MAJORKEY' } }]),
    ['major']);
});

test('an empty param is inert — the full merged view passes through', async () => {
  sameVisible(await visible(['cat', 'dog'],
    [{ tool: 'joeys', params: { entry: '' } }]),
    ['cat', 'dog']);
});

test('the param is matched case-insensitively', async () => {
  sameVisible(await visible(['joey'],
    [{ tool: 'joeys', params: { entry: 'mAjOrKeY' } }]),
    ['joey']);
});
