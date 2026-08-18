/**
 * queue.js
 *
 * A simple serial async queue.
 * All requests to generate images run one at a time —
 * concurrent callers wait in line. This is the backbone
 * of reliability: no two Playwright sessions fighting over
 * the same browser tab.
 */

class SerialQueue {
  constructor() {
    this._running = false;
    this._queue = [];
  }

  /**
   * Returns true if a task is currently being processed.
   */
  get isBusy() {
    return this._running;
  }

  /**
   * Returns the number of tasks waiting in the queue.
   */
  get pendingCount() {
    return this._queue.length;
  }

  /**
   * Adds an async task to the queue and returns a Promise
   * that resolves (or rejects) when the task completes.
   *
   * @param {() => Promise<any>} task - Async function to execute
   * @param {number} timeoutMs - Max ms to wait before rejecting
   * @returns {Promise<any>}
   */
  enqueue(task, timeoutMs = 180000) {
    return new Promise((resolve, reject) => {
      // Wrap task with a per-request timeout
      const timedTask = () => {
        return new Promise((taskResolve, taskReject) => {
          const timer = setTimeout(() => {
            taskReject(new Error(`Task timed out after ${timeoutMs}ms`));
          }, timeoutMs);

          task()
            .then((result) => {
              clearTimeout(timer);
              taskResolve(result);
            })
            .catch((err) => {
              clearTimeout(timer);
              taskReject(err);
            });
        });
      };

      this._queue.push({ task: timedTask, resolve, reject });
      this._drain();
    });
  }

  /**
   * Internal: processes queue items one at a time.
   */
  async _drain() {
    if (this._running) return; // already processing
    if (this._queue.length === 0) return; // nothing to do

    this._running = true;
    const { task, resolve, reject } = this._queue.shift();

    try {
      const result = await task();
      resolve(result);
    } catch (err) {
      reject(err);
    } finally {
      this._running = false;
      this._drain(); // process next item
    }
  }
}

// Export a single shared queue instance
module.exports = new SerialQueue();
