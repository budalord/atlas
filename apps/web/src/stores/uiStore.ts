import { create } from "zustand";

interface UiState {
  activeContractId: string | null;
  setActiveContractId: (id: string | null) => void;
}

export const useUiStore = create<UiState>((set) => ({
  activeContractId: null,
  setActiveContractId: (id) => set({ activeContractId: id })
}));
