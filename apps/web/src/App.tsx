import { useEffect } from "react";
import { BrowserRouter, NavLink, Route, Routes } from "react-router-dom";
import { AgentInbox } from "./components/AgentInbox";
import { AICatalog } from "./components/AICatalog";
import { ContractList } from "./components/ContractList";
import { DesignTrack } from "./components/DesignTrack";
import { ProductDetail } from "./components/ProductDetail";
import { ProductList } from "./components/ProductList";
import { TodoBoard } from "./components/TodoBoard";
import { IntakeDetail } from "./pages/IntakeDetail";
import { IntakeHome } from "./pages/IntakeHome";
import { useIntakeStore } from "./stores/intakeStore";
import { useProductStore } from "./stores/productStore";

export default function App() {
  const fetchIntakeList = useIntakeStore((s) => s.fetchList);

  useEffect(() => {
    void fetchIntakeList();
    const events = new EventSource("/api/events");
    events.addEventListener("data-change", () => {
      void useIntakeStore.getState().fetchList();
    });
    return () => events.close();
  }, [fetchIntakeList]);

  return (
    <BrowserRouter>
      <div className="grid min-h-screen grid-rows-[auto_1fr] bg-slate-50 text-slate-950">
        <AppHeader />
        <Routes>
          <Route element={<OverviewPage />} path="/" />
          <Route element={<IntakeHome />} path="/intake" />
          <Route element={<IntakeDetail />} path="/intake/:id" />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

function AppHeader() {
  const products = useProductStore((s) => s.products);
  const intakeCount = useIntakeStore((s) => s.list.length);
  const activeProducts = products.filter((product) => product.meta.status === "in-progress").length;

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `rounded-md px-3 py-1.5 text-sm transition ${
      isActive ? "bg-slate-950 text-white" : "text-slate-700 hover:bg-slate-100"
    }`;

  return (
    <header className="border-b border-slate-200 bg-white px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-6">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-cyan-700">Agent-native spec hub</div>
            <h1 className="mt-1 text-xl font-semibold">Atlas</h1>
          </div>
          <nav className="flex items-center gap-1">
            <NavLink className={linkClass} end to="/">
              产品总览
            </NavLink>
            <NavLink className={linkClass} to="/intake">
              录入{intakeCount > 0 ? ` (${intakeCount})` : ""}
            </NavLink>
          </nav>
        </div>
        <div className="text-xs text-slate-500">
          <span className="font-semibold text-slate-900">{products.length}</span> 个产品
          <span className="mx-1.5 text-slate-300">·</span>
          <span className="font-semibold text-slate-900">{activeProducts}</span> 进行中
        </div>
      </div>
    </header>
  );
}

function OverviewPage() {
  const products = useProductStore((s) => s.products);
  const contracts = useProductStore((s) => s.contracts);
  const claudeDoc = useProductStore((s) => s.claudeDoc);
  const selectedProductId = useProductStore((s) => s.selectedProductId);
  const selectProduct = useProductStore((s) => s.selectProduct);
  const fetchAll = useProductStore((s) => s.fetchAll);
  const loading = useProductStore((s) => s.loading);
  const error = useProductStore((s) => s.error);

  useEffect(() => {
    void fetchAll();
    const events = new EventSource("/api/events");
    events.addEventListener("data-change", () => {
      void useProductStore.getState().fetchAll();
    });
    return () => events.close();
  }, [fetchAll]);

  const selectedProduct = products.find((product) => product.id === selectedProductId) ?? null;

  return (
    <div className="grid min-h-0 grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)_360px]">
      <ProductList onSelect={selectProduct} products={products} selectedProductId={selectedProductId} />
      <div className="min-h-0 overflow-auto">
        {error ? (
          <div className="m-5 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
        ) : null}
        {loading && products.length === 0 ? (
          <div className="p-6 text-xs text-slate-500">读取本地数据中...</div>
        ) : (
          <ProductDetail product={selectedProduct} />
        )}
        <TodoBoard />
        <DesignTrack />
        <AICatalog />
      </div>
      <aside className="min-h-0 overflow-auto border-t border-slate-200 bg-white xl:border-l xl:border-t-0">
        <ContractList contracts={contracts} />
        <AgentInbox claudeDoc={claudeDoc} />
      </aside>
    </div>
  );
}

