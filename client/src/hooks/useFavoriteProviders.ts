import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "cloudana-favorite-providers";

function load(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function save(ids: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    /* ignore */
  }
}

export function useFavoriteProviders() {
  const [favoriteProviders, setFavoriteProviders] = useState<string[]>(() => load());

  useEffect(() => {
    save(favoriteProviders);
  }, [favoriteProviders]);

  const updateFavoriteProviders = useCallback((next: string[]) => {
    setFavoriteProviders(next);
  }, []);

  const toggle = useCallback((owner: string) => {
    setFavoriteProviders((prev) =>
      prev.includes(owner) ? prev.filter((x) => x !== owner) : [...prev, owner]
    );
  }, []);

  return { favoriteProviders, updateFavoriteProviders, toggle };
}
