// ─── Pipeline worker ─────────────────────────────────────────────────────────

onmessage = ({ data }) => {
  if (data?.type === 'ping') postMessage({ type: 'pong' });
};
