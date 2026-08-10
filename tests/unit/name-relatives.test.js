import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nameParts, nameAnchorRun, NAME_RELATIVE_CAP } from '../../site/src/engine/morphology.js';

const anchor = (a, b) => nameAnchorRun(nameParts(a), nameParts(b));

test('links a name to the full name containing it, in both directions', () => {
  assert.deepStrictEqual(anchor('Menchu', 'Rigoberta Menchu'), ['menchu']);
  assert.deepStrictEqual(anchor('Rigoberta Menchu', 'Menchu'), ['menchu']);
});

test('the anchor is the shorter side, so both directions agree on one key', () => {
  assert.deepStrictEqual(anchor('Vesuvius', 'Mount Vesuvius'), anchor('Mount Vesuvius', 'Vesuvius'));
});

test('a three-token name anchors on each of its parts separately', () => {
  for (const [part, token] of [['John', 'john'], ['Paul', 'paul'], ['George', 'george']]) {
    assert.deepStrictEqual(anchor(part, 'John Paul George'), [token]);
  }
});

test('a multi-word first or last name anchors as one unit', () => {
  assert.deepStrictEqual(anchor('García Márquez', 'Gabriel García Márquez'), ['garcia', 'marquez']);
  assert.deepStrictEqual(anchor('Medicine Hat', 'Medicine Hat, Alberta'), ['medicine', 'hat']);
});

test('the run must be capitalized where it sits in the LONGER entry too', () => {
  assert.equal(anchor('Téa', 'iced tea'), null);
  assert.equal(anchor('Job', 'dream job'), null);
  assert.deepStrictEqual(anchor('Job', 'Book of Job'), ['job']);
});

test('an uncapitalized anchor never links, even into a capitalized name', () => {
  assert.equal(anchor('dead', 'Dead Sea'), null);
  assert.deepStrictEqual(anchor('Dead', 'Dead Sea'), ['dead']);
});

test('the run must be contiguous', () => {
  assert.equal(anchor('The The', 'The Best The Worst'), null);
  assert.equal(anchor('Gabriel Márquez', 'Gabriel García Márquez'), null);
});

test('people merely sharing a name are not linked', () => {
  assert.equal(anchor('Venus Williams', 'Serena Williams'), null);
  assert.equal(anchor('John Lennon', 'John Denver'), null);
});

test('an identical token sequence is not a relation', () => {
  assert.equal(anchor('Rigoberta Menchu', 'Rigoberta Menchu'), null);
});

test('single characters never anchor', () => {
  assert.equal(anchor('I', 'I Am Sam'), null);
  assert.equal(anchor('B', 'B Flat'), null);
});

test('roman numerals never anchor', () => {
  assert.equal(anchor('II', 'Pope John Paul II'), null);
  assert.equal(anchor('XIV', 'Louis XIV'), null);
  assert.deepStrictEqual(anchor('Mix', 'Mix Master'), ['mix']);
});

test('pronoun contractions and honorifics never anchor', () => {
  assert.equal(anchor('Mr', 'Mr Spock'), null);
  assert.equal(anchor('TV', 'ABC TV'), null);
  assert.deepStrictEqual(anchor('Spock', 'Mr Spock'), ['spock']);
});

test('word and token stay aligned when a word norms to nothing', () => {
  assert.deepStrictEqual(nameParts('Rock & Roll').map(p => p.token), ['rock', 'roll']);
  assert.deepStrictEqual(anchor('Roll', 'Rock & Roll'), ['roll']);
});

test('numerals neither carry nor block capitalization', () => {
  assert.deepStrictEqual(anchor('Apollo 11', 'Apollo 11 Mission'), ['apollo', '11']);
  assert.equal(anchor('11', 'Apollo 11'), null);
});

test('the cap is a small per-lookup budget', () => {
  assert.ok(NAME_RELATIVE_CAP >= 1 && NAME_RELATIVE_CAP <= 10, 'a per-token budget, not a section total');
});
