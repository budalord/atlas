import { create } from "zustand";
import type {
  ApiEnvelope,
  IntakeListItem,
  IntakePrompts,
  IntakeStageResponse,
  ProductTheme
} from "../types";

interface StartIntakeInput {
  id: string;
  name: string;
  source_path: string;
  theme: ProductTheme | "other";
}

interface IntakeState {
  list: IntakeListItem[];
  loading: boolean;
  error: string | null;
  fetchList: () => Promise<void>;
  start: (input: StartIntakeInput) => Promise<IntakeListItem>;
  fetchStage: (id: string) => Promise<IntakeStageResponse>;
  fetchPrompts: (id: string) => Promise<IntakePrompts>;
  complete: (id: string) => Promise<void>;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    let detail = "";
    try {
      detail = (await response.json()).error ?? "";
    } catch {
      // ignore
    }
    throw new Error(detail || `${url} returned ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export const useIntakeStore = create<IntakeState>((set, get) => ({
  list: [],
  loading: false,
  error: null,
  fetchList: async () => {
    set({ loading: true, error: null });
    try {
      const response = await fetchJson<ApiEnvelope<IntakeListItem[]>>("/api/intake/list");
      set({ list: response.data, loading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "unknown", loading: false });
    }
  },
  start: async (input) => {
    const response = await fetchJson<ApiEnvelope<IntakeListItem>>("/api/intake/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    });
    await get().fetchList();
    return response.data;
  },
  fetchStage: async (id) => {
    const response = await fetchJson<ApiEnvelope<IntakeStageResponse>>(`/api/intake/${id}/stage`);
    return response.data;
  },
  fetchPrompts: async (id) => {
    const response = await fetchJson<ApiEnvelope<IntakePrompts>>(`/api/intake/${id}/prompts`);
    return response.data;
  },
  complete: async (id) => {
    await fetchJson(`/api/intake/${id}/complete`, { method: "POST" });
    await get().fetchList();
  }
}));
