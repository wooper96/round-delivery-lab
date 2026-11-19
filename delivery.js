export function deliveryPaths(pagesUrl, rawUrl) {
  return [
    { name: "Pages", url: pagesUrl },
    { name: "Pages + unique query", url: pagesUrl, uniqueQuery: true },
    { name: "Pages + fetch no-store", url: pagesUrl, cache: "no-store" },
    { name: "Raw GitHub", url: rawUrl },
    { name: "Raw GitHub + unique query", url: rawUrl, uniqueQuery: true },
    { name: "Raw GitHub + fetch no-store", url: rawUrl, cache: "no-store" },
  ];
}

export async function readRevision(path, timeoutMs = 5000) {
  const url = new URL(path.url);
  if (path.uniqueQuery) url.searchParams.set("probe", crypto.randomUUID());
  const start = performance.now();
  const response = await fetch(url, { cache: path.cache, signal: AbortSignal.timeout(timeoutMs) });
  const headers = Object.fromEntries(
    ["age", "cache-control", "etag", "x-cache"].map((name) => [name, response.headers.get(name)]),
  );
  if (!response.ok) {
    await response.body?.cancel();
    return { http: response.status, headers };
  }
  const { revision, updatedAt, pairings } = await response.json();
  const observedAt = Date.now();
  return {
    http: response.status,
    revision,
    pairings,
    observedAt: new Date(observedAt).toISOString(),
    updateToVisibleMs: Number.isFinite(Date.parse(updatedAt)) ? observedAt - Date.parse(updatedAt) : null,
    requestMs: Math.round(performance.now() - start),
    headers,
  };
}

export async function observe(path, expected, { intervalMs = 1000, timeoutMs = 600000 } = {}) {
  const deadline = performance.now() + timeoutMs;
  let first;
  let last;
  let attempts = 0;
  while (performance.now() < deadline) {
    const start = performance.now();
    attempts += 1;
    try {
      last = await readRevision(path, Math.ceil(Math.min(5000, deadline - start)));
    } catch (error) {
      last = { error: error.cause?.code ?? error.message };
    }
    first ??= last;
    if (last.revision === expected) {
      return { path: path.name, attempts, first, visible: last };
    }
    const pause = Math.min(deadline - performance.now(), start + intervalMs - performance.now());
    if (pause > 0) await new Promise((resolve) => setTimeout(resolve, pause));
  }
  return { path: path.name, attempts, first, last, timedOut: true };
}
