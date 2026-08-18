/**
 * queue.js
 *
 * Single-request lock mechanism.
 * Only allows 1 image generation task to run at a time.
 * If another request arrives while a task is running, it is
 * immediately rejected rather than queued.
 */

class SingleTaskQueue {
  constructor() {
    this._running = false;
  }

  /**
   * Returns true if a task is currently being processed.
   */
  get isBusy() {
    return this._running;
  }

  /**
   * Returns 0 since requests are no longer queued.
   */
  get pendingCount() {
    return 0;
  }

  /**
   * Executes a task only if no task is currently running.
   * If busy, rejects immediately with a SERVICE_BUSY error.
   *
   * @param {() => Promise<any>} task - Async function to execute
   * @param {number} timeoutMs - Max ms to wait before rejecting
   * @returns {Promise<any>}
   */
  async enqueue(task, timeoutMs = 180000) {
    if (this._running) {
      const busyError = new Error("SERVICE_BUSY");
      busyError.code = "SERVICE_BUSY";
      throw busyError;
    }

    this._running = true;

    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          this._running = false;
          reject(new Error(`Task timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      task()
        .then((result) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            this._running = false;
            resolve(result);
          }
        })
        .catch((err) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            this._running = false;
            reject(err);
          }
        });
    });
  }
}

// Export a single shared instance
module.exports = new SingleTaskQueue();