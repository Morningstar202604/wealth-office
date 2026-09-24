/** 主题系统：浅色/深色/跟随系统 + 品牌色预设 + 密度 + 动效开关。
 *  全部本机持久化（localStorage），即时生效，不依赖服务端。
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { BRAND_PRESETS } from "./brand";

export type ThemeMode = "light" | "dark" | "system";
export type Density = "comfortable" | "compact";
export type Motion = "on" | "off";

const KEYS = {
  theme: "wo.theme",
  brand: "wo.brand",
  density: "wo.density",
  motion: "wo.motion",
};

interface ThemeState {
  theme: ThemeMode;
  brand: string;
  density: Density;
  motion: Motion;
  /** 实际生效的明暗（system 已解析） */
  resolved: "light" | "dark";
  setTheme: (v: ThemeMode) => void;
  setBrand: (v: string) => void;
  setDensity: (v: Density) => void;
  setMotion: (v: Motion) => void;
}

const ThemeCtx = createContext<ThemeState | null>(null);

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function systemDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(() => load<ThemeMode>(KEYS.theme, "system"));
  const [brand, setBrandState] = useState<string>(() => load<string>(KEYS.brand, "emerald"));
  const [density, setDensityState] = useState<Density>(() => load<Density>(KEYS.density, "comfortable"));
  const [motion, setMotionState] = useState<Motion>(() => load<Motion>(KEYS.motion, "on"));

  const resolved: "light" | "dark" =
    theme === "system" ? (systemDark() ? "dark" : "light") : theme;

  // 明暗 + 品牌色 + 密度 + 动效 -> html 属性
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", resolved === "dark");
    root.dataset.brand = brand;
    root.dataset.density = density;
    root.dataset.motion = motion;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", resolved === "dark" ? "#0b1120" : "#f6f8fb");
  }, [resolved, brand, density, motion]);

  // 跟随系统切换
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      const root = document.documentElement;
      root.classList.toggle("dark", mq.matches);
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  const setTheme = useCallback((v: ThemeMode) => {
    setThemeState(v);
    save(KEYS.theme, v);
  }, []);
  const setBrand = useCallback((v: string) => {
    setBrandState(v);
    save(KEYS.brand, v);
  }, []);
  const setDensity = useCallback((v: Density) => {
    setDensityState(v);
    save(KEYS.density, v);
  }, []);
  const setMotion = useCallback((v: Motion) => {
    setMotionState(v);
    save(KEYS.motion, v);
  }, []);

  const value = useMemo<ThemeState>(
    () => ({ theme, brand, density, motion, resolved, setTheme, setBrand, setDensity, setMotion }),
    [theme, brand, density, motion, resolved, setTheme, setBrand, setDensity, setMotion],
  );

  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeCtx);
  if (!ctx) throw new Error("useTheme 必须在 ThemeProvider 内使用");
  return ctx;
}

/** 品牌色预设（供设置页选择） */
export const BRAND_OPTIONS = BRAND_PRESETS.map((p) => ({ id: p.id, label: p.label, accent: p.accent }));
