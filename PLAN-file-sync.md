# File Sync Feature — Implementation Plan

## Context

Wordlist Manager is a single-file HTML app (`wordlist-manager.html`) with no build step.
It stores list metadata in `localStorage` (key prefix `wlm2_`) and wordlist text in IndexedDB
(`wlm2` DB, `data` store). Lists have a `source` field: `"upload" | "url" | "builtin-download"`.

The goal is to add a fourth source type, `"file"`, backed by the **File System Access API**
(Chrome/Edge only). A linked list maintains a live `FileSystemFileHandle`; the browser polls
for external changes and can write edits back to disk. In unsupported browsers (Firefox, Safari),
the UI falls back silently to the existing upload/download flow — same UI, fewer capabilities.

---

## UX Design (already decided — implement as described)

### Unified UI principle
The same UI serves both modes. FSAPI support is detected at runtime (`'showOpenFilePicker' in window`).
Where it's available, the "Upload File" tab becomes "Link File" with a description of live sync.
Where it's not, the same tab says "Upload File" and reads the file once as a snapshot.
The list card and detail panel adapt based on the list's actual `source` field, not the browser.

### List card — sync indicator (rightmost metadata, before the toggle)
| State | Display |
|-------|---------|
| Linked, syncing | `⟳ live` in muted green |
| Linked, needs reconnect | `⚡ reconnect` in amber — **clickable** |
| Linked, FSAPI unavailable (shouldn't occur — if file is linked, FSAPI was available when it was linked) | omit |
| Upload / URL (no handle) | nothing |

Clicking `⚡ reconnect` calls `handle.requestPermission()` and starts polling on success.
This is the **only** reconnect affordance — no banners, no modals.

### On page load
For each list with a stored handle:
1. Call `handle.queryPermission({mode: 'readwrite'})` synchronously.
2. If `"granted"`: start polling silently, re-render lists and detail.
3. If `"prompt"` or `"denied"`: mark list as `_syncPaused: true` → card shows `⚡ reconnect`.

No banners. No toasts. The indicator on the card is sufficient — users naturally click
the list they want to work with, and that's where reconnect lives.

### Detail panel header
```
[List Name]  [source description]  [action button]  [secondary button]
```

| Source | Description | Primary action | Secondary |
|--------|-------------|----------------|-----------|
| `"file"` syncing | `filename.txt · synced 3s ago` | — | `Unlink` · `Clear data` |
| `"file"` paused | `filename.txt · ⚡ Reconnect to sync` | `Reconnect` | `Unlink` · `Clear data` |
| `"upload"` | `Manual upload` | `↑ Update` | `Clear data` |
| `"builtin-download"` | URL | `↻ Update` | — |
| `"url"` | URL | `↻ Update` | — |

### Add List dialog — "File" tab
Tab label: **"Link File"** (Chrome/Edge) or **"Upload File"** (fallback).

Chrome/Edge content:
```
Link a file from your computer.
Changes you make here save automatically, and changes made
by other apps (like Ingrid) appear here within seconds.

  [Choose file…]   ← calls showOpenFilePicker(), links permanently

  — or upload a snapshot —

  [Drop file here or click to browse]   ← fallback one-shot upload
```

The drop zone fallback is important: some paths that appear in the OS file picker
(e.g. `\\wsl$\...` network paths) cannot be opened by FSAPI even in Chrome. The drop
zone lets the user upload a copy in that case without leaving the dialog.

Fallback content (Firefox/Safari):
```
Upload a copy of your wordlist.
To update it later, use the Update button.

  [Drop file here or click to browse]
```

The tab is always present. Only the content changes based on `'showOpenFilePicker' in window`.

### Link file for existing (known) lists
The "Link file" affordance also appears inside the upload guide dialogs (not in the detail
panel header). This keeps the detail header clean and puts the option where users are
already looking when they want to load a file.

- **Upload guide dialog** (XWI, Broda, STWL) — step 3 shows:
  ```
  Come back here to load the file:
  [Link file…]          ← FSAPI only
  — or upload a snapshot —
  [Drop file here or click to browse]
  ```
- **Auto-download dialog** (jkugelman) — shows:
  ```
  [Auto-download]
  — or link a local file —
  [Link file…]          ← FSAPI only
  — or upload a snapshot —
  [Drop file here or click to browse]
  ```

Clicking "Link file…" in either dialog closes the dialog, then calls `linkExistingList(id)`
which replaces the existing list's data and handle in-place (no new list created).

---

## Data Model Changes

Add to each list object:

```js
{
  // existing fields ...
  source: "upload" | "url" | "builtin-download" | "file",  // new value "file"

  // new fields (only populated when source === "file"):
  fileHandle: FileSystemFileHandle | null,
  fileLastModified: number | null,   // timestamp of last-read version
  fileName: string | null,           // handle.name, stored for display before permission granted
  _syncPaused: boolean,              // true = has handle but needs permission
  _pollTimer: number | null,         // setInterval id, not persisted
}
```

**Persistence:**
- `fileHandle` → stored in IDB under key `"handle_" + id` (handles are IDB-serializable)
- `fileName`, `fileLastModified` → stored in `localStorage` meta (already serialized by `persistMeta`)
- `_syncPaused`, `_pollTimer` → runtime only, never persisted

**`persistMeta` additions** (in the `lsSave('meta', ...)` call):
```js
{ ...existing fields..., fileName: l.fileName || null, fileLastModified: l.fileLastModified || null }
```

---

## Implementation Steps

### Step 1 — IDB handle storage

Add three functions alongside the existing `idbPut`/`idbGet`/`idbDel`:

```js
async function idbPutHandle(id, handle) { await idbPut('handle_' + id, handle); }
async function idbGetHandle(id)         { return await idbGet('handle_' + id); }
async function idbDelHandle(id)         { await idbDel('handle_' + id); }
```

### Step 2 — Restore handles on init

In `init()`, after building `state.lists` from meta, add for each list:

```js
if (m.source === 'file') {
  list.fileHandle = await idbGetHandle(m.id);
  list.fileName   = m.fileName || null;
  list.fileLastModified = m.fileLastModified || null;
  list._syncPaused = true;    // assume paused; step 3 will clear it
  list._pollTimer  = null;
}
```

### Step 3 — Permission check on init

After all lists are loaded, for each `source === "file"` list with a handle:

```js
async function checkAndStartSync(list) {
  if (!list.fileHandle) return;
  const perm = await list.fileHandle.queryPermission({ mode: 'readwrite' });
  if (perm === 'granted') {
    list._syncPaused = false;
    startPolling(list);
    renderLists();
    if (state.selectedId === list.id) renderDetail(list);
  }
  // else: leave _syncPaused = true, card shows ⚡
}
```

Call this for each file-source list after `renderAll()` in `init()` (before `bindEvents()`):
```js
renderAll();
state.lists.filter(l => l.source === 'file').forEach(l => checkAndStartSync(l));
bindEvents();
```

### Step 4 — Polling

```js
const POLL_INTERVAL_MS = 5000;

function startPolling(list) {
  if (list._pollTimer) return;
  list._pollTimer = setInterval(() => pollFile(list), POLL_INTERVAL_MS);
}

function stopPolling(list) {
  if (!list) return;
  if (list._pollTimer) { clearInterval(list._pollTimer); list._pollTimer = null; }
}

async function pollFile(list) {
  if (!list.fileHandle || list._syncPaused) return;
  try {
    const file = await list.fileHandle.getFile();
    if (file.lastModified === list.fileLastModified) return;  // no change
    const text = await file.text();
    list.rawEntries = parseWordlist(text);
    list.fileLastModified = file.lastModified;
    list.cachedAt = Date.now();
    updateCatchAll(list);
    await persistData(list.id, text);
    persistMeta();
    renderLists();
    if (state.selectedId === list.id) renderDetail(list);
    showToast(`Reloaded from disk — ${list.rawEntries.length.toLocaleString()} entries`);
  } catch {
    // Permission revoked mid-session or file deleted
    stopPolling(list);
    list._syncPaused = true;
    renderLists();
  }
}
```

### Step 5 — Reconnect action

```js
async function reconnectSync(id) {
  const list = state.lists.find(l => l.id === id);
  if (!list?.fileHandle) return;
  const perm = await list.fileHandle.requestPermission({ mode: 'readwrite' });
  if (perm === 'granted') {
    list._syncPaused = false;
    startPolling(list);
    renderLists();
    if (state.selectedId === id) renderDetail(list);
    showToast('File sync resumed');
  }
}
```

Wire up the `⚡ reconnect` click in `renderLists()` and the "Reconnect" button in `renderDetail()`.

### Step 6 — "Link File" flow in Add Dialog

Detect FSAPI support:
```js
const FSAPI_SUPPORTED = 'showOpenFilePicker' in window;
```

Give the upload tab button an id so its label can be updated at runtime:
```html
<button class="tab-btn" data-tab="upload" id="tab-btn-upload">Upload File</button>
```

In `bindEvents()`, update the tab label and content:

```js
if (FSAPI_SUPPORTED) {
  document.getElementById('tab-btn-upload').textContent = 'Link File';
  document.getElementById('tab-upload').innerHTML = `
    <p style="color:var(--muted);font-size:12px;margin-bottom:12px;line-height:1.5">
      Link a file from your computer. Changes you make here save automatically,
      and changes made by other apps (like Ingrid) appear here within seconds.
    </p>
    <button class="primary" onclick="linkFile()">Choose file…</button>
    <div class="dialog-divider">— or upload a snapshot —</div>
    <div class="upload-zone" id="drop-zone">
      Drop file here or click to browse
      <input type="file" id="file-input" accept=".txt,.csv">
    </div>
    <div class="form-field form-field-gap">
      <label>Name (optional)</label>
      <input type="text" id="upload-name" placeholder="My Wordlist">
    </div>`;
}
```

The drop zone binding always runs after this block (present in both FSAPI and non-FSAPI HTML),
guarded with `if (zone && finput)`.

### Step 7 — Linking a new file (Add Dialog)

```js
async function linkFile() {
  if (!FSAPI_SUPPORTED) return;
  let handle;
  try {
    [handle] = await window.showOpenFilePicker({
      types: [{ description: 'Wordlist', accept: { 'text/plain': ['.txt', '.csv'] } }],
      multiple: false,
    });
  } catch { return; }  // user cancelled

  // Request write permission immediately (while we have a user gesture)
  const perm = await handle.requestPermission({ mode: 'readwrite' });

  const file = await handle.getFile();
  const text = await file.text();
  const nameInput = document.getElementById('upload-name');
  const name = (nameInput ? nameInput.value.trim() : '') || handle.name.replace(/\.[^.]+$/, '');
  const id = 'file_' + Date.now();

  const list = {
    id, name, source: 'file', url: null, enabled: true,
    rawEntries: parseWordlist(text),
    cachedAt: Date.now(),
    rescoreRules: [],
    fileHandle: handle,
    fileName: handle.name,
    fileLastModified: file.lastModified,
    _syncPaused: perm !== 'granted',
    _pollTimer: null,
  };
  updateCatchAll(list);

  await idbPutHandle(id, handle);
  await persistData(id, text);
  state.lists.push(list);
  persistMeta();

  if (perm === 'granted') startPolling(list);

  document.getElementById('add-dialog').close();
  state.selectedId = id;
  lsSave('selectedId', id);
  renderAll();
  showToast(`Linked ${handle.name} — ${list.rawEntries.length.toLocaleString()} entries`);
}
```

### Step 8 — Linking an existing list (Upload Guide dialogs)

`linkExistingList(id)` replaces an existing list's data and handle in-place. Used from the
upload guide and auto-download dialogs; the caller closes the dialog first.

```js
async function linkExistingList(id) {
  if (!FSAPI_SUPPORTED) return;
  const list = state.lists.find(l => l.id === id);
  if (!list) return;

  let handle;
  try {
    [handle] = await window.showOpenFilePicker({
      types: [{ description: 'Wordlist', accept: { 'text/plain': ['.txt', '.csv'] } }],
      multiple: false,
    });
  } catch { return; }

  const perm = await handle.requestPermission({ mode: 'readwrite' });
  const file = await handle.getFile();
  const text = await file.text();

  stopPolling(list);
  if (list.fileHandle) await idbDelHandle(list.id);

  list.source = 'file';
  list.fileHandle = handle;
  list.fileName = handle.name;
  list.fileLastModified = file.lastModified;
  list._syncPaused = perm !== 'granted';
  list._pollTimer = null;
  list.rawEntries = parseWordlist(text);
  list.cachedAt = Date.now();
  list.enabled = true;
  updateCatchAll(list);

  await idbPutHandle(list.id, handle);
  await persistData(list.id, text);
  persistMeta();

  if (perm === 'granted') startPolling(list);

  renderAll();
  showToast(`Linked ${handle.name} — ${list.rawEntries.length.toLocaleString()} entries`);
}
```

**Wire it into the upload guide dialogs** — after building the dialog HTML, bind the button:

```js
// In both openUploadGuide() and openAutoDownloadDialog():
const linkBtn = document.getElementById('guide-link-file-btn');
if (linkBtn) linkBtn.onclick = () => { dialog.close(); linkExistingList(listId); };
```

**Upload guide dialog** — add to step 3 of `buildGuideHTML()`:
```js
`Come back here to load the file:
${FSAPI_SUPPORTED ? `<div style="margin-top:8px">
  <button class="primary" id="guide-link-file-btn">Link file…</button>
</div>
<div class="dialog-divider">— or upload a snapshot —</div>` : ''}
<div class="upload-zone compact" id="guide-drop-zone">...</div>`
```

**Auto-download dialog** — add between auto-download and drop zone:
```js
`${FSAPI_SUPPORTED ? `<div class="dialog-divider">— or link a local file —</div>
<div style="margin-bottom:4px">
  <button class="primary" id="guide-link-file-btn">Link file…</button>
</div>` : ''}
<div class="dialog-divider">— or upload a snapshot —</div>
<div class="upload-zone compact" id="guide-drop-zone">...</div>`
```

### Step 9 — "Unlink" action

```js
async function unlinkFile(id) {
  const list = state.lists.find(l => l.id === id);
  if (!list || list.source !== 'file') return;
  if (!confirm(`Unlink "${list.fileName}"? The list data stays in the browser; it just won't sync automatically.`)) return;
  stopPolling(list);
  // Restore original source for builtin lists (e.g. builtin-download), not just 'upload'
  const tmpl = getTemplate(list.id);
  list.source = tmpl ? tmpl.source : 'upload';
  list.fileHandle = null;
  list.fileName = null;
  list.fileLastModified = null;
  list._syncPaused = false;
  await idbDelHandle(id);
  persistMeta();
  renderLists();
  if (state.selectedId === id) renderDetail(list);
}
```

### Step 10 — renderLists and renderDetail updates

**renderLists — sync indicator in `.card-meta`:**

```js
let syncBadge = '';
if (list.source === 'file') {
  if (list._syncPaused) {
    syncBadge = `<span class="sync-badge paused" onclick="reconnectSync('${list.id}');event.stopPropagation()" title="Click to reconnect file sync">⚡ reconnect</span>`;
  } else {
    syncBadge = `<span class="sync-badge live" title="Syncing with ${esc(list.fileName || '')}">⟳ live</span>`;
  }
}
// Add syncBadge into the .card-meta span after the entry count
```

**renderDetail — source description and action buttons:**

```js
if (list.source === 'file') {
  if (list._syncPaused) {
    sourceDesc = `${list.fileName || 'File'} · ⚡ Reconnect to sync`;
    actionBtn = `<button class="primary" onclick="reconnectSync('${list.id}')">Reconnect</button>`;
  } else {
    const age = list.cachedAt ? timeSince(list.cachedAt) : 'never';
    sourceDesc = `${list.fileName || 'File'} · synced ${age}`;
    actionBtn = '';  // no manual action needed while syncing
  }
  // clearBtn is computed before this block; Unlink goes first
  clearBtn = `<button onclick="unlinkFile('${list.id}')">Unlink</button>` + (hasData ? clearBtn : '');
}
```

Note: `clearBtn` must be declared with `let` (not `const`) to allow reassignment here.

Add a small `timeSince(ts)` helper:
```js
function timeSince(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5)  return 'just now';
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s/60)}m ago`;
}
```

