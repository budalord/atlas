import { create } from "zustand";
import type { ApiEnvelope, ClaudeDoc, Contract, Product, ProductStatus } from "../types";

interface ProductState {
  products: Product[];
  contracts: Contract[];
  claudeDoc: ClaudeDoc | null;
  selectedProductId: string | null;
  dataVersion: number;
  loading: boolean;
  error: string | null;
  fetchAll: () => Promise<void>;
  selectProduct: (id: string) => void;
  patchStatus: (id: string, status: ProductStatus) => Promise<void>;
}

export const useProductStore = create<ProductState>((set, get) => ({
  products: [],
  contracts: [],
  claudeDoc: null,
  selectedProductId: null,
  dataVersion: 0,
  loading: false,
  error: null,
  fetchAll: async () => {
    set({ loading: true, error: null });
    try {
      const [productsResponse, contractsResponse, claudeResponse] = await Promise.all([
        fetchJson<ApiEnvelope<Product[]>>("/api/products"),
        fetchJson<ApiEnvelope<Contract[]>>("/api/contracts"),
        fetchJson<ApiEnvelope<ClaudeDoc>>("/api/agents/claude")
      ]);

      const selectedProductId =
        get().selectedProductId && productsResponse.data.some((product) => product.id === get().selectedProductId)
          ? get().selectedProductId
          : productsResponse.data[0]?.id ?? null;

      set({
        products: productsResponse.data,
        contracts: contractsResponse.data,
        claudeDoc: claudeResponse.data,
        selectedProductId,
        dataVersion: Math.max(productsResponse.version, contractsResponse.version, claudeResponse.version),
        loading: false
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Unknown error",
        loading: false
      });
    }
  },
  selectProduct: (id) => set({ selectedProductId: id }),
  patchStatus: async (id, status) => {
    const res = await fetch(`/api/products/${id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status })
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    await get().fetchAll();
  }
}));

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  return response.json() as Promise<T>;
}
