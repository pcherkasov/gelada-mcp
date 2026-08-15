/**
 * Waiting for something to be true, instead of guessing how long it takes.
 *
 * A flat `setTimeout` before poking a child process is a coin flip on a loaded
 * machine: the run right after `npm run build` is exactly when startup exceeds
 * whatever the number was. And the failure is the worst kind to read, because
 * nothing in it mentions timing — a signal sent before the handler was installed
 * looks like the handler not working.
 *
 * Both helpers below are bounded, and both fail with what they actually saw, so
 * a real hang is still reported rather than waited out.
 */

/**
 * Resolves once `needle` shows up on a stream, with everything read so far.
 *
 * Attach it immediately after spawning: output that arrived before the listener
 * did is output this cannot see.
 */
export function waitForOutput(stream, needle, options = {}) {
  const { timeoutMs = 15000, label = needle } = options;

  return new Promise((resolve, reject) => {
    let buffer = '';
    let settled = false;

    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stream.off('data', onData);
      fn(arg);
    };

    const onData = (chunk) => {
      buffer += chunk.toString();
      if (buffer.includes(needle)) finish(resolve, buffer);
    };

    const timer = setTimeout(
      () =>
        finish(
          reject,
          new Error(
            `Timed out after ${timeoutMs}ms waiting for ${label}. ` +
              `Received so far: ${buffer.length ? JSON.stringify(buffer) : '(nothing)'}`,
          ),
        ),
      timeoutMs,
    );
    timer.unref?.();

    stream.on('data', onData);
  });
}

/** Polls `predicate` until it holds, or fails saying what was still true. */
export async function waitUntil(predicate, options = {}) {
  const { timeoutMs = 5000, intervalMs = 20, label = 'condition' } = options;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) {
      throw new Error(`Timed out after ${timeoutMs}ms waiting for ${label}`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/** The line the stdio server prints once it is ready to be signalled. */
export const SERVER_READY = 'Gelada MCP server connected and listening via stdio.';