### Step 11 — CSS additions

```css
.sync-badge { font-size: 10px; font-weight: 700; padding: 1px 5px; border-radius: 3px; }
.sync-badge.live   { color: #34a853; background: rgba(52,168,83,0.1); }
.sync-badge.paused { color: #f9ab00; background: rgba(249,171,0,0.1); cursor: pointer; }
.sync-badge.paused:hover { background: rgba(249,171,0,0.2); }
```

---

## Cleanup / delete on removeList

In `deleteList()`, add before filtering the list out:
```js
stopPolling(list);
await idbDelHandle(id);
```

---

## Graceful degradation summary

| Browser | FSAPI | Tab label | Tab content | List behavior |
|---------|-------|-----------|-------------|---------------|
| Chrome/Edge | ✓ | "Link File" | showOpenFilePicker + drop zone fallback | Polls, syncs |
| Firefox/Safari | ✗ | "Upload File" | FileReader one-shot | Stored in IDB, manual update |
| Chrome/Edge, FSAPI path blocked (e.g. WSL) | ✓ | "Link File" | user uses drop zone fallback | One-shot upload |
| Chrome/Edge, permission denied | ✓ | "Link File" | same | linkFile early-returns on cancel |

No feature flags, no separate code paths for the card/detail rendering —
`list.source` drives behavior uniformly.

