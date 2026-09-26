import { useEffect, useState } from "react";

/**
 * Returns `value` debounced by `delayMs`. Useful for input filters where we
 * don't want to recompute filtered lists / CSV previews on every keystroke.
 */
export function useDebouncedValue<T>(value: T, delayMs = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}
