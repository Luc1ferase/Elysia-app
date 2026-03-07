import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import type { Listing, Market, Product, ShippingRate, WorkspaceData } from "./types";
import { createEmptyListing, createEmptyMarket, createEmptyProduct, createEmptyShippingRate, createInitialWorkspace } from "./lib/defaults";
import { loadWorkspace, saveWorkspace } from "./lib/storage";
import { calculatePricingRow } from "./lib/pricing";
import { pingApi, pullSnapshot, pushSnapshot } from "./lib/api";

function now() {
  return new Date().toISOString();
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(2)}%`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value);
}

function App() {
  const [workspace, setWorkspace] = useState<WorkspaceData>(() => loadWorkspace());
  const [productDraft, setProductDraft] = useState<Product>(createEmptyProduct());
  const [marketDraft, setMarketDraft] = useState<Market>(createEmptyMarket());
  const [shippingRateDraft, setShippingRateDraft] = useState<ShippingRate>(createEmptyShippingRate());
  const [listingDraft, setListingDraft] = useState<Listing>(createEmptyListing());
  const [selectedMarketIds, setSelectedMarketIds] = useState<string[]>([]);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [editingMarketId, setEditingMarketId] = useState<string | null>(null);
  const [editingShippingRateId, setEditingShippingRateId] = useState<string | null>(null);
  const [editingListingId, setEditingListingId] = useState<string | null>(null);
  const [apiMessage, setApiMessage] = useState("尚未连接服务器");
  const [productQuery, setProductQuery] = useState("");
  const [listingQuery, setListingQuery] = useState("");
  const [shippingMarketFilter, setShippingMarketFilter] = useState<string>("all");
  const [listingMarketFilter, setListingMarketFilter] = useState<string>("all");
  const workbookInputRef = useRef<HTMLInputElement | null>(null);
  const workspaceJsonInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    saveWorkspace(workspace);
  }, [workspace]);

  const marketMap = useMemo(() => new Map(workspace.markets.map((market) => [market.id, market])), [workspace.markets]);
  const productMap = useMemo(() => new Map(workspace.products.map((product) => [product.id, product])), [workspace.products]);

  const allPricingRows = useMemo(() => {
    return workspace.listings
      .filter((listing) => listing.isActive)
      .map((listing) => {
        const market = marketMap.get(listing.marketId);
        const product = productMap.get(listing.productId);
        if (!market || !product) {
          return null;
        }
        const shippingRates = workspace.shippingRates.filter((rate) => rate.marketId === listing.marketId);
        return calculatePricingRow({ product, market, listing, shippingRates });
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row));
  }, [marketMap, productMap, workspace.listings, workspace.shippingRates]);

  const pricingViews = useMemo(() => {
    return selectedMarketIds
      .map((marketId) => {
        const market = marketMap.get(marketId);
        if (!market) {
          return null;
        }

        const rows = workspace.listings
          .filter((listing) => listing.marketId === marketId && listing.isActive)
          .map((listing) => {
            const product = productMap.get(listing.productId);
            if (!product) {
              return null;
            }
            const shippingRates = workspace.shippingRates.filter((rate) => rate.marketId === marketId);
            return calculatePricingRow({ product, market, listing, shippingRates });
          })
          .filter((row): row is NonNullable<typeof row> => Boolean(row));

        const totalProfitRmb = rows.reduce((sum, row) => sum + row.profitRmb, 0);
        const averageMargin = rows.length ? rows.reduce((sum, row) => sum + row.grossMargin, 0) / rows.length : 0;
        return { market, rows, totalProfitRmb, averageMargin };
      })
      .filter((view): view is NonNullable<typeof view> => Boolean(view));
  }, [marketMap, productMap, selectedMarketIds, workspace.listings, workspace.shippingRates]);

  const filteredProducts = useMemo(() => {
    const keyword = productQuery.trim().toLowerCase();
    if (!keyword) {
      return workspace.products;
    }
    return workspace.products.filter((product) => [product.sku, product.name, product.size].join(" ").toLowerCase().includes(keyword));
  }, [productQuery, workspace.products]);

  const filteredShippingRates = useMemo(() => {
    if (shippingMarketFilter === "all") {
      return workspace.shippingRates;
    }
    return workspace.shippingRates.filter((rate) => rate.marketId === shippingMarketFilter);
  }, [shippingMarketFilter, workspace.shippingRates]);

  const filteredListings = useMemo(() => {
    const keyword = listingQuery.trim().toLowerCase();
    return workspace.listings.filter((listing) => {
      if (listingMarketFilter !== "all" && listing.marketId !== listingMarketFilter) {
        return false;
      }
      if (!keyword) {
        return true;
      }
      const product = productMap.get(listing.productId);
      const market = marketMap.get(listing.marketId);
      return [product?.sku, product?.name, market?.name].filter(Boolean).join(" ").toLowerCase().includes(keyword);
    });
  }, [listingMarketFilter, listingQuery, marketMap, productMap, workspace.listings]);

  const overallStats = useMemo(() => {
    const totalProfitRmb = allPricingRows.reduce((sum, row) => sum + row.profitRmb, 0);
    const averageMargin = allPricingRows.length ? allPricingRows.reduce((sum, row) => sum + row.grossMargin, 0) / allPricingRows.length : 0;
    const profitableCount = allPricingRows.filter((row) => row.profitRmb >= 0).length;
    const bestRow = [...allPricingRows].sort((left, right) => right.profitRmb - left.profitRmb)[0];
    const riskyRows = [...allPricingRows].filter((row) => row.grossMargin < 0.2).sort((left, right) => left.grossMargin - right.grossMargin).slice(0, 5);
    return { totalProfitRmb, averageMargin, profitableCount, bestRow, riskyRows };
  }, [allPricingRows]);

  function patchWorkspace(mutator: (current: WorkspaceData) => WorkspaceData) {
    setWorkspace((current) => mutator(current));
  }

  function resetEditorStates() {
    setProductDraft(createEmptyProduct());
    setMarketDraft(createEmptyMarket());
    setShippingRateDraft(createEmptyShippingRate());
    setListingDraft(createEmptyListing());
    setEditingProductId(null);
    setEditingMarketId(null);
    setEditingShippingRateId(null);
    setEditingListingId(null);
  }

  function setDefaultCompare(markets: Market[]) {
    setSelectedMarketIds(markets.slice(0, 2).map((market) => market.id));
  }

  function submitProduct() {
    if (!productDraft.sku.trim() || !productDraft.name.trim()) {
      return;
    }

    const timestamp = now();
    patchWorkspace((current) => ({
      ...current,
      products: editingProductId
        ? current.products.map((item) => item.id === editingProductId ? { ...productDraft, updatedAt: timestamp } : item)
        : [{ ...productDraft, createdAt: timestamp, updatedAt: timestamp }, ...current.products],
    }));

    setProductDraft(createEmptyProduct());
    setEditingProductId(null);
  }

  function submitMarket() {
    if (!marketDraft.code.trim() || !marketDraft.name.trim()) {
      return;
    }

    const timestamp = now();
    patchWorkspace((current) => ({
      ...current,
      markets: editingMarketId
        ? current.markets.map((item) => item.id === editingMarketId ? { ...marketDraft, updatedAt: timestamp } : item)
        : [{ ...marketDraft, createdAt: timestamp, updatedAt: timestamp }, ...current.markets],
    }));

    setMarketDraft(createEmptyMarket());
    setEditingMarketId(null);
  }

  function submitShippingRate() {
    if (!shippingRateDraft.marketId) {
      return;
    }

    const timestamp = now();
    patchWorkspace((current) => ({
      ...current,
      shippingRates: editingShippingRateId
        ? current.shippingRates.map((item) => item.id === editingShippingRateId ? { ...shippingRateDraft, updatedAt: timestamp } : item)
        : [{ ...shippingRateDraft, createdAt: timestamp, updatedAt: timestamp }, ...current.shippingRates],
    }));

    setShippingRateDraft(createEmptyShippingRate(shippingRateDraft.marketId));
    setEditingShippingRateId(null);
  }

  function submitListing() {
    if (!listingDraft.productId || !listingDraft.marketId) {
      return;
    }

    const exists = workspace.listings.some((item) => item.productId === listingDraft.productId && item.marketId === listingDraft.marketId && item.id !== editingListingId);
    if (exists) {
      window.alert("同一商品在同一站点只能保留一条上架记录");
      return;
    }

    const timestamp = now();
    patchWorkspace((current) => ({
      ...current,
      listings: editingListingId
        ? current.listings.map((item) => item.id === editingListingId ? { ...listingDraft, updatedAt: timestamp } : item)
        : [{ ...listingDraft, createdAt: timestamp, updatedAt: timestamp }, ...current.listings],
    }));

    setListingDraft(createEmptyListing());
    setEditingListingId(null);
  }

  async function handlePing() {
    try {
      const result = await pingApi(workspace.sync.apiBaseUrl);
      setApiMessage(`服务器在线：${result.timestamp}`);
      patchWorkspace((current) => ({
        ...current,
        sync: {
          ...current.sync,
          lastSyncStatus: "success",
          lastError: undefined,
        },
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      setApiMessage(`服务器不可用：${message}`);
      patchWorkspace((current) => ({
        ...current,
        sync: {
          ...current.sync,
          lastSyncStatus: "error",
          lastError: message,
        },
      }));
    }
  }

  async function handlePush() {
    try {
      await pushSnapshot(workspace.sync.apiBaseUrl, {
        products: workspace.products,
        markets: workspace.markets,
        shippingRates: workspace.shippingRates,
        listings: workspace.listings,
      });
      const timestamp = now();
      setApiMessage(`已推送到服务器：${timestamp}`);
      patchWorkspace((current) => ({
        ...current,
        sync: {
          ...current.sync,
          lastSyncAt: timestamp,
          lastSyncStatus: "success",
          lastError: undefined,
        },
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      setApiMessage(`推送失败：${message}`);
      patchWorkspace((current) => ({
        ...current,
        sync: {
          ...current.sync,
          lastSyncStatus: "error",
          lastError: message,
        },
      }));
    }
  }

  async function handlePull() {
    try {
      const snapshot = await pullSnapshot(workspace.sync.apiBaseUrl);
      const timestamp = now();
      setWorkspace((current) => ({
        ...current,
        products: snapshot.products,
        markets: snapshot.markets,
        shippingRates: snapshot.shippingRates,
        listings: snapshot.listings,
        sync: {
          ...current.sync,
          lastSyncAt: timestamp,
          lastSyncStatus: "success",
          lastError: undefined,
        },
      }));
      setApiMessage(`已从服务器拉取：${timestamp}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      setApiMessage(`拉取失败：${message}`);
      patchWorkspace((current) => ({
        ...current,
        sync: {
          ...current.sync,
          lastSyncStatus: "error",
          lastError: message,
        },
      }));
    }
  }

  function openWorkbookPicker() {
    workbookInputRef.current?.click();
  }

  function openWorkspaceJsonPicker() {
    workspaceJsonInputRef.current?.click();
  }

  async function handleWorkspaceJsonChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    try {
      const content = JSON.parse(await file.text()) as WorkspaceData;
      if (!Array.isArray(content.products) || !Array.isArray(content.markets) || !Array.isArray(content.shippingRates) || !Array.isArray(content.listings) || !content.sync) {
        throw new Error("文件结构不正确");
      }
      resetEditorStates();
      setDefaultCompare(content.markets);
      setWorkspace(content);
      setApiMessage(`已导入工作区备份：${file.name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      setApiMessage(`导入工作区失败：${message}`);
    }
  }

  async function handleWorkbookFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    try {
      const { importWorkbookFile } = await import("./lib/workbookImport");
      const imported = await importWorkbookFile(file);
      resetEditorStates();
      setDefaultCompare(imported.markets);
      setWorkspace((current) => ({
        ...current,
        products: imported.products,
        markets: imported.markets,
        shippingRates: imported.shippingRates,
        listings: imported.listings,
      }));
      setApiMessage(`已导入本地工作簿：${file.name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      setApiMessage(`导入工作簿失败：${message}`);
    }
  }

  async function importWorkbookPreset() {
    const confirmed = window.confirm("这会用 Excel 模板覆盖当前站点与物流价卡，并清空现有上架记录，是否继续？");
    if (!confirmed) {
      return;
    }

    const workbookPreset = (await import("./data/workbookPreset.json")).default as {
      markets: Market[];
      shippingRates: ShippingRate[];
    };

    resetEditorStates();
    setDefaultCompare(workbookPreset.markets);
    setWorkspace((current) => ({
      ...current,
      markets: workbookPreset.markets,
      shippingRates: workbookPreset.shippingRates,
      listings: [],
    }));
    setApiMessage(`已导入 Excel 站点模板：${now()}`);
  }

  async function importWorkbookSampleDataset() {
    const confirmed = window.confirm("这会用 Excel 样例覆盖当前全部工作区数据，是否继续？");
    if (!confirmed) {
      return;
    }

    const [{ default: workbookPreset }, { default: workbookSamples }] = await Promise.all([
      import("./data/workbookPreset.json"),
      import("./data/workbookSamples.json"),
    ]);

    resetEditorStates();
    setDefaultCompare(workbookPreset.markets as Market[]);
    setWorkspace((current) => ({
      ...current,
      products: workbookSamples.products as Product[],
      markets: workbookPreset.markets as Market[],
      shippingRates: workbookPreset.shippingRates as ShippingRate[],
      listings: workbookSamples.listings as Listing[],
    }));
    setApiMessage(`已导入 Excel 样例全量数据：${now()}`);
  }

  async function importWorkbookFullDataset() {
    const confirmed = window.confirm("这会把原始工作簿中的真实商品与上架数据导入工作区，是否继续？");
    if (!confirmed) {
      return;
    }

    const [{ default: workbookPreset }, { default: workbookFullData }] = await Promise.all([
      import("./data/workbookPreset.json"),
      import("./data/workbookFullData.json"),
    ]);

    resetEditorStates();
    setDefaultCompare(workbookPreset.markets as Market[]);
    setWorkspace((current) => ({
      ...current,
      products: workbookFullData.products as Product[],
      markets: workbookPreset.markets as Market[],
      shippingRates: workbookPreset.shippingRates as ShippingRate[],
      listings: workbookFullData.listings as Listing[],
    }));
    setApiMessage(`已导入真实工作簿全量数据：${now()}`);
  }

  function resetWorkspace() {
    const confirmed = window.confirm("这会清空当前本地工作区，仅保留 API 地址配置，是否继续？");
    if (!confirmed) {
      return;
    }
    const fresh = createInitialWorkspace();
    fresh.sync.apiBaseUrl = workspace.sync.apiBaseUrl;
    setWorkspace(fresh);
    resetEditorStates();
    setSelectedMarketIds([]);
    setApiMessage("本地工作区已重置");
  }

  function exportWorkspace() {
    const blob = new Blob([JSON.stringify(workspace, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `pricing-workspace-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="app-shell">
      <input ref={workbookInputRef} className="hidden-file-input" type="file" accept=".xlsx,.xlsm,.xls" onChange={handleWorkbookFileChange} />
      <input ref={workspaceJsonInputRef} className="hidden-file-input" type="file" accept="application/json,.json" onChange={handleWorkspaceJsonChange} />
      <section className="hero card">
        <div className="hero-copy">
          <span className="eyebrow">Pricing Desk</span>
          <h1>跨境电商定价系统</h1>
          <p>桌面端本地优先运行；服务器 API 仅负责同步与远端部署。你现在可以导入 Excel 站点模板、样例数据，或整份工作簿的真实商品数据。</p>
          <div className="actions hero-actions">
            <button className="ghost" onClick={openWorkbookPicker}>导入本地 .xlsx</button>
            <button className="ghost" onClick={importWorkbookPreset}>导入 Excel 站点模板</button>
            <button className="ghost" onClick={importWorkbookSampleDataset}>导入 Excel 样例数据</button>
            <button onClick={importWorkbookFullDataset}>导入真实工作簿数据</button>
          </div>
        </div>
        <div className="hero-stats">
          <div><strong>{workspace.products.length}</strong><span>商品</span></div>
          <div><strong>{workspace.markets.length}</strong><span>站点</span></div>
          <div><strong>{workspace.listings.length}</strong><span>上架记录</span></div>
          <div><strong>{workspace.shippingRates.length}</strong><span>物流档位</span></div>
        </div>
      </section>

      <section className="kpi-grid">
        <article className="kpi-card card">
          <span>总利润（RMB）</span>
          <strong>{formatNumber(overallStats.totalProfitRmb)}</strong>
          <small>基于当前全部启用上架记录</small>
        </article>
        <article className="kpi-card card">
          <span>平均毛利率</span>
          <strong>{formatPercent(overallStats.averageMargin)}</strong>
          <small>当前本地工作区整体均值</small>
        </article>
        <article className="kpi-card card">
          <span>盈利商品数</span>
          <strong>{overallStats.profitableCount}</strong>
          <small>利润不低于 0 的记录数</small>
        </article>
        <article className="kpi-card card">
          <span>最佳单品</span>
          <strong>{overallStats.bestRow?.sku ?? "暂无"}</strong>
          <small>{overallStats.bestRow ? `利润 ${formatNumber(overallStats.bestRow.profitRmb)} RMB` : "导入数据后可见"}</small>
        </article>
      </section>

      <section className="grid two-columns balanced-grid">
        <div className="card">
          <div className="section-title">
            <div>
              <h2>商品管理</h2>
              <span>维护 SKU、成本、均摊和重量</span>
            </div>
            <input className="section-search" value={productQuery} onChange={(event) => setProductQuery(event.target.value)} placeholder="搜索 SKU / 名称 / 规格" />
          </div>
          <div className="form-grid product-grid">
            <input value={productDraft.sku} onChange={(event) => setProductDraft({ ...productDraft, sku: event.target.value })} placeholder="SKU" />
            <input value={productDraft.name} onChange={(event) => setProductDraft({ ...productDraft, name: event.target.value })} placeholder="商品名" />
            <input value={productDraft.size} onChange={(event) => setProductDraft({ ...productDraft, size: event.target.value })} placeholder="规格" />
            <input type="number" value={productDraft.costRmb} onChange={(event) => setProductDraft({ ...productDraft, costRmb: Number(event.target.value) })} placeholder="成本 RMB" />
            <input type="number" value={productDraft.amortizedCostRmb} onChange={(event) => setProductDraft({ ...productDraft, amortizedCostRmb: Number(event.target.value) })} placeholder="均摊成本 RMB" />
            <input type="number" value={productDraft.weightGrams} onChange={(event) => setProductDraft({ ...productDraft, weightGrams: Number(event.target.value) })} placeholder="重量 g" />
          </div>
          <div className="actions">
            <button onClick={submitProduct}>{editingProductId ? "更新商品" : "新增商品"}</button>
            <button className="ghost" onClick={() => { setProductDraft(createEmptyProduct()); setEditingProductId(null); }}>清空</button>
          </div>
          <div className="table-shell">
            <table>
              <thead><tr><th>SKU</th><th>名称</th><th>规格</th><th>成本</th><th>重量</th><th>操作</th></tr></thead>
              <tbody>
                {filteredProducts.map((product) => (
                  <tr key={product.id}>
                    <td>{product.sku}</td>
                    <td>{product.name}</td>
                    <td>{product.size || "-"}</td>
                    <td>{product.costRmb.toFixed(2)}</td>
                    <td>{product.weightGrams}g</td>
                    <td className="table-actions">
                      <button className="ghost" onClick={() => { setProductDraft(product); setEditingProductId(product.id); }}>编辑</button>
                      <button className="danger" onClick={() => patchWorkspace((current) => ({ ...current, products: current.products.filter((item) => item.id !== product.id), listings: current.listings.filter((item) => item.productId !== product.id) }))}>删除</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="section-title">
            <div>
              <h2>站点配置</h2>
              <span>维护汇率、费率、固定扣减与差异说明</span>
            </div>
            <div className="pill-group">
              <span className="pill">对比位 {selectedMarketIds.length}/2</span>
              <span className="pill">已选 {selectedMarketIds.map((id) => marketMap.get(id)?.name).filter(Boolean).join(" / ") || "无"}</span>
            </div>
          </div>
          <div className="form-grid market-grid">
            <input value={marketDraft.code} onChange={(event) => setMarketDraft({ ...marketDraft, code: event.target.value })} placeholder="站点代码" />
            <input value={marketDraft.name} onChange={(event) => setMarketDraft({ ...marketDraft, name: event.target.value })} placeholder="站点名称" />
            <input value={marketDraft.currency} onChange={(event) => setMarketDraft({ ...marketDraft, currency: event.target.value })} placeholder="币种" />
            <input type="number" step="0.0001" value={marketDraft.exchangeRate} onChange={(event) => setMarketDraft({ ...marketDraft, exchangeRate: Number(event.target.value) })} placeholder="汇率" />
            <input type="number" step="0.0001" value={marketDraft.commissionRate} onChange={(event) => setMarketDraft({ ...marketDraft, commissionRate: Number(event.target.value) })} placeholder="佣金费率" />
            <input type="number" step="0.0001" value={marketDraft.transactionFeeRate} onChange={(event) => setMarketDraft({ ...marketDraft, transactionFeeRate: Number(event.target.value) })} placeholder="交易手续费率" />
            <input type="number" step="0.0001" value={marketDraft.platformShippingRate} onChange={(event) => setMarketDraft({ ...marketDraft, platformShippingRate: Number(event.target.value) })} placeholder="活动费率" />
            <input type="number" step="0.0001" value={marketDraft.influencerRate} onChange={(event) => setMarketDraft({ ...marketDraft, influencerRate: Number(event.target.value) })} placeholder="达人佣金费率" />
            <input type="number" step="0.0001" value={marketDraft.taxRate} onChange={(event) => setMarketDraft({ ...marketDraft, taxRate: Number(event.target.value) })} placeholder="税率" />
            <input type="number" step="0.01" value={marketDraft.fixedAdjustment} onChange={(event) => setMarketDraft({ ...marketDraft, fixedAdjustment: Number(event.target.value) })} placeholder="固定扣减" />
            <input type="number" step="0.01" value={marketDraft.promotionFeeCap} onChange={(event) => setMarketDraft({ ...marketDraft, promotionFeeCap: Number(event.target.value) })} placeholder="活动费上限" />
            <select value={marketDraft.shippingStrategy} onChange={(event) => setMarketDraft({ ...marketDraft, shippingStrategy: event.target.value as Market["shippingStrategy"] })}>
              <option value="rounded_weight_lookup">向上取整查档</option>
              <option value="exact_weight_lookup">精确重量查档</option>
              <option value="taiwan_ifs">台湾阶梯公式</option>
            </select>
          </div>
          <textarea value={marketDraft.notes} onChange={(event) => setMarketDraft({ ...marketDraft, notes: event.target.value })} placeholder="站点差异说明，如马来西亚固定扣减 0.54、越南固定扣减 3000 等" />
          <div className="actions">
            <button onClick={submitMarket}>{editingMarketId ? "更新站点" : "新增站点"}</button>
            <button className="ghost" onClick={importWorkbookPreset}>站点模板</button>
            <button className="ghost" onClick={importWorkbookFullDataset}>真实数据</button>
            <button className="ghost" onClick={() => { setMarketDraft(createEmptyMarket()); setEditingMarketId(null); }}>清空</button>
          </div>
          <div className="table-shell">
            <table>
              <thead><tr><th>代码</th><th>站点</th><th>币种</th><th>汇率</th><th>固定扣减</th><th>操作</th></tr></thead>
              <tbody>
                {workspace.markets.map((market) => (
                  <tr key={market.id}>
                    <td>{market.code}</td>
                    <td>{market.name}</td>
                    <td>{market.currency}</td>
                    <td>{market.exchangeRate}</td>
                    <td>{market.fixedAdjustment}</td>
                    <td className="table-actions">
                      <button className="ghost" onClick={() => { setMarketDraft(market); setEditingMarketId(market.id); }}>编辑</button>
                      <button className={selectedMarketIds.includes(market.id) ? "selected" : "ghost"} onClick={() => setSelectedMarketIds((current) => current.includes(market.id) ? current.filter((item) => item !== market.id) : [...current, market.id].slice(-2))}>对比</button>
                      <button className="danger" onClick={() => patchWorkspace((current) => ({
                        ...current,
                        markets: current.markets.filter((item) => item.id !== market.id),
                        shippingRates: current.shippingRates.filter((item) => item.marketId !== market.id),
                        listings: current.listings.filter((item) => item.marketId !== market.id),
                      }))}>删除</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="grid two-columns balanced-grid">
        <div className="card">
          <div className="section-title">
            <div>
              <h2>物流价卡</h2>
              <span>按站点过滤和维护重量区间</span>
            </div>
            <select className="section-select" value={shippingMarketFilter} onChange={(event) => setShippingMarketFilter(event.target.value)}>
              <option value="all">全部站点</option>
              {workspace.markets.map((market) => <option value={market.id} key={market.id}>{market.name}</option>)}
            </select>
          </div>
          <div className="form-grid shipping-grid">
            <select value={shippingRateDraft.marketId} onChange={(event) => setShippingRateDraft({ ...shippingRateDraft, marketId: event.target.value })}>
              <option value="">选择站点</option>
              {workspace.markets.map((market) => <option value={market.id} key={market.id}>{market.name}</option>)}
            </select>
            <input type="number" value={shippingRateDraft.minWeightGrams} onChange={(event) => setShippingRateDraft({ ...shippingRateDraft, minWeightGrams: Number(event.target.value) })} placeholder="最小重量" />
            <input type="number" value={shippingRateDraft.maxWeightGrams} onChange={(event) => setShippingRateDraft({ ...shippingRateDraft, maxWeightGrams: Number(event.target.value) })} placeholder="最大重量" />
            <input type="number" step="0.01" value={shippingRateDraft.feeLocal} onChange={(event) => setShippingRateDraft({ ...shippingRateDraft, feeLocal: Number(event.target.value) })} placeholder="物流费" />
          </div>
          <div className="actions">
            <button onClick={submitShippingRate}>{editingShippingRateId ? "更新物流档位" : "新增物流档位"}</button>
            <button className="ghost" onClick={() => { setShippingRateDraft(createEmptyShippingRate(shippingRateDraft.marketId)); setEditingShippingRateId(null); }}>清空</button>
          </div>
          <div className="table-shell tall-table">
            <table>
              <thead><tr><th>站点</th><th>区间</th><th>费用</th><th>操作</th></tr></thead>
              <tbody>
                {filteredShippingRates.map((rate) => (
                  <tr key={rate.id}>
                    <td>{marketMap.get(rate.marketId)?.name ?? "未匹配站点"}</td>
                    <td>{rate.minWeightGrams}g - {rate.maxWeightGrams}g</td>
                    <td>{rate.feeLocal.toFixed(2)}</td>
                    <td className="table-actions">
                      <button className="ghost" onClick={() => { setShippingRateDraft(rate); setEditingShippingRateId(rate.id); }}>编辑</button>
                      <button className="danger" onClick={() => patchWorkspace((current) => ({ ...current, shippingRates: current.shippingRates.filter((item) => item.id !== rate.id) }))}>删除</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="section-title stacked-mobile">
            <div>
              <h2>上架记录</h2>
              <span>支持按站点过滤与关键词搜索</span>
            </div>
            <div className="toolbar-inline">
              <select className="section-select" value={listingMarketFilter} onChange={(event) => setListingMarketFilter(event.target.value)}>
                <option value="all">全部站点</option>
                {workspace.markets.map((market) => <option value={market.id} key={market.id}>{market.name}</option>)}
              </select>
              <input className="section-search" value={listingQuery} onChange={(event) => setListingQuery(event.target.value)} placeholder="搜索 SKU / 名称 / 站点" />
            </div>
          </div>
          <div className="form-grid listing-grid">
            <select value={listingDraft.productId} onChange={(event) => setListingDraft({ ...listingDraft, productId: event.target.value })}>
              <option value="">选择商品</option>
              {workspace.products.map((product) => <option value={product.id} key={product.id}>{product.sku} / {product.name}</option>)}
            </select>
            <select value={listingDraft.marketId} onChange={(event) => setListingDraft({ ...listingDraft, marketId: event.target.value })}>
              <option value="">选择站点</option>
              {workspace.markets.map((market) => <option value={market.id} key={market.id}>{market.name}</option>)}
            </select>
            <input type="number" step="0.01" value={listingDraft.localPrice} onChange={(event) => setListingDraft({ ...listingDraft, localPrice: Number(event.target.value) })} placeholder="当地售价" />
            <label className="checkbox-field"><input type="checkbox" checked={listingDraft.isActive} onChange={(event) => setListingDraft({ ...listingDraft, isActive: event.target.checked })} />启用</label>
          </div>
          <div className="actions">
            <button onClick={submitListing}>{editingListingId ? "更新上架记录" : "新增上架记录"}</button>
            <button className="ghost" onClick={() => { setListingDraft(createEmptyListing()); setEditingListingId(null); }}>清空</button>
          </div>
          <div className="table-shell tall-table">
            <table>
              <thead><tr><th>商品</th><th>站点</th><th>售价</th><th>状态</th><th>操作</th></tr></thead>
              <tbody>
                {filteredListings.map((listing) => (
                  <tr key={listing.id}>
                    <td>{productMap.get(listing.productId)?.sku ?? "未知商品"}</td>
                    <td>{marketMap.get(listing.marketId)?.name ?? "未知站点"}</td>
                    <td>{listing.localPrice.toFixed(2)}</td>
                    <td>{listing.isActive ? "启用" : "停用"}</td>
                    <td className="table-actions">
                      <button className="ghost" onClick={() => { setListingDraft(listing); setEditingListingId(listing.id); }}>编辑</button>
                      <button className="danger" onClick={() => patchWorkspace((current) => ({ ...current, listings: current.listings.filter((item) => item.id !== listing.id) }))}>删除</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="grid two-columns balanced-grid">
        <div className="card">
          <div className="section-title">
            <div>
              <h2>经营洞察</h2>
              <span>快速发现风险款与高利润款</span>
            </div>
            <span className="pill">活跃记录 {allPricingRows.length}</span>
          </div>
          <div className="insight-grid">
            <div className="insight-panel">
              <h3>低毛利预警</h3>
              <ul>
                {overallStats.riskyRows.length === 0 ? <li>暂无低毛利商品</li> : overallStats.riskyRows.map((row) => <li key={row.listingId}>{row.sku} · 毛利率 {formatPercent(row.grossMargin)} · 利润 {formatNumber(row.profitRmb)} RMB</li>)}
              </ul>
            </div>
            <div className="insight-panel">
              <h3>对比视图概览</h3>
              <ul>
                {pricingViews.length === 0 ? <li>请选择站点开始对比</li> : pricingViews.map((view) => <li key={view.market.id}>{view.market.name} · {view.rows.length} 款 · 平均毛利 {formatPercent(view.averageMargin)} · 利润 {formatNumber(view.totalProfitRmb)} RMB</li>)}
              </ul>
            </div>
          </div>
        </div>

        <div className="card sync-card">
          <div className="section-title">
            <div>
              <h2>同步与备份</h2>
              <span>本地优先；可手动推送、拉取、导出和重置</span>
            </div>
            <span className={`status-pill ${workspace.sync.lastSyncStatus}`}>{workspace.sync.lastSyncStatus}</span>
          </div>
          <div className="sync-grid expanded-sync-grid">
            <input value={workspace.sync.apiBaseUrl} onChange={(event) => patchWorkspace((current) => ({ ...current, sync: { ...current.sync, apiBaseUrl: event.target.value } }))} placeholder="API 地址" />
            <button onClick={handlePing}>探活</button>
            <button onClick={handlePush}>推送到服务器</button>
            <button onClick={handlePull}>从服务器拉取</button>
            <button className="ghost" onClick={exportWorkspace}>导出本地工作区</button>
            <button className="ghost" onClick={openWorkspaceJsonPicker}>导入工作区 JSON</button>
            <button className="danger" onClick={resetWorkspace}>重置本地工作区</button>
          </div>
          <p className="sync-message">{apiMessage}</p>
          <div className="sync-meta">
            <span>最近状态：{workspace.sync.lastSyncStatus}</span>
            <span>最近同步：{workspace.sync.lastSyncAt ?? "尚未同步"}</span>
            <span>错误信息：{workspace.sync.lastError ?? "无"}</span>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="section-title">
          <div>
            <h2>定价工作台</h2>
            <span>单站点查看或双站点左右对比</span>
          </div>
          <div className="market-switches">
            {workspace.markets.map((market) => {
              const selected = selectedMarketIds.includes(market.id);
              return (
                <button key={market.id} className={selected ? "selected" : "ghost"} onClick={() => setSelectedMarketIds((current) => current.includes(market.id) ? current.filter((item) => item !== market.id) : [...current, market.id].slice(-2))}>
                  {market.name}
                </button>
              );
            })}
          </div>
        </div>
        <div className={`compare-layout ${pricingViews.length > 1 ? "dual" : "single"}`}>
          {pricingViews.length === 0 ? <div className="empty-state">先选择至少一个站点查看计算结果。</div> : null}
          {pricingViews.map((view) => (
            <div className="pricing-panel" key={view.market.id}>
              <div className="panel-header">
                <div>
                  <h3>{view.market.name}</h3>
                  <p>{view.market.currency} / 汇率 {view.market.exchangeRate}</p>
                </div>
                <span>{view.market.notes || "标准公式"}</span>
              </div>
              <div className="table-shell wide-table">
                <table>
                  <thead>
                    <tr>
                      <th>SKU</th><th>税前价</th><th>展示价</th><th>成本</th><th>物流</th><th>佣金</th><th>交易</th><th>活动</th><th>达人</th><th>税额</th><th>利润</th><th>毛利率</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.rows.map((row) => (
                      <tr key={row.listingId}>
                        <td>{row.sku}</td>
                        <td>{row.localPrice.toFixed(2)}</td>
                        <td>{row.displayPrice.toFixed(2)}</td>
                        <td>{row.costLocal.toFixed(2)}</td>
                        <td>{row.shippingFee.toFixed(2)}</td>
                        <td>{row.commissionFee.toFixed(2)}</td>
                        <td>{row.transactionFee.toFixed(2)}</td>
                        <td>{row.promotionFee.toFixed(2)}</td>
                        <td>{row.influencerFee.toFixed(2)}</td>
                        <td>{row.taxFee.toFixed(2)}</td>
                        <td className={row.profitLocal >= 0 ? "profit-positive" : "profit-negative"}>{row.profitLocal.toFixed(2)}</td>
                        <td>{formatPercent(row.grossMargin)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

export default App;
