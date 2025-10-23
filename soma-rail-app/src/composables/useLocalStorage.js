import { ref, watch } from 'vue';

/**
 * Composable for localStorage persistence
 * @param {string} key - localStorage key
 * @param {*} defaultValue - default value if key doesn't exist
 * @returns {Ref} - reactive ref synced with localStorage
 */
export function useLocalStorage(key, defaultValue) {
  const storedValue = localStorage.getItem(key);
  const data = ref(storedValue ? JSON.parse(storedValue) : defaultValue);

  watch(data, (newValue) => {
    localStorage.setItem(key, JSON.stringify(newValue));
  }, { deep: true });

  return data;
}
