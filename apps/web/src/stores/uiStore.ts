import { create } from "zustand";

interface UiState {
  activeContractId: string | null;
  setActiveContractId: (id: string | null) => void;
  /** 跨组件请求"打开某产品的某功能点抽屉" */
  pendingFeatureOpen: { productId: string; featureId: string } | null;
  requestFeatureOpen: (productId: string, featureId: string) => void;
  consumeFeatureOpen: () => { productId: string; featureId: string } | null;
}

export const useUiStore = create<UiState>((set, get) => ({
  activeContractId: null,
  setActiveContractId: (id) => set({ activeContractId: id }),
  pendingFeatureOpen: null,
  requestFeatureOpen: (productId, featureId) =>
    set({ pendingFeatureOpen: { productId, featureId } }),
  consumeFeatureOpen: () => {
    const v = get().pendingFeatureOpen;
    if (v) set({ pendingFeatureOpen: null });
    return v;
  }
}));
