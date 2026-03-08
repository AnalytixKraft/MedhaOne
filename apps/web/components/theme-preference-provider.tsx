"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTheme } from "next-themes";

import { usePermissions } from "@/components/auth/permission-provider";
import {
  ApiRequestError,
  apiClient,
  type ThemePreference,
} from "@/lib/api/client";

const LAST_THEME_CACHE_KEY = "medhaone_theme_preference:last";

type ThemePreferenceContextValue = {
  preference: ThemePreference;
  loading: boolean;
  saving: boolean;
  setPreference: (value: ThemePreference) => Promise<void>;
};

const ThemePreferenceContext = createContext<ThemePreferenceContextValue | undefined>(
  undefined,
);

function isThemePreference(value: string | null): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

function getUserThemeCacheKey(userId: number) {
  return `medhaone_theme_preference:user:${userId}`;
}

function readCachedTheme(key: string) {
  if (typeof window === "undefined") {
    return null;
  }
  const value = window.localStorage.getItem(key);
  return isThemePreference(value) ? value : null;
}

function writeCachedTheme(key: string, value: ThemePreference) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(key, value);
}

export function ThemePreferenceProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { setTheme } = useTheme();
  const { user, loading: userLoading } = usePermissions();
  const [preference, setPreferenceState] = useState<ThemePreference>("system");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const fetchIdRef = useRef(0);

  useEffect(() => {
    const cachedTheme = readCachedTheme(LAST_THEME_CACHE_KEY);
    if (!cachedTheme) {
      setTheme("system");
      setLoading(false);
      return;
    }
    setPreferenceState(cachedTheme);
    setTheme(cachedTheme);
    setLoading(false);
  }, [setTheme]);

  useEffect(() => {
    if (userLoading) {
      return;
    }

    const fetchId = fetchIdRef.current + 1;
    fetchIdRef.current = fetchId;

    if (!user) {
      const fallbackTheme = readCachedTheme(LAST_THEME_CACHE_KEY) ?? "system";
      setPreferenceState(fallbackTheme);
      setTheme(fallbackTheme);
      setLoading(false);
      return;
    }

    const cachedUserTheme = readCachedTheme(getUserThemeCacheKey(user.id));
    const optimisticTheme = cachedUserTheme ?? user.theme_preference ?? "system";
    setPreferenceState(optimisticTheme);
    setTheme(optimisticTheme);
    writeCachedTheme(LAST_THEME_CACHE_KEY, optimisticTheme);
    writeCachedTheme(getUserThemeCacheKey(user.id), optimisticTheme);
    setLoading(true);

    void apiClient
      .getMyPreferences()
      .then((response) => {
        if (fetchIdRef.current !== fetchId) {
          return;
        }
        setPreferenceState(response.theme_preference);
        setTheme(response.theme_preference);
        writeCachedTheme(LAST_THEME_CACHE_KEY, response.theme_preference);
        writeCachedTheme(getUserThemeCacheKey(user.id), response.theme_preference);
      })
      .catch((error) => {
        if (fetchIdRef.current !== fetchId) {
          return;
        }
        if (error instanceof ApiRequestError && error.code === "UNAUTHORIZED") {
          return;
        }
      })
      .finally(() => {
        if (fetchIdRef.current === fetchId) {
          setLoading(false);
        }
      });
  }, [setTheme, user, userLoading]);

  const value = useMemo<ThemePreferenceContextValue>(
    () => ({
      preference,
      loading,
      saving,
      async setPreference(nextPreference) {
        setPreferenceState(nextPreference);
        setTheme(nextPreference);
        writeCachedTheme(LAST_THEME_CACHE_KEY, nextPreference);
        if (user) {
          writeCachedTheme(getUserThemeCacheKey(user.id), nextPreference);
        }
        if (!user) {
          return;
        }
        setSaving(true);
        try {
          const response = await apiClient.updateMyPreferences({
            theme_preference: nextPreference,
          });
          setPreferenceState(response.theme_preference);
          setTheme(response.theme_preference);
          writeCachedTheme(LAST_THEME_CACHE_KEY, response.theme_preference);
          writeCachedTheme(getUserThemeCacheKey(user.id), response.theme_preference);
        } finally {
          setSaving(false);
        }
      },
    }),
    [loading, preference, saving, setTheme, user],
  );

  return (
    <ThemePreferenceContext.Provider value={value}>
      {children}
    </ThemePreferenceContext.Provider>
  );
}

export function useThemePreference() {
  const value = useContext(ThemePreferenceContext);
  if (!value) {
    throw new Error("useThemePreference must be used inside ThemePreferenceProvider");
  }
  return value;
}
