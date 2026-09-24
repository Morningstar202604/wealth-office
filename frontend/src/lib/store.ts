/** 极简全局状态：仪表盘数据 + 历史 + 引导信息，组件通过 useSyncExternalStore 订阅。 */

import { useSyncExternalStore } from "react";
import { api } from "./api";
import type { BootstrapData, DashboardData, RunRecord } from "./types";

export interface AppState {
  dashboard: DashboardData | null;
  bootstrap: BootstrapData | null;
  history: RunRecord[];
  loading: boolean;
  error: string | null;
  refreshTick: number;
}

let state: AppState = {
  dashboard: null,
  bootstrap: null,
  history: [],
  loading: false,
  error: null,
  refreshTick: 0,
};

const listeners = new Set<() => void>();

function setState(patch: Partial<AppState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getState(): AppState {
  return state;
}

async function refreshDashboard(): Promise<void> {
  setState({ loading: true, error: null });
  try {
    const dashboard = await api<DashboardData>("/api/dashboard");
    setState({ dashboard, loading: false });
  } catch (err) {
    setState({ error: err instanceof Error ? err.message : String(err), loading: false });
  }
}

async function refreshBootstrap(): Promise<void> {
  try {
    const bootstrap = await api<BootstrapData>("/api/bootstrap");
    setState({ bootstrap });
  } catch {
    /* 引导信息失败不阻塞主流程 */
  }
}

async function refreshHistory(): Promise<void> {
  try {
    const data = await api<{ runs: RunRecord[] }>("/api/history?limit=30");
    setState({ history: data.runs ?? [] });
  } catch {
    /* ignore */
  }
}

/** 数据发生变更后统一刷新（记账/设置/问答完成时调用） */
function bump(): void {
  setState({ refreshTick: state.refreshTick + 1 });
  void refreshDashboard();
  void refreshHistory();
}

export function useApp(): AppState {
  return useSyncExternalStore(subscribe, getState);
}

export const store = {
  useApp,
  refreshDashboard,
  refreshBootstrap,
  refreshHistory,
  bump,
  getState,
};
