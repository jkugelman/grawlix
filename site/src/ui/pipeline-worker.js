// ─── Pipeline worker client ──────────────────────────────────────────────────
// The worker URL anchors on main.js's import.meta.url (injected at boot), not
// this module's. Bundling inlines this file into main.js at src/ while site/
// serves it from src/ui/ — a literal relative to import.meta.url would resolve
// to different places in the two builds. main.js lands at src/main.js in both,
// so anchoring there makes one relative path correct everywhere, deploy base
// included (no leading-slash hardcoding).

let workerBaseURL = null;
let worker = null;

export function configurePipelineWorker({ baseURL }) {
  workerBaseURL = baseURL;
}

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./engine/worker.js', workerBaseURL), { type: 'module' });
  }
  return worker;
}

export function pingWorker(timeout = 2000) {
  const w = getWorker();
  return new Promise(resolve => {
    const timer = setTimeout(() => { w.removeEventListener('message', onMessage); resolve(false); }, timeout);
    function onMessage({ data }) {
      if (data?.type !== 'pong') return;
      clearTimeout(timer);
      w.removeEventListener('message', onMessage);
      resolve('pong');
    }
    w.addEventListener('message', onMessage);
    w.postMessage({ type: 'ping' });
  });
}
