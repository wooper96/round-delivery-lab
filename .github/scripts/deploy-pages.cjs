const { setTimeout: sleep } = require("node:timers/promises");

const deployments = "/repos/{owner}/{repo}/pages/deployments";
const deployment = `${deployments}/{pages_deployment_id}`;
const terminalFailures = new Set([
  "deployment_cancelled",
  "deployment_content_failed",
  "deployment_failed",
  "deployment_lost",
  "deployment_perms_error",
]);

async function deployPages(github, context, core, uploadedId, {
  cancellation = new AbortController().signal,
  timeoutMs = 600_000,
  wait = sleep,
} = {}) {
  const artifactId = Number(uploadedId);
  if (!/^\d+$/.test(uploadedId) || !Number.isSafeInteger(artifactId) || artifactId < 1) {
    throw new Error("The Pages upload did not provide a valid artifact ID.");
  }

  // Deploy the exact upload. A new lookup by name can miss a just-finalized artifact.
  const oidcToken = await core.getIDToken();
  cancellation.throwIfAborted();
  const { data: created } = await github.request(`POST ${deployments}`, {
    ...context.repo,
    artifact_id: artifactId,
    pages_build_version: context.sha,
    oidc_token: oidcToken,
  });
  const target = { ...context.repo, pages_deployment_id: created.id ?? context.sha };
  const signal = AbortSignal.any([cancellation, AbortSignal.timeout(timeoutMs)]);
  let finished = false;
  let consecutiveErrors = 0;
  let lastStatus;
  try {
    core.setOutput("page_url", created.page_url);
    for (;;) {
      signal.throwIfAborted();
      let status;
      try {
        const { data } = await github.request(`GET ${deployment}`, { ...target, request: { signal } });
        status = data.status;
        consecutiveErrors = 0;
      } catch (error) {
        signal.throwIfAborted();
        const retryable = error.status === 404 || error.status === 429 || error.status >= 500;
        if (!retryable || ++consecutiveErrors === 3) throw error;
        core.warning(`Unable to read the Pages deployment status (HTTP ${error.status}). Retrying.`);
      }
      if (status !== undefined && status !== lastStatus) {
        core.info(`Pages deployment status: ${status}`);
        lastStatus = status;
      }
      if (status === "succeed") {
        finished = true;
        return;
      }
      if (terminalFailures.has(status)) {
        finished = true;
        throw new Error(`The Pages deployment ended with status: ${status}.`);
      }
      await wait(5000, undefined, { signal });
    }
  } finally {
    if (!finished) {
      try {
        await github.request(`POST ${deployment}/cancel`, {
          ...target,
          request: { signal: AbortSignal.timeout(5000) },
        });
      } catch {
        core.warning("Unable to cancel the pending Pages deployment.");
      }
    }
  }
}

module.exports = { deployPages };
