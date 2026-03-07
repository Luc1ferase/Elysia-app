import { useEffect, useMemo, useState } from "react";
import "./App.css";
import type { Listing, Market, Product, ShippingRate, WorkspaceData } from "./types";
import { createEmptyListing, createEmptyMarket, createEmptyProduct, createEmptyShippingRate } from "./lib/defaults";
import { loadWorkspace, saveWorkspace } from "./lib/storage";
import { calculatePricingRow } from "./lib/pricing";
import { pingApi, pullSnapshot, pushSnapshot } from "./lib/api";

function now() {
  return new Date().toISOString();
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(2)}%`;
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

  useEffect(() => {
    saveWorkspace(workspace);
  }, [workspace]);

  const marketMap = useMemo(() => new Map(workspace.markets.map((market) => [market.id, market])), [workspace.markets]);
  const productMap = useMemo(() => new Map(workspace.products.map((product) => [product.id, product])), [workspace.products]);

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

        return { market, rows };
      })
      .filter((view): view is NonNullable<typeof view> => Boolean(view));
  }, [marketMap, productMap, selectedMarketIds, workspace.listings, workspace.shippingRates]);

  function patchWorkspace(mutator: (current: WorkspaceData) => WorkspaceData) {
    setWorkspace((current) => mutator(current));
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

  async function importWorkbookPreset() {
    const confirmed = window.confirm("这会用 Excel 模板覆盖当前站点与物流价卡，并清空现有上架记录，是否继续？");
    if (!confirmed) {
      return;
    }

    const workbookPreset = (await import("./data/workbookPreset.json")).default as {
      markets: Market[];
      shippingRates: ShippingRate[];
    };

    setSelectedMarketIds([]);
    setMarketDraft(createEmptyMarket());
    setShippingRateDraft(createEmptyShippingRate());
    setListingDraft(createEmptyListing());
    patchWorkspace((current) => ({
      ...current,
      markets: workbookPreset.markets,
      shippingRates: workbookPreset.shippingRates,
      listings: [],
    }));
  }

  return (
    <main className="app-shell">
      <section className="hero card">
        <div>
          <span className="eyebrow">Pricing Desk</span>
          <h1>跨境电商定价系统</h1>
          <p>桌面端本地优先运行；服务器 API 仅负责同步与远端部署，任一端故障都不阻断另一端工作。</p>
        </div>
        <div className="hero-stats">
          <div><strong>{workspace.products.length}</strong><span>商品</span></div>
          <div><strong>{workspace.markets.length}</strong><span>站点</span></div>
          <div><strong>{workspace.listings.length}</strong><span>上架记录</span></div>
          <div><strong>{workspace.shippingRates.length}</strong><span>物流档位</span></div>
        </div>
      </section>

      <section className="grid two-columns">
        <div className="card">
          <div className="section-title">
            <h2>商品管理</h2>
            <span>维护 SKU、成本、均摊和重量</span>
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
          <table>
            <thead><tr><th>SKU</th><th>名称</th><th>规格</th><th>成本</th><th>重量</th><th>操作</th></tr></thead>
            <tbody>
              {workspace.products.map((product) => (
                <tr key={product.id}>
                  <td>{product.sku}</td>
                  <td>{product.name}</td>
                  <td>{product.size}</td>
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

        <div className="card">
          <div className="section-title">
            <h2>站点配置</h2>
            <span>维护汇率、费率、固定扣减与说明</span>
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
            <button className="ghost" onClick={importWorkbookPreset}>导入 Excel 站点模板</button>
            <button className="ghost" onClick={() => { setMarketDraft(createEmptyMarket()); setEditingMarketId(null); }}>清空</button>
          </div>
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
      </section>

      <section className="grid two-columns">
        <div className="card">
          <div className="section-title">
            <h2>物流价卡</h2>
            <span>每个站点独立维护重量区间和物流费</span>
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
          <table>
            <thead><tr><th>站点</th><th>区间</th><th>费用</th><th>操作</th></tr></thead>
            <tbody>
              {workspace.shippingRates.map((rate) => (
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

        <div className="card">
          <div className="section-title">
            <h2>上架记录</h2>
            <span>为商品分配站点与本地售价</span>
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
          <table>
            <thead><tr><th>商品</th><th>站点</th><th>售价</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>
              {workspace.listings.map((listing) => (
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
      </section>

      <section className="card">
        <div className="section-title">
          <h2>定价工作台</h2>
          <span>单站点查看或双站点左右对比</span>
        </div>
        <div className="market-switches">
          {workspace.markets.map((market) => {
            const selected = selectedMarketIds.includes(market.id);
            return (
              <button
                key={market.id}
                className={selected ? "selected" : "ghost"}
                onClick={() => setSelectedMarketIds((current) => {
                  if (current.includes(market.id)) {
                    return current.filter((item) => item !== market.id);
                  }
                  return [...current, market.id].slice(-2);
                })}
              >
                {market.name}
              </button>
            );
          })}
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
          ))}
        </div>
      </section>

      <section className="card sync-card">
        <div className="section-title">
          <h2>同步中心</h2>
          <span>本地优先；仅在你主动操作时与服务器交互</span>
        </div>
        <div className="sync-grid">
          <input value={workspace.sync.apiBaseUrl} onChange={(event) => patchWorkspace((current) => ({ ...current, sync: { ...current.sync, apiBaseUrl: event.target.value } }))} placeholder="API 地址" />
          <button onClick={handlePing}>探活</button>
          <button onClick={handlePush}>推送到服务器</button>
          <button onClick={handlePull}>从服务器拉取</button>
        </div>
        <p className="sync-message">{apiMessage}</p>
        <div className="sync-meta">
          <span>最近状态：{workspace.sync.lastSyncStatus}</span>
          <span>最近同步：{workspace.sync.lastSyncAt ?? "尚未同步"}</span>
          <span>错误信息：{workspace.sync.lastError ?? "无"}</span>
        </div>
      </section>
    </main>
  );
}

export default App;
