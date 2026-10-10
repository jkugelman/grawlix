'use strict';

import { newDbKey } from '../../data/state.js';
import { WordlistForm } from '../wordlist-form.js';
import { createDialog, showDialog } from './dialog.js';

let _addNewWordlist = () => {};
let _fetchWordlist = () => {};
let _ingestFile = () => {};
export function configureAddWordlist({ addNewWordlist, fetchWordlist, ingestFile }) {
  if (addNewWordlist) _addNewWordlist = addNewWordlist;
  if (fetchWordlist)  _fetchWordlist = fetchWordlist;
  if (ingestFile)     _ingestFile = ingestFile;
}

export const AddWordlistDialog = (() => {
  let el, form, onAdded = null;

  function isDirty() {
    const v = form.values();
    return !!(v.name || v.url || v.file || v.icon || v.publisherId);
  }

  function add() {
    if (!form.validate()) return;
    const { name, icon, url, publisherId, file } = form.values();
    const wordlist = _addNewWordlist({
      dbKey: newDbKey(), icon, name,
      url, enabled: false, populated: false,
      ...(publisherId ? { publisherId } : {}),
      rescoreRules: form.rulesToApply() || [],
    });
    onAdded?.(wordlist);
    el.close();
    if (url) _fetchWordlist(wordlist);
    else if (file) _ingestFile(file, wordlist, name);
  }

  function open(callback = null) {
    onAdded = callback;
    form.load();
    showDialog(el);
  }

  function mount() {
    let body;
    ({ el, body } = createDialog('add-wordlist-dialog', { labelledby: 'add-wordlist-title', isDirty }));
    form = new WordlistForm({ mode: 'add', preview: true });
    body.innerHTML = `
      <button type="button" class="dialog-close-btn" aria-label="Close">✕</button>
      <h2 id="add-wordlist-title">Add Wordlist</h2>
      <div class="dialog-footer">
        <button type="button" class="dialog-cancel-btn">Cancel</button>
        <button type="button" class="primary add-wordlist-btn">Add</button>
      </div>`;
    body.querySelector('h2').after(form.el);
    body.querySelector('.add-wordlist-btn').addEventListener('click', add);

    // Capture: bubbling would reach createDialog's guard first, so Escape on an
    // open picker would ask "Discard changes?" instead of closing the picker.
    el.addEventListener('cancel', e => {
      if (form.consumeEscape()) { e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);
    el.addEventListener('close', () => form.destroy());
  }

  return { mount, open };
})();
