'use strict';

import { esc } from '../../core/util.js';
import { getPublisher } from '../../data/publishers.js';
import { createDialog, showDialog } from './dialog.js';

let _ingestFile = () => {};
export function configureImportGuide({ ingestFile }) {
  if (ingestFile) _ingestFile = ingestFile;
}

export function bindDropZone(zone, fileInput, onFile) {
  zone.onclick     = () => fileInput.click();
  zone.ondragover  = e => { e.preventDefault(); zone.classList.add('drag-over'); };
  zone.ondragleave = () => zone.classList.remove('drag-over');
  zone.ondrop      = e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) onFile(file);
  };
  fileInput.onchange = () => { if (fileInput.files[0]) onFile(fileInput.files[0]); };
}

export const ImportGuideDialog = (() => {
  let el, body;

  let _wordlist = null;
  let _pendingFile = null;

  function mount() {
    ({ el, body } = createDialog('import-guide-dialog', { labelledby: 'guide-title' }));
  }

  function open(wordlist) {
    _wordlist = wordlist;
    _pendingFile = null;
    body.innerHTML = buildContentHTML(wordlist);

    const zoneLabel = el.querySelector('.guide-zone-label');
    const importBtn = el.querySelector('.guide-import-btn');
    importBtn.disabled = true;

    importBtn.onclick = () => {
      if (!_pendingFile) return;
      el.close();
      _ingestFile(_pendingFile, _wordlist);
    };

    bindDropZone(el.querySelector('.guide-drop-zone'), el.querySelector('.guide-file-input'), file => {
      _pendingFile = file;
      zoneLabel.textContent = file.name;
      importBtn.disabled = false;
    });

    showDialog(el);
  }

  function buildContentHTML(wordlist) {
    const publisher = getPublisher(wordlist);
    const dropZone = `
      <div class="import-zone compact guide-drop-zone">
        <span class="guide-zone-label">Drop file here or click to browse</span>
        <input type="file" class="guide-file-input" accept=".txt,.dict">
      </div>`;
    const footer = `
      <div class="dialog-footer">
        <button class="dialog-cancel-btn">Cancel</button>
        <button class="primary guide-import-btn">Import</button>
      </div>`;

    if (!publisher?.sourcePage) {
      return `
        <button class="dialog-close-btn" aria-label="Close">✕</button>
        <h2 id="guide-title">Import ${esc(wordlist.name)}</h2>
        <p class="guide-intro">Import a wordlist file from your computer. Grawlix will load its words and scores into this wordlist.</p>
        ${dropZone}
        ${footer}`;
    }

    const subNote = publisher.subscriptionNote
      ? `<div class="subscription-note"><strong>Note:</strong> ${esc(publisher.subscriptionNote)}</div>`
      : '';
    // sourceNote is trusted HTML hardcoded in WORDLIST_PUBLISHERS, never user input.
    return `
      <button class="dialog-close-btn" aria-label="Close">✕</button>
      <h2 id="guide-title">Import ${esc(publisher.name)}</h2>
      <p class="guide-intro">This wordlist isn't auto-fetched — you'll need to download it yourself, then drop the file back here.</p>
      ${subNote}
      <ol class="guide-steps">
        <li class="guide-step"><div class="guide-step-body">
          Open the wordlist page: <a href="${esc(publisher.sourcePage)}" target="_blank" rel="noopener">${esc(publisher.sourcePage)} 🔗</a>
        </div></li>
        <li class="guide-step"><div class="guide-step-body">${publisher.sourceNote || 'Download the wordlist file.'}</div></li>
        <li class="guide-step"><div class="guide-step-body">
          Drop the downloaded file below, or click to browse:
          ${dropZone}
        </div></li>
      </ol>
      ${footer}`;
  }

  return { mount, open };
})();
