const { setTimeout: sleep } = require("node:timers/promises");

const retryDelays = [0, 1000, 2000, 4000, 8000];

async function waitForPagesArtifact(name, id, log, {
  listArtifacts = async () => {
    // Called from a JavaScript action so the client has access to the runner's artifact service.
    const { DefaultArtifactClient } = await import("@actions/artifact");
    return new DefaultArtifactClient().listArtifacts();
  },
  wait = sleep,
} = {}) {
  if (!name || !id) {
    throw new Error("The Pages upload did not provide an artifact name and ID.");
  }

  for (const delay of retryDelays) {
    if (delay > 0) {
      log(`Waiting ${delay / 1000}s for the Pages artifact "${name}".`);
      await wait(delay);
    }
    // Without a findBy option the SDK queries the same run-scoped service as deploy-pages.
    const { artifacts } = await listArtifacts();
    const matches = artifacts.filter((artifact) => artifact.name === name);
    if (matches.length > 0) {
      if (matches.length !== 1 || String(matches[0].id) !== id) {
        throw new Error(`GitHub listed an unexpected artifact for "${name}".`);
      }
      return;
    }
  }
  throw new Error(`GitHub did not list the uploaded Pages artifact "${name}" after ${retryDelays.length} checks.`);
}

module.exports = { waitForPagesArtifact };