---

## Files to modify

**Only `wordlist-manager.html`** — everything is self-contained.

Key areas:
- Constants section: add `FSAPI_SUPPORTED`, `POLL_INTERVAL_MS`
- CSS: `.sync-badge` styles
- Add dialog HTML: add `id="tab-btn-upload"` to the upload tab button
- `persistMeta()`: include `fileName`, `fileLastModified`
- `init()`: restore handles + call `checkAndStartSync()` between `renderAll()` and `bindEvents()`
- `renderLists()`: sync badge in card meta
- `renderDetail()`: `source === "file"` branch; change `clearBtn` from `const` to `let`
- `deleteList()`: call `stopPolling` and `idbDelHandle` before removing list
- `buildGuideHTML()`: add "Link file…" button in step 3 when FSAPI supported
- `openUploadGuide()`: wire `guide-link-file-btn`
- `openAutoDownloadDialog()`: add "Link file…" option + wire button
- `bindEvents()`: update tab label/content for FSAPI; drop zone binding always runs (guarded with `if (zone && finput)`)
- New functions: `linkFile`, `linkExistingList`, `unlinkFile`, `reconnectSync`, `startPolling`, `stopPolling`, `pollFile`, `checkAndStartSync`, `timeSince`, `idbPutHandle`, `idbGetHandle`, `idbDelHandle`

Estimated scope: ~200 lines of new code, ~40 lines modified.
