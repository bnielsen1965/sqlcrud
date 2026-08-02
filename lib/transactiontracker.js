/**
 * Tracks transactions within a configurable time window.
 * Maintains an array of timestamps, prunes expired entries on each add,
 * and provides a transactions-per-minute calculation.
 */
export default class TransactionTracker {
  /**
   * @param {number} windowMs - Window size in milliseconds (default: 60000 = 1 minute)
   */
  constructor (windowMs = 60000) {
    this.windowMs = windowMs;
    this.timestamps = [];
  }

  /**
   * Prune timestamps that have fallen outside the window.
   */
  prune () {
    const now = Date.now();
    const cutoff = now - this.windowMs;

    // Prune timestamps outside the window
    // Since we always append in order, we can shift from the front
    while (this.timestamps.length > 0 && this.timestamps[0] < cutoff) {
      this.timestamps.shift();
    }
  }

  /**
   * Add a transaction timestamp and prune any entries outside the window.
   */
  add () {
    this.prune();

    // Add the new timestamp
    this.timestamps.push(Date.now());
  }

  /**
   * Get the number of transactions currently in the window.
   * Prunes expired entries first so the count stays accurate even when no new transactions arrive.
   * @returns {number}
   */
  getCount () {
    this.prune();
    return this.timestamps.length;
  }

  /**
   * Calculate transactions per minute based on the current window.
   * If the window is exactly 1 minute, this equals getCount().
   * For other window sizes, it scales proportionally.
   * @returns {number}
   */
  getTPM () {
    const count = this.getCount();
    const tpm = (count / this.windowMs) * 60000;
    return Math.round(tpm * 100) / 100; // Round to 2 decimal places
  }

  /**
   * Get the oldest timestamp in the current window, or null if empty.
   * @returns {number|null}
   */
  getOldestTimestamp () {
    return this.timestamps.length > 0 ? this.timestamps[0] : null;
  }

  /**
   * Get the newest timestamp in the current window, or null if empty.
   * @returns {number|null}
   */
  getNewestTimestamp () {
    return this.timestamps.length > 0 ? this.timestamps[this.timestamps.length - 1] : null;
  }

  /**
   * Check if this tracker has any transactions in the window.
   * @returns {boolean}
   */
  isEmpty () {
    return this.timestamps.length === 0;
  }
}
