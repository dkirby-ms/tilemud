export async function start(): Promise<void> {
  // Placeholder bootstrap: future tasks will wire Express + Colyseus here.
  return Promise.resolve();
}

const maybeProcess = (globalThis as { process?: { argv?: string[]; exitCode?: number } }).process;

const isDirectExecution = (() => {
  if (!maybeProcess?.argv?.[1]) {
    return false;
  }

  try {
    const executedPath = new URL(import.meta.url).pathname;
    const cliPath = new URL(`file://${maybeProcess.argv[1]}`).pathname;
    return executedPath === cliPath;
  } catch {
    return false;
  }
})();

if (isDirectExecution) {
  start().catch((error) => {
    // eslint-disable-next-line no-console -- placeholder logging until pino integration (T055)
    console.error("Failed to start server", error);
    if (maybeProcess) {
      maybeProcess.exitCode = 1;
    }
  });
}
