/**
 * Namespaced state management module backed by localStorage.
 *
 * Provides get/set/delete operations with namespace-prefixed keys
 * and a simple pub/sub mechanism for reactive updates.
 *
 * @module state-manager
 */

/**
 * Create a namespaced state manager backed by localStorage.
 *
 * All keys are automatically prefixed with `{namespace}:` to avoid
 * collisions between different parts of the application.
 *
 * @param {string} namespace - The namespace prefix (e.g., 'nibcowork:chat').
 * @returns {StateManager}
 *
 * @typedef {Object} StateManager
 * @property {Function} get - Get a value by key.
 * @property {Function} set - Set a value by key.
 * @property {Function} delete - Delete a key.
 * @property {Function} getAll - Get all key-value pairs in this namespace.
 * @property {Function} subscribe - Subscribe to changes on a specific key.
 * @property {Function} clear - Remove all keys in this namespace.
 * @property {string} namespace - The namespace string.
 *
 * @example
 * const state = createStateManager('nibcowork:chat');
 * state.set('currentId', 'chat_123');
 * state.get('currentId'); // 'chat_123'
 *
 * const unsub = state.subscribe('currentId', (value, key) => {
 *   console.log(`${key} changed to`, value);
 * });
 *
 * state.set('currentId', 'chat_456'); // triggers subscriber
 * unsub(); // stop listening
 */
export function createStateManager(namespace) {
  /** @type {Map<string, Set<Function>>} */
  const subscribers = new Map();

  /**
   * Build the full localStorage key from a short key.
   * @param {string} key
   * @returns {string}
   */
  function fullKey(key) {
    return `${namespace}:${key}`;
  }

  /**
   * Notify all subscribers for a given key.
   * @param {string} key - The short (unprefixed) key.
   * @param {*} value - The new value.
   */
  function notify(key, value) {
    const callbacks = subscribers.get(key);
    if (callbacks) {
      for (const cb of callbacks) {
        try {
          cb(value, key);
        } catch (err) {
          console.error(`[StateManager:${namespace}] Subscriber error for key "${key}":`, err);
        }
      }
    }
  }

  return {
    /** The namespace string. */
    namespace,

    /**
     * Get a value from localStorage by key.
     * Returns `undefined` if the key does not exist.
     *
     * @param {string} key - The short key (without namespace prefix).
     * @returns {*} The parsed value, or undefined if not found.
     */
    get(key) {
      try {
        const raw = localStorage.getItem(fullKey(key));
        if (raw === null) return undefined;
        return JSON.parse(raw);
      } catch (err) {
        console.error(`[StateManager:${namespace}] Failed to get "${key}":`, err);
        return undefined;
      }
    },

    /**
     * Set a value in localStorage by key.
     * Notifies all subscribers for this key.
     *
     * @param {string} key - The short key.
     * @param {*} value - The value to store (will be JSON-serialized).
     */
    set(key, value) {
      try {
        localStorage.setItem(fullKey(key), JSON.stringify(value));
        notify(key, value);
      } catch (err) {
        console.error(`[StateManager:${namespace}] Failed to set "${key}":`, err);
      }
    },

    /**
     * Delete a key from localStorage.
     * Notifies subscribers with `undefined`.
     *
     * @param {string} key - The short key.
     */
    delete(key) {
      try {
        localStorage.removeItem(fullKey(key));
        notify(key, undefined);
      } catch (err) {
        console.error(`[StateManager:${namespace}] Failed to delete "${key}":`, err);
      }
    },

    /**
     * Get all key-value pairs in this namespace.
     *
     * Scans all localStorage keys starting with `{namespace}:` and returns
     * them as an object with short (unprefixed) keys.
     *
     * @returns {Object} An object mapping short keys to their parsed values.
     */
    getAll() {
      const result = {};
      const prefix = `${namespace}:`;

      try {
        for (let i = 0; i < localStorage.length; i++) {
          const storageKey = localStorage.key(i);
          if (storageKey && storageKey.startsWith(prefix)) {
            const shortKey = storageKey.slice(prefix.length);
            try {
              result[shortKey] = JSON.parse(localStorage.getItem(storageKey));
            } catch (_) {
              // Skip keys with unparseable values
            }
          }
        }
      } catch (err) {
        console.error(`[StateManager:${namespace}] Failed to getAll:`, err);
      }

      return result;
    },

    /**
     * Subscribe to changes on a specific key.
     * The callback is invoked whenever `set()` or `delete()` is called for that key.
     *
     * @param {string} key - The short key to watch.
     * @param {Function} callback - Called with `(value, key)` on change.
     * @returns {Function} An unsubscribe function.
     */
    subscribe(key, callback) {
      if (!subscribers.has(key)) {
        subscribers.set(key, new Set());
      }
      subscribers.get(key).add(callback);

      // Return unsubscribe function
      return () => {
        const callbacks = subscribers.get(key);
        if (callbacks) {
          callbacks.delete(callback);
          if (callbacks.size === 0) {
            subscribers.delete(key);
          }
        }
      };
    },

    /**
     * Remove all keys in this namespace from localStorage.
     * Notifies all subscribers with `undefined` for each removed key.
     */
    clear() {
      const prefix = `${namespace}:`;
      const keysToRemove = [];

      try {
        for (let i = 0; i < localStorage.length; i++) {
          const storageKey = localStorage.key(i);
          if (storageKey && storageKey.startsWith(prefix)) {
            keysToRemove.push(storageKey);
          }
        }

        for (const storageKey of keysToRemove) {
          const shortKey = storageKey.slice(prefix.length);
          localStorage.removeItem(storageKey);
          notify(shortKey, undefined);
        }
      } catch (err) {
        console.error(`[StateManager:${namespace}] Failed to clear:`, err);
      }
    }
  };
}
