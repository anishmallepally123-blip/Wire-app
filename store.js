/* Tiny persistence layer.
   Keeps the same {value} shape everywhere so swapping backends is one file. */
export const store = {
  async get(key) {
    try {
      const value = localStorage.getItem(key);
      return value == null ? null : { key, value };
    } catch (e) {
      return null;
    }
  },
  async set(key, value) {
    try {
      localStorage.setItem(key, value);
      return { key, value };
    } catch (e) {
      return null;
    }
  },
};
