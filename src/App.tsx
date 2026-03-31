import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import type { Listing, Market, Product, ShippingRate, WorkspaceData } from "./types";
import { createEmptyListing, createEmptyMarket, createEmptyProduct, createInitialWorkspace } from "./lib/defaults";
import { hydrateWorkspace, loadWorkspace, saveWorkspace } from "./lib/storage";
import { calculatePricingRow, resolveShippingFeeForWeight } from "./lib/pricing";
import { pingApi, pullSnapshot, pushSnapshot } from "./lib/api";

type TabKey = "overview" | "products" | "logistics" | "listings" | "pricing" | "markets" | "sync";
type ThemeMode = "dark" | "light";
type ProductSortField = "sku" | "name" | "cost" | "weight";

const THEME_STORAGE_KEY = "pricing-desk-theme-v1";

const tabs: Array<{ key: TabKey; label: string; description: string }> = [
  { key: "overview", label: "总览", description: "业务概况与导入入口" },
  { key: "products", label: "商品", description: "商品基础信息管理" },
  { key: "logistics", label: "物流", description: "物流价卡与运费试算" },
  { key: "listings", label: "上架记录", description: "商品上架与定价录入" },
  { key: "pricing", label: "定价", description: "站点对比与利润计算" },
  { key: "markets", label: "站点配置", description: "站点费率与汇率配置" },
  { key: "sync", label: "同步", description: "服务器同步与本地备份" },
];

const naturalTextCollator = new Intl.Collator("zh-CN", {
  numeric: true,
  sensitivity: "base",
});

function now() {
  return new Date().toISOString();
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(2)}%`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value);
}

function loadThemeMode(): ThemeMode {
  if (typeof window === "undefined") {
    return "dark";
  }
  return window.localStorage.getItem(THEME_STORAGE_KEY) === "light" ? "light" : "dark";
}

function sampleShippingRates(rates: ShippingRate[]) {
  if (rates.length <= 8) {
    return rates;
  }
  const indexes = [0, 1, 2, Math.floor((rates.length - 1) * 0.25), Math.floor((rates.length - 1) * 0.5), Math.floor((rates.length - 1) * 0.75), rates.length - 2, rates.length - 1];
  const uniqueIndexes = [...new Set(indexes)].filter((index) => index >= 0 && index < rates.length).sort((left, right) => left - right);
  return uniqueIndexes.map((index) => rates[index]);
}

function detectDominantWeightStep(rates: ShippingRate[]) {
  const stepCounts = new Map<number, number>();
  for (let index = 1; index < rates.length; index += 1) {
    const step = rates[index].maxWeightGrams - rates[index - 1].maxWeightGrams;
    if (step > 0) {
      stepCounts.set(step, (stepCounts.get(step) ?? 0) + 1);
    }
  }
  let dominantStep: number | null = null;
  let highestCount = 0;
  for (const [step, count] of stepCounts.entries()) {
    if (count > highestCount) {
      dominantStep = step;
      highestCount = count;
    }
  }
  return highestCount >= 2 ? dominantStep : null;
}

function describeShippingStrategy(strategy: Market["shippingStrategy"]) {
  switch (strategy) {
    case "exact_weight_lookup":
      return "按实际重量命中档位";
    case "taiwan_ifs":
      return "按台湾阶梯公式自动计算";
    default:
      return "按 10g 向上取整查档";
  }
}

function formatShippingBandLabel(market: Market, rate: ShippingRate, orderedRates: ShippingRate[]) {
  const currentIndex = orderedRates.findIndex((item) => item.id === rate.id);
  const previousRate = currentIndex > 0 ? orderedRates[currentIndex - 1] : null;

  if (market.shippingStrategy === "exact_weight_lookup") {
    return `${rate.maxWeightGrams}g 档`;
  }
  if (rate.minWeightGrams === rate.maxWeightGrams) {
    if (!previousRate) {
      return `≤ ${rate.maxWeightGrams}g`;
    }
    return `${previousRate.maxWeightGrams + 1}-${rate.maxWeightGrams}g`;
  }
  if (rate.minWeightGrams <= 0) {
    return `≤ ${rate.maxWeightGrams}g`;
  }
  return `${rate.minWeightGrams}-${rate.maxWeightGrams}g`;
}

function resolveListingSku(listing: Listing, product: Product) {
  if (listing.marketSku?.trim()) {
    return listing.marketSku.trim();
  }
  const fallbackMatch = /^db_lst_([a-z]+)_(\d+)$/i.exec(listing.id);
  if (fallbackMatch) {
    return `${fallbackMatch[1].toUpperCase()}-${fallbackMatch[2]}`;
  }
  return product.sku;
}

function formatDraftNumber(value: number, preserveZero = false) {
  if (!Number.isFinite(value)) {
    return "";
  }
  if (!preserveZero && value === 0) {
    return "";
  }
  return value;
}

function parseDraftNumber(value: string) {
  if (!value.trim()) {
    return 0;
  }
  return Number(value);
}

function nextSortDirection(currentField: ProductSortField, targetField: ProductSortField, currentDirection: "asc" | "desc") {
  if (currentField !== targetField) {
    return "asc";
  }
  return currentDirection === "asc" ? "desc" : "asc";
}

function App() {
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [workspace, setWorkspace] = useState<WorkspaceData>(() => loadWorkspace());
  const [productDraft, setProductDraft] = useState<Product>(createEmptyProduct());
  const [marketDraft, setMarketDraft] = useState<Market>(createEmptyMarket());
  const [listingDraft, setListingDraft] = useState<Listing>(createEmptyListing());
  const [selectedMarketIds, setSelectedMarketIds] = useState<string[]>([]);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [editingMarketId, setEditingMarketId] = useState<string | null>(null);
  const [editingListingId, setEditingListingId] = useState<string | null>(null);
  const [apiMessage, setApiMessage] = useState("尚未连接服务器");
  const [productQuery, setProductQuery] = useState("");
  const [productSortField, setProductSortField] = useState<ProductSortField>("sku");
  const [productSortDirection, setProductSortDirection] = useState<"asc" | "desc">("asc");
  const [shippingMarketFilter, setShippingMarketFilter] = useState<string>("all");
  const [listingMarketFilter, setListingMarketFilter] = useState<string>("all");
  const [selectedProductMarketId, setSelectedProductMarketId] = useState("");
  const [showProductSearch, setShowProductSearch] = useState(false);
  const [expandedProductGroups, setExpandedProductGroups] = useState<Set<string>>(new Set());
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => loadThemeMode());
  const [shippingQuoteWeightGrams, setShippingQuoteWeightGrams] = useState(500);
  const [listingProductQuery, setListingProductQuery] = useState("");
  const [showListingProductOptions, setShowListingProductOptions] = useState(false);
  const workspaceJsonInputRef = useRef<HTMLInputElement | null>(null);
  const hasHydratedWorkspace = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void hydrateWorkspace()
      .then((storedWorkspace) => {
        if (cancelled) {
          return;
        }
        hasHydratedWorkspace.current = true;
        setSelectedMarketIds(storedWorkspace.markets.slice(0, 2).map((market) => market.id));
        setWorkspace(storedWorkspace);
      })
      .catch(() => {
        hasHydratedWorkspace.current = true;
        setApiMessage("本地工作区加载失败，已使用空白工作区");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hasHydratedWorkspace.current) {
      return;
    }
    void saveWorkspace(workspace);
  }, [workspace]);

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
  }, [themeMode]);

  useEffect(() => {
    if (!workspace.markets.length) {
      setSelectedProductMarketId("");
      return;
    }
    setSelectedProductMarketId((current) => current && workspace.markets.some((market) => market.id === current) ? current : workspace.markets[0]?.id ?? "");
  }, [workspace.markets]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (workspace.sync.apiBaseUrl && workspace.products.length > 0) {
        handlePush().catch(err => console.error('自动推送失败:', err));
      }
    }, 10 * 60 * 1000);
    return () => clearInterval(interval);
  }, [workspace]);

  const marketMap = useMemo(() => new Map(workspace.markets.map((market) => [market.id, market])), [workspace.markets]);
  const productMap = useMemo(() => new Map(workspace.products.map((product) => [product.id, product])), [workspace.products]);

  const listingsByMarket = useMemo(() => {
    const grouped = new Map<string, Listing[]>();
    for (const listing of workspace.listings) {
      const list = grouped.get(listing.marketId);
      if (list) {
        list.push(listing);
      } else {
        grouped.set(listing.marketId, [listing]);
      }
    }
    return grouped;
  }, [workspace.listings]);

  const shippingRatesByMarket = useMemo(() => {
    const grouped = new Map<string, ShippingRate[]>();
    for (const rate of workspace.shippingRates) {
      const list = grouped.get(rate.marketId);
      if (list) {
        list.push(rate);
      } else {
        grouped.set(rate.marketId, [rate]);
      }
    }
    return grouped;
  }, [workspace.shippingRates]);

  const activeListingsByMarket = useMemo(() => {
    const grouped = new Map<string, Listing[]>();
    for (const listing of workspace.listings) {
      if (!listing.isActive) continue;
      const list = grouped.get(listing.marketId);
      if (list) {
        list.push(listing);
      } else {
        grouped.set(listing.marketId, [listing]);
      }
    }
    return grouped;
  }, [workspace.listings]);

  const allPricingRows = useMemo(() => {
    return workspace.listings
      .filter((listing) => listing.isActive)
      .map((listing) => {
        const product = productMap.get(listing.productId);
        const market = marketMap.get(listing.marketId);
        if (!product || !market) return null;
        return calculatePricingRow({ product, market, listing, shippingRates: shippingRatesByMarket.get(listing.marketId) ?? [] });
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row));
  }, [marketMap, productMap, shippingRatesByMarket, workspace.listings]);

  const overallStats = useMemo(() => {
    const totalProfitRmb = allPricingRows.reduce((sum, row) => sum + row.profitRmb, 0);
    const averageMargin = allPricingRows.length ? allPricingRows.reduce((sum, row) => sum + row.grossMargin, 0) / allPricingRows.length : 0;
    const profitableCount = allPricingRows.filter((row) => row.profitRmb >= 0).length;
    const bestRow = [...allPricingRows].sort((left, right) => right.profitRmb - left.profitRmb)[0];
    const riskyRows = [...allPricingRows].filter((row) => row.grossMargin < 0.2).sort((left, right) => left.grossMargin - right.grossMargin).slice(0, 5);
    return { totalProfitRmb, averageMargin, profitableCount, bestRow, riskyRows };
  }, [allPricingRows]);

  const pricingViews = useMemo(() => {
    return selectedMarketIds
      .map((marketId) => {
        const market = marketMap.get(marketId);
        if (!market) return null;
        const rows = (activeListingsByMarket.get(marketId) ?? [])
          .map((listing) => {
            const product = productMap.get(listing.productId);
            if (!product) return null;
            return calculatePricingRow({ product, market, listing, shippingRates: shippingRatesByMarket.get(marketId) ?? [] });
          })
          .filter((row): row is NonNullable<typeof row> => Boolean(row));
        const totalProfitRmb = rows.reduce((sum, row) => sum + row.profitRmb, 0);
        const averageMargin = rows.length ? rows.reduce((sum, row) => sum + row.grossMargin, 0) / rows.length : 0;
        return { market, rows, totalProfitRmb, averageMargin };
      })
      .filter((view): view is NonNullable<typeof view> => Boolean(view));
  }, [activeListingsByMarket, marketMap, productMap, selectedMarketIds, shippingRatesByMarket]);

  const allMarketStats = useMemo(() => {
    return workspace.markets
      .map((market) => {
        const rows = (activeListingsByMarket.get(market.id) ?? [])
          .map((listing) => {
            const product = productMap.get(listing.productId);
            if (!product) return null;
            return calculatePricingRow({ product, market, listing, shippingRates: shippingRatesByMarket.get(market.id) ?? [] });
          })
          .filter((row): row is NonNullable<typeof row> => Boolean(row));
        if (rows.length === 0) return null;
        const totalProfitRmb = rows.reduce((sum, row) => sum + row.profitRmb, 0);
        const averageMargin = rows.reduce((sum, row) => sum + row.grossMargin, 0) / rows.length;
        return { market, rows, totalProfitRmb, averageMargin };
      })
      .filter((stat): stat is NonNullable<typeof stat> => Boolean(stat));
  }, [workspace.markets, activeListingsByMarket, productMap, shippingRatesByMarket]);

  const chartData = useMemo(() => {
    const maxProfit = Math.max(...allMarketStats.map(v => Math.abs(v.totalProfitRmb)), 1);
    const topProducts = [...workspace.products].sort((a, b) => b.costRmb - a.costRmb).slice(0, 10);
    const maxCost = topProducts.length > 0 ? topProducts[0].costRmb : 1;
    return { maxProfit, topProducts, maxCost };
  }, [allMarketStats, workspace.products]);

  const currentProductMarket = useMemo(() => marketMap.get(selectedProductMarketId) ?? null, [marketMap, selectedProductMarketId]);

  const filteredProducts = useMemo(() => {
    if (!selectedProductMarketId) {
      return [] as Array<{ product: Product; listing: Listing; displaySku: string }>;
    }
    const keyword = productQuery.trim().toLowerCase();
    const rows = (listingsByMarket.get(selectedProductMarketId) ?? [])
      .map((listing) => {
        const product = productMap.get(listing.productId);
        if (!product) return null;
        return { product, listing, displaySku: resolveListingSku(listing, product) };
      })
      .filter((row): row is { product: Product; listing: Listing; displaySku: string } => Boolean(row));

    const searched = keyword ? rows.filter(({ product, displaySku }) => [displaySku, product.name, product.size].join(" ").toLowerCase().includes(keyword)) : rows;

    return [...searched].sort((left, right) => {
      const direction = productSortDirection === "asc" ? 1 : -1;
      if (productSortField === "cost") return (left.product.costRmb - right.product.costRmb) * direction;
      if (productSortField === "weight") return (left.product.weightGrams - right.product.weightGrams) * direction;
      const leftValue = productSortField === "name" ? left.product.name : left.displaySku;
      const rightValue = productSortField === "name" ? right.product.name : right.displaySku;
      return naturalTextCollator.compare(leftValue, rightValue) * direction;
    });
  }, [listingsByMarket, productMap, productQuery, productSortDirection, productSortField, selectedProductMarketId]);

  const groupedProducts = useMemo(() => {
    const groups = new Map<string, Array<{ product: Product; listing: Listing; displaySku: string }>>();
    for (const item of filteredProducts) {
      const baseSku = item.product.size && item.product.sku.endsWith(`-${item.product.size}`)
        ? item.product.sku.slice(0, -item.product.size.length - 1)
        : item.displaySku;
      const group = groups.get(baseSku) || [];
      group.push(item);
      groups.set(baseSku, group);
    }
    return groups;
  }, [filteredProducts]);

  const filteredShippingRates = useMemo(() => {
    if (shippingMarketFilter === "all") return workspace.shippingRates;
    return workspace.shippingRates.filter((rate) => rate.marketId === shippingMarketFilter);
  }, [shippingMarketFilter, workspace.shippingRates]);

  const detailedShippingRates = useMemo(() => {
    return [...filteredShippingRates].sort((left, right) => {
      if (left.marketId !== right.marketId) {
        return (marketMap.get(left.marketId)?.name ?? "").localeCompare(marketMap.get(right.marketId)?.name ?? "", "zh-CN");
      }
      return left.maxWeightGrams - right.maxWeightGrams;
    });
  }, [filteredShippingRates, marketMap]);

  const shippingPreviewMarkets = useMemo(() => shippingMarketFilter === "all" ? workspace.markets : workspace.markets.filter((market) => market.id === shippingMarketFilter), [shippingMarketFilter, workspace.markets]);

  const shippingPreviewCards = useMemo(() => {
    return shippingPreviewMarkets.map((market) => {
      const rates = [...(shippingRatesByMarket.get(market.id) ?? [])].sort((left, right) => left.maxWeightGrams - right.maxWeightGrams);
      return { market, rates, sampleRates: sampleShippingRates(rates), dominantStep: detectDominantWeightStep(rates) };
    });
  }, [shippingPreviewMarkets, shippingRatesByMarket]);

  const listingProductOptions = useMemo(() => {
    const keyword = listingProductQuery.trim().toLowerCase();
    return workspace.products
      .map((product) => {
        const marketListing = listingDraft.marketId ? (listingsByMarket.get(listingDraft.marketId) ?? []).find((item) => item.productId === product.id) ?? null : null;
        const displaySku = marketListing ? resolveListingSku(marketListing, product) : product.sku;
        return { product, displaySku, label: `${displaySku} / ${product.name}` };
      })
      .filter(({ product, displaySku }) => !keyword || [displaySku, product.name, product.size].join(" ").toLowerCase().includes(keyword))
      .sort((left, right) => naturalTextCollator.compare(left.displaySku, right.displaySku))
      .slice(0, 20);
  }, [listingDraft.marketId, listingProductQuery, listingsByMarket, workspace.products]);

  useEffect(() => {
    const product = productMap.get(listingDraft.productId);
    if (!product) {
      setListingProductQuery("");
      return;
    }
    const marketListing = listingDraft.marketId ? (listingsByMarket.get(listingDraft.marketId) ?? []).find((item) => item.productId === product.id) ?? null : null;
    const displaySku = marketListing ? resolveListingSku(marketListing, product) : product.sku;
    setListingProductQuery(`${displaySku} / ${product.name}`);
  }, [listingDraft.marketId, listingDraft.productId, listingsByMarket, productMap]);

  const filteredListings = useMemo(() => {
    return workspace.listings.filter((listing) => listingMarketFilter === "all" || listing.marketId === listingMarketFilter);
  }, [listingMarketFilter, workspace.listings]);

  function patchWorkspace(mutator: (current: WorkspaceData) => WorkspaceData) {
    setWorkspace((current) => mutator(current));
  }

  function resetEditorStates() {
    setProductDraft(createEmptyProduct());
    setMarketDraft(createEmptyMarket());
    setListingDraft(createEmptyListing());
    setShowListingProductOptions(false);
    setEditingProductId(null);
    setEditingMarketId(null);
    setEditingListingId(null);
  }

  function submitProduct() {
    if (!productDraft.sku.trim() || !productDraft.name.trim()) return;
    if (!editingProductId && !selectedProductMarketId) {
      window.alert("请先选择国家/站点");
      return;
    }
    const timestamp = now();
    patchWorkspace((current) => {
      if (editingProductId) {
        return {
          ...current,
          products: current.products.map((item) => item.id === editingProductId ? { ...item, name: productDraft.name, size: productDraft.size, costRmb: productDraft.costRmb, amortizedCostRmb: productDraft.amortizedCostRmb, weightGrams: productDraft.weightGrams, updatedAt: timestamp } : item),
          listings: current.listings.map((item) => item.productId === editingProductId && item.marketId === selectedProductMarketId ? { ...item, marketSku: productDraft.sku.trim() || item.marketSku, updatedAt: timestamp } : item),
        };
      }
      const createdProduct = { ...productDraft, createdAt: timestamp, updatedAt: timestamp };
      const createdListing = { ...createEmptyListing(), productId: createdProduct.id, marketId: selectedProductMarketId, marketSku: productDraft.sku.trim(), localPrice: 0, isActive: true, createdAt: timestamp, updatedAt: timestamp };
      return { ...current, products: [createdProduct, ...current.products], listings: [createdListing, ...current.listings] };
    });
    setProductDraft({ ...createEmptyProduct(), sku: productDraft.sku, name: productDraft.name });
    setEditingProductId(null);
  }

  function submitMarket() {
    if (!marketDraft.code.trim() || !marketDraft.name.trim()) return;
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

  function submitListing() {
    if (!listingDraft.productId || !listingDraft.marketId) {
      window.alert("请先选择具体站点");
      return;
    }
    const exists = workspace.listings.some((item) => item.productId === listingDraft.productId && item.marketId === listingDraft.marketId && item.id !== editingListingId);
    if (exists) {
      window.alert("同一商品在同一站点只能保留一条上架记录");
      return;
    }
    const selectedProduct = productMap.get(listingDraft.productId);
    const resolvedMarketSku = selectedProduct ? (listingDraft.marketSku?.trim() || resolveListingSku(listingDraft, selectedProduct)) : listingDraft.marketSku;
    const timestamp = now();
    patchWorkspace((current) => ({
      ...current,
      listings: editingListingId
        ? current.listings.map((item) => item.id === editingListingId ? { ...listingDraft, marketSku: resolvedMarketSku, updatedAt: timestamp } : item)
        : [{ ...listingDraft, marketSku: resolvedMarketSku, createdAt: timestamp, updatedAt: timestamp }, ...current.listings],
    }));
    setShowListingProductOptions(false);
    setListingDraft(createEmptyListing());
    setEditingListingId(null);
  }

  async function handlePing() {
    try {
      const result = await pingApi(workspace.sync.apiBaseUrl);
      setApiMessage(`服务器在线：${result.timestamp}`);
      patchWorkspace((current) => ({ ...current, sync: { ...current.sync, lastSyncStatus: "success", lastError: undefined } }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      setApiMessage(`服务器不可用：${message}`);
      patchWorkspace((current) => ({ ...current, sync: { ...current.sync, lastSyncStatus: "error", lastError: message } }));
    }
  }

  async function handlePush() {
    try {
      await pushSnapshot(workspace.sync.apiBaseUrl, { products: workspace.products, markets: workspace.markets, shippingRates: workspace.shippingRates, listings: workspace.listings });
      const timestamp = now();
      setApiMessage(`已推送到服务器：${timestamp}`);
      patchWorkspace((current) => ({ ...current, sync: { ...current.sync, lastSyncAt: timestamp, lastSyncStatus: "success", lastError: undefined } }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      setApiMessage(`推送失败：${message}`);
      patchWorkspace((current) => ({ ...current, sync: { ...current.sync, lastSyncStatus: "error", lastError: message } }));
    }
  }

  async function handlePull() {
    try {
      const snapshot = await pullSnapshot(workspace.sync.apiBaseUrl);
      const timestamp = now();
      setSelectedMarketIds(snapshot.markets.slice(0, 2).map((market) => market.id));
      setWorkspace((current) => ({ ...current, products: snapshot.products, markets: snapshot.markets, shippingRates: snapshot.shippingRates, listings: snapshot.listings, sync: { ...current.sync, lastSyncAt: timestamp, lastSyncStatus: "success", lastError: undefined } }));
      setApiMessage(`已从服务器拉取：${timestamp}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      setApiMessage(`拉取失败：${message}`);
      patchWorkspace((current) => ({ ...current, sync: { ...current.sync, lastSyncStatus: "error", lastError: message } }));
    }
  }

  async function importWorkbookPreset() {
    const confirmed = window.confirm("这会用 Excel 模板覆盖当前站点与物流价卡，并清空现有上架记录，是否继续？");
    if (!confirmed) return;
    const workbookPreset = (await import("./data/workbookPreset.json")).default as { markets: Market[]; shippingRates: ShippingRate[] };
    resetEditorStates();
    setSelectedMarketIds(workbookPreset.markets.slice(0, 2).map((market) => market.id));
    setWorkspace((current) => ({ ...current, markets: workbookPreset.markets, shippingRates: workbookPreset.shippingRates, listings: [] }));
    setApiMessage(`已导入 Excel 站点模板：${now()}`);
  }

  function resetWorkspace() {
    const confirmed = window.confirm("这会清空当前本地工作区，仅保留 API 地址配置，是否继续？");
    if (!confirmed) return;
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
      <input ref={workspaceJsonInputRef} className="hidden-file-input" type="file" accept="application/json,.json" onChange={async (event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        try {
          const content = JSON.parse(await file.text()) as WorkspaceData;
          resetEditorStates();
          setSelectedMarketIds(content.markets.slice(0, 2).map((market) => market.id));
          setWorkspace(content);
          setApiMessage(`已导入工作区备份：${file.name}`);
        } catch (error) {
          const message = error instanceof Error ? error.message : "未知错误";
          setApiMessage(`导入工作区失败：${message}`);
        }
      }} />

      <section className="page-toolbar card compact-card merged-toolbar">
        <div className="tabs-bar compact-tabs merged-tabs">
          {tabs.map((tab) => (
            <button key={tab.key} title={tab.description} className={`tab-button compact-tab-button ${activeTab === tab.key ? "active" : "ghost"}`} onClick={() => setActiveTab(tab.key)}>
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
        <div className="page-toolbar-meta">
          <span className="pill">商品 {workspace.products.length}</span>
          <span className="pill">站点 {workspace.markets.length}</span>
          <span className="pill">上架 {workspace.listings.length}</span>
          <span className={`status-pill ${workspace.sync.lastSyncStatus}`}>
            {workspace.sync.lastSyncStatus === 'success' && workspace.sync.lastSyncAt
              ? `上次同步: ${workspace.sync.lastSyncAt.slice(11, 19)}`
              : workspace.sync.lastSyncStatus}
          </span>
          <button className="ghost theme-toggle" onClick={() => setThemeMode((current) => current === "dark" ? "light" : "dark")}>{themeMode === "dark" ? "切到浅色" : "切到深色"}</button>
        </div>
      </section>

      {activeTab === "overview" ? (
        <>
          <section className="overview-grid">
            <div className="card">
              <div className="section-title"><div><h2>快速入口</h2><span>从服务器同步数据</span></div></div>
              <div className="actions hero-actions compact-actions">
                <button onClick={handlePull}>从服务器拉取</button>
                <button onClick={handlePush}>推送到服务器</button>
              </div>
              <p className="hint-text">点击从服务器拉取获取最新数据，或推送到服务器保存本地修改。</p>
            </div>
            <div className="kpi-grid">
              <article className="kpi-card card"><span>总利润（RMB）</span><strong>{formatNumber(overallStats.totalProfitRmb)}</strong><small>基于当前全部启用上架记录</small></article>
              <article className="kpi-card card"><span>平均毛利率</span><strong>{formatPercent(overallStats.averageMargin)}</strong><small>当前本地工作区整体均值</small></article>
              <article className="kpi-card card"><span>盈利商品数</span><strong>{overallStats.profitableCount}</strong><small>利润不低于 0 的记录数</small></article>
              <article className="kpi-card card"><span>最佳单品</span><strong>{overallStats.bestRow?.sku ?? "暂无"}</strong><small>{overallStats.bestRow ? `利润 ${formatNumber(overallStats.bestRow.profitRmb)} RMB` : "导入数据后可见"}</small></article>
            </div>
          </section>
          <section className="grid two-columns balanced-grid">
            <div className="card">
              <div className="section-title"><div><h2>经营洞察</h2><span>快速发现风险款与高利润款</span></div><span className="pill">活跃记录 {allPricingRows.length}</span></div>
              {allMarketStats.length > 0 && (
                <div className="chart-section">
                  <h3>站点利润对比</h3>
                  <div className="bar-chart">
                    {allMarketStats.map((stat) => {
                      const width = (Math.abs(stat.totalProfitRmb) / chartData.maxProfit) * 100;
                      return (
                        <div key={stat.market.id} className="bar-row">
                          <span className="bar-label">{stat.market.name}</span>
                          <div className="bar-container">
                            <div className="bar-fill" style={{ width: `${width}%`, backgroundColor: stat.totalProfitRmb < 0 ? '#ef4444' : '#10b981' }}></div>
                          </div>
                          <span className="bar-value">{formatNumber(stat.totalProfitRmb)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              <div className="insight-grid">
                <div className="insight-panel"><h3>低毛利预警</h3><ul>{overallStats.riskyRows.length === 0 ? <li>暂无低毛利商品</li> : overallStats.riskyRows.slice(0, 5).map((row) => <li key={row.listingId}>{row.sku} · 毛利率 {formatPercent(row.grossMargin)} · 利润 {formatNumber(row.profitRmb)} RMB</li>)}</ul></div>
                <div className="insight-panel"><h3>高利润 TOP5</h3><ul>{allPricingRows.length === 0 ? <li>导入数据后可见</li> : [...allPricingRows].sort((a, b) => b.profitRmb - a.profitRmb).slice(0, 5).map((row) => <li key={row.listingId}>{row.sku} · 毛利率 {formatPercent(row.grossMargin)} · 利润 {formatNumber(row.profitRmb)} RMB</li>)}</ul></div>
              </div>
            </div>
            <div className="card">
              <div className="section-title"><div><h2>当前工作区</h2><span>快速确认本地工作区状态</span></div></div>
              <div className="workspace-summary-grid">
                <div className="summary-block"><span>商品</span><strong>{workspace.products.length}</strong></div>
                <div className="summary-block"><span>站点</span><strong>{workspace.markets.length}</strong></div>
                <div className="summary-block"><span>物流档位</span><strong>{workspace.shippingRates.length}</strong></div>
                <div className="summary-block"><span>上架记录</span><strong>{workspace.listings.length}</strong></div>
              </div>
              {chartData.topProducts.length > 0 && (
                <div className="chart-section">
                  <h3>商品成本 TOP10</h3>
                  <div className="bar-chart">
                    {chartData.topProducts.map((product) => {
                      const width = (product.costRmb / chartData.maxCost) * 100;
                      return (
                        <div key={product.id} className="bar-row">
                          <span className="bar-label">{product.sku || product.name}</span>
                          <div className="bar-container">
                            <div className="bar-fill" style={{ width: `${width}%`, backgroundColor: '#3b82f6' }}></div>
                          </div>
                          <span className="bar-value">{product.costRmb.toFixed(2)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              <p className="sync-message">{apiMessage}</p>
            </div>
          </section>
        </>
      ) : null}

      {activeTab === "products" ? (
        <section className="product-page">
          <div className="card compact-card product-entry-card">
            <div className="product-entry-row">
              <input value={productDraft.sku} onChange={(event) => setProductDraft({ ...productDraft, sku: event.target.value })} placeholder="SKU" />
              <input value={productDraft.name} onChange={(event) => setProductDraft({ ...productDraft, name: event.target.value })} placeholder="商品名" />
              <input value={productDraft.size} onChange={(event) => setProductDraft({ ...productDraft, size: event.target.value })} placeholder="规格" />
              <input type="number" value={formatDraftNumber(productDraft.costRmb)} onChange={(event) => setProductDraft({ ...productDraft, costRmb: parseDraftNumber(event.target.value) })} placeholder="成本 RMB" />
              <input type="number" value={formatDraftNumber(productDraft.amortizedCostRmb)} onChange={(event) => setProductDraft({ ...productDraft, amortizedCostRmb: parseDraftNumber(event.target.value) })} placeholder="均摊成本 RMB" />
              <input type="number" value={formatDraftNumber(productDraft.weightGrams)} onChange={(event) => setProductDraft({ ...productDraft, weightGrams: parseDraftNumber(event.target.value) })} placeholder="重量 g" />
              <button onClick={submitProduct}>{editingProductId ? "更新商品" : `新增到 ${currentProductMarket?.name ?? "当前国家"}`}</button>
              <button className="ghost" onClick={() => { setProductDraft(createEmptyProduct()); setEditingProductId(null); }}>清空</button>
            </div>
          </div>
          <div className="card product-list-card compact-card">
            <div className="product-list-toolbar product-list-header">
              <div className="product-market-switches">
                {workspace.markets.map((market) => <button key={market.id} className={selectedProductMarketId === market.id ? "active slim-action" : "ghost slim-action"} onClick={() => setSelectedProductMarketId(market.id)}>{market.name}</button>)}
                {currentProductMarket ? <span className="pill">佣金 {formatPercent(currentProductMarket.commissionRate)}</span> : null}
              </div>
              <div className="compact-toolbar-row product-filter-toolbar">
                {showProductSearch ? <input className="section-search product-search" value={productQuery} onChange={(event) => setProductQuery(event.target.value)} placeholder="搜索 SKU / 名称 / 规格" /> : null}
                <button className={`ghost ${showProductSearch ? "active" : ""}`} onClick={() => setShowProductSearch((current) => !current)}>{showProductSearch ? "收起搜索" : "搜索"}</button>
              </div>
            </div>
            <div className="table-shell product-table-shell no-top-gap">
              <table className="dense-table product-dense-table">
                <thead><tr>
                  <th><button className={`table-sort-button ${productSortField === "sku" ? "sorted" : ""}`} onClick={() => { setProductSortField("sku"); setProductSortDirection((current) => nextSortDirection(productSortField, "sku", current)); }}>SKU {productSortField === "sku" ? (productSortDirection === "asc" ? "↑" : "↓") : ""}</button></th>
                  <th><button className={`table-sort-button ${productSortField === "name" ? "sorted" : ""}`} onClick={() => { setProductSortField("name"); setProductSortDirection((current) => nextSortDirection(productSortField, "name", current)); }}>名称 {productSortField === "name" ? (productSortDirection === "asc" ? "↑" : "↓") : ""}</button></th>
                  <th>规格</th>
                  <th><button className={`table-sort-button ${productSortField === "cost" ? "sorted" : ""}`} onClick={() => { setProductSortField("cost"); setProductSortDirection((current) => nextSortDirection(productSortField, "cost", current)); }}>成本 {productSortField === "cost" ? (productSortDirection === "asc" ? "↑" : "↓") : ""}</button></th>
                  <th><button className={`table-sort-button ${productSortField === "weight" ? "sorted" : ""}`} onClick={() => { setProductSortField("weight"); setProductSortDirection((current) => nextSortDirection(productSortField, "weight", current)); }}>重量 {productSortField === "weight" ? (productSortDirection === "asc" ? "↑" : "↓") : ""}</button></th>
                  <th>操作</th>
                </tr></thead>
                <tbody>
                  {Array.from(groupedProducts.entries()).flatMap(([baseSku, items]) => {
                    if (items.length === 1) {
                      const { product, listing, displaySku } = items[0];
                      return (
                        <tr key={listing.id}>
                          <td>{displaySku}</td><td>{product.name}</td><td>{product.size || "-"}</td><td>{product.costRmb.toFixed(2)}</td><td>{product.weightGrams}g</td>
                          <td><div className="row-actions no-wrap-actions">
                            <button className="ghost slim-action" onClick={() => { setProductDraft({ ...product, sku: displaySku }); setEditingProductId(product.id); }}>编辑</button>
                            <button className="danger slim-action danger-icon" title={`从 ${currentProductMarket?.name ?? "当前国家"} 删除 ${displaySku}`} onClick={() => patchWorkspace((current) => {
                              const nextListings = current.listings.filter((item) => item.id !== listing.id);
                              const stillReferenced = nextListings.some((item) => item.productId === product.id);
                              return { ...current, listings: nextListings, products: stillReferenced ? current.products : current.products.filter((item) => item.id !== product.id) };
                            })}>删</button>
                          </div></td>
                        </tr>
                      );
                    }
                    const isExpanded = expandedProductGroups.has(baseSku);
                    const firstItem = items[0];
                    const rows = [];
                    rows.push(
                      <tr key={`parent-${baseSku}`} style={{ cursor: 'pointer', fontWeight: 500 }} onClick={() => setExpandedProductGroups(prev => {
                        const next = new Set(prev);
                        if (next.has(baseSku)) next.delete(baseSku); else next.add(baseSku);
                        return next;
                      })}>
                        <td>{baseSku} {isExpanded ? '▼' : '▶'}</td>
                        <td>{firstItem.product.name}</td>
                        <td colSpan={4} style={{ color: '#888' }}>{items.length}个规格</td>
                      </tr>
                    );
                    if (isExpanded) {
                      items.forEach(({ product, listing, displaySku }) => {
                        rows.push(
                          <tr key={listing.id} style={{ backgroundColor: 'var(--color-surface-secondary)' }}>
                            <td style={{ paddingLeft: '2em' }}>{displaySku}</td><td>{product.name}</td><td>{product.size || "-"}</td><td>{product.costRmb.toFixed(2)}</td><td>{product.weightGrams}g</td>
                            <td><div className="row-actions no-wrap-actions">
                              <button className="ghost slim-action" onClick={(e) => { e.stopPropagation(); setProductDraft({ ...product, sku: displaySku }); setEditingProductId(product.id); }}>编辑</button>
                              <button className="danger slim-action danger-icon" title={`从 ${currentProductMarket?.name ?? "当前国家"} 删除 ${displaySku}`} onClick={(e) => { e.stopPropagation(); patchWorkspace((current) => {
                                const nextListings = current.listings.filter((item) => item.id !== listing.id);
                                const stillReferenced = nextListings.some((item) => item.productId === product.id);
                                return { ...current, listings: nextListings, products: stillReferenced ? current.products : current.products.filter((item) => item.id !== product.id) };
                              }); }}>删</button>
                            </div></td>
                          </tr>
                        );
                      });
                    }
                    return rows;
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      ) : null}

      {activeTab === "logistics" ? (
        <section className="card logistics-page-card">
          <div className="section-title"><div><h2>物流价卡</h2><span>按地区查看规律与运费</span></div><select className="section-select" value={shippingMarketFilter} onChange={(event) => setShippingMarketFilter(event.target.value)}><option value="all">全部站点</option>{workspace.markets.map((market) => <option value={market.id} key={market.id}>{market.name}</option>)}</select></div>
          <div className="shipping-overview-grid">
            {shippingPreviewCards.length === 0 ? <div className="empty-state">当前还没有物流价卡数据</div> : shippingPreviewCards.map(({ market, rates, sampleRates, dominantStep }) => {
              const quoteFee = resolveShippingFeeForWeight(market, shippingQuoteWeightGrams, rates);
              return (
                <article className="shipping-summary-card" key={market.id}>
                  <div className="panel-header shipping-card-title"><div><h3>{market.name}</h3></div></div>
                  <div className="shipping-inline-form shipping-quote-simple-row">
                    <input type="number" min="0" value={shippingQuoteWeightGrams} onChange={(event) => setShippingQuoteWeightGrams(Number(event.target.value))} placeholder="输入重量 g" />
                    <div className="shipping-inline-result simple-result"><strong>{formatNumber(quoteFee)} {market.currency}</strong></div>
                  </div>
                  <div className="table-shell shipping-sample-table">
                    <table><thead><tr><th>适用重量</th><th>费用</th></tr></thead><tbody>{sampleRates.map((rate) => <tr key={rate.id}><td>{formatShippingBandLabel(market, rate, rates)}</td><td>{rate.feeLocal.toFixed(2)}</td></tr>)}</tbody></table>
                  </div>
                  <p className="shipping-rule-text">{describeShippingStrategy(market.shippingStrategy)}</p>
                  <div className="shipping-summary-meta">
                    <span className="pill">首档 ≤ {rates[0]?.maxWeightGrams ?? 0}g</span>
                    <span className="pill">末档 ≤ {rates[rates.length - 1]?.maxWeightGrams ?? 0}g</span>
                    {dominantStep ? <span className="pill">常见步长 {dominantStep}g</span> : null}
                  </div>
                </article>
              );
            })}
          </div>
          {shippingMarketFilter === "all" ? <p className="hint-text shipping-hint">当前展示的是各站点摘要；若要查看完整档位，请先选择单一站点。</p> : (
            <details className="shipping-details">
              <summary>展开完整区间明细</summary>
              <div className="table-shell tall-table"><table><thead><tr><th>站点</th><th>适用重量</th><th>费用</th><th>操作</th></tr></thead><tbody>{detailedShippingRates.map((rate) => {
                const market = marketMap.get(rate.marketId);
                const orderedRates = shippingRatesByMarket.get(rate.marketId) ?? [];
                return <tr key={rate.id}><td>{market?.name ?? "未匹配站点"}</td><td>{market ? formatShippingBandLabel(market, rate, orderedRates) : `${rate.minWeightGrams}g - ${rate.maxWeightGrams}g`}</td><td>{rate.feeLocal.toFixed(2)}</td><td className="table-actions"><button className="ghost" onClick={() => window.alert("已按你的要求移除新增行，完整档位仅供查看。")}>查看</button></td></tr>;
              })}</tbody></table></div>
            </details>
          )}
        </section>
      ) : null}

      {activeTab === "listings" ? (
        <section className="card">
          <div className="section-title stacked-mobile"><div><h2>上架记录</h2><span>支持按站点切换与商品模糊选择</span></div></div>
          <div className="listing-entry-row">
            <div className="search-select listing-product-picker" onBlur={() => window.setTimeout(() => setShowListingProductOptions(false), 120)}>
              <input value={listingProductQuery} onFocus={() => setShowListingProductOptions(true)} onChange={(event) => { setListingProductQuery(event.target.value); setShowListingProductOptions(true); setListingDraft((current) => ({ ...current, productId: "", marketSku: "" })); }} placeholder="搜索商品 SKU / 名称" />
              {showListingProductOptions ? <div className="search-select-menu">{listingProductOptions.length === 0 ? <div className="search-select-empty">没有匹配商品</div> : listingProductOptions.map(({ product, displaySku, label }) => <button key={product.id} className="search-select-option" onMouseDown={(event) => { event.preventDefault(); setListingDraft((current) => ({ ...current, productId: product.id, marketSku: displaySku })); setListingProductQuery(label); setShowListingProductOptions(false); }}>{label}</button>)}</div> : null}
            </div>
            <select className="listing-market-inline-select" value={listingMarketFilter} onChange={(event) => {
              const value = event.target.value;
              setListingMarketFilter(value);
              setListingDraft((current) => ({ ...current, marketId: value === "all" ? "" : value }));
            }}>
              <option value="all">全部站点</option>
              {workspace.markets.map((market) => <option value={market.id} key={market.id}>{market.name}</option>)}
            </select>
            <input type="number" step="0.01" value={formatDraftNumber(listingDraft.localPrice)} onChange={(event) => setListingDraft({ ...listingDraft, localPrice: parseDraftNumber(event.target.value) })} placeholder="售价" />
            <label className="checkbox-field compact-checkbox"><input type="checkbox" checked={listingDraft.isActive} onChange={(event) => setListingDraft({ ...listingDraft, isActive: event.target.checked })} />启用</label>
            <button onClick={submitListing}>{editingListingId ? "更新上架记录" : "新增上架记录"}</button>
            <button className="ghost" onClick={() => { setShowListingProductOptions(false); setListingDraft(createEmptyListing()); setEditingListingId(null); }}>清空</button>
          </div>
          <div className="table-shell listing-table-shell no-top-gap">
            <table className="dense-table"><thead><tr><th>商品</th><th>站点</th><th>售价</th><th>状态</th><th>操作</th></tr></thead><tbody>{filteredListings.map((listing) => <tr key={listing.id}><td>{(() => { const product = productMap.get(listing.productId); return product ? `${resolveListingSku(listing, product)} / ${product.name}` : "未知商品"; })()}</td><td>{marketMap.get(listing.marketId)?.name ?? "未知站点"}</td><td>{listing.localPrice.toFixed(2)}</td><td>{listing.isActive ? "启用" : "停用"}</td><td className="table-actions"><button className="ghost" onClick={() => { setListingMarketFilter(listing.marketId); setShowListingProductOptions(false); setListingDraft(listing); setEditingListingId(listing.id); }}>编辑</button><button className="danger" onClick={() => patchWorkspace((current) => ({ ...current, listings: current.listings.filter((item) => item.id !== listing.id) }))}>删除</button></td></tr>)}</tbody></table>
          </div>
        </section>
      ) : null}

      {activeTab === "pricing" ? (
        <section className="pricing-page-layout pricing-full-width">
          <div className="card pricing-workbench-card">
            <div className="section-title"><div><h2>定价工作台</h2><span>单站点查看或双站点左右对比</span></div><div className="market-switches">{workspace.markets.map((market) => { const selected = selectedMarketIds.includes(market.id); return <button key={market.id} className={selected ? "selected" : "ghost"} onClick={() => setSelectedMarketIds((current) => current.includes(market.id) ? current.filter((item) => item !== market.id) : [...current, market.id].slice(-2))}>{market.name}</button>; })}</div></div>
            <div className={`compare-layout ${pricingViews.length > 1 ? "dual" : "single"}`}>
              {pricingViews.length === 0 ? <div className="empty-state">先选择至少一个站点查看计算结果。</div> : null}
              {pricingViews.map((view) => <div className="pricing-panel" key={view.market.id}><div className="panel-header"><div><h3>{view.market.name}</h3><p>{view.market.currency} / 汇率 {view.market.exchangeRate}</p></div><span>{view.market.notes || "标准公式"}</span></div><div className="table-shell wide-table pricing-table-shell"><table><thead><tr><th>SKU</th><th>税前价</th><th>展示价</th><th>成本</th><th>物流</th><th>佣金</th><th>交易</th><th>税额</th><th>利润</th><th>毛利率</th></tr></thead><tbody>{view.rows.map((row) => <tr key={row.listingId}><td>{row.sku}</td><td>{row.localPrice.toFixed(2)}</td><td>{row.displayPrice.toFixed(2)}</td><td>{row.costLocal.toFixed(2)}</td><td>{row.shippingFee.toFixed(2)}</td><td>{row.commissionFee.toFixed(2)}</td><td>{row.transactionFee.toFixed(2)}</td><td>{row.taxFee.toFixed(2)}</td><td className={row.profitLocal >= 0 ? "profit-positive" : "profit-negative"}>{row.profitLocal.toFixed(2)}</td><td>{formatPercent(row.grossMargin)}</td></tr>)}</tbody></table></div></div>)}
            </div>
          </div>
          <div className="card pricing-analysis-card">
            <div className="section-title"><div><h2>定价分析</h2><span>风险款、对比概览与整体盈利</span></div></div>
            <div className="pricing-analysis-grid">
              <div className="insight-panel"><h3>低毛利预警</h3><ul>{overallStats.riskyRows.length === 0 ? <li>暂无低毛利商品</li> : overallStats.riskyRows.map((row) => <li key={row.listingId}>{row.sku} · 毛利率 {formatPercent(row.grossMargin)} · 利润 {formatNumber(row.profitRmb)} RMB</li>)}</ul></div>
              <div className="insight-panel"><h3>对比视图概览</h3><ul>{pricingViews.length === 0 ? <li>请选择站点开始对比</li> : pricingViews.map((view) => <li key={view.market.id}>{view.market.name} · {view.rows.length} 款 · 平均毛利 {formatPercent(view.averageMargin)} · 利润 {formatNumber(view.totalProfitRmb)} RMB</li>)}</ul></div>
            </div>
          </div>
        </section>
      ) : null}

      {activeTab === "markets" ? (
        <section className="market-page-layout">
          <div className="card market-list-card">
            <div className="section-title">
              <div>
                <h2>已有站点</h2>
                <span>先浏览和选择，再在下方新增或编辑</span>
              </div>
              <div className="pill-group">
                <span className="pill">对比位 {selectedMarketIds.length}/2</span>
                <span className="pill">已选 {selectedMarketIds.map((id) => marketMap.get(id)?.name).filter(Boolean).join(" / ") || "无"}</span>
              </div>
            </div>
            <div className="table-shell tall-table market-list-table">
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
                        <button className="danger" onClick={() => patchWorkspace((current) => ({ ...current, markets: current.markets.filter((item) => item.id !== market.id), shippingRates: current.shippingRates.filter((item) => item.marketId !== market.id), listings: current.listings.filter((item) => item.marketId !== market.id) }))}>删除</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card market-editor-card">
            <div className="section-title">
              <div>
                <h2>{editingMarketId ? "编辑站点" : "新增站点"}</h2>
                <span>把字段填写完整，再保存到站点列表</span>
              </div>
            </div>
            <div className="form-grid market-grid market-editor-grid">
              <input value={marketDraft.code} onChange={(event) => setMarketDraft({ ...marketDraft, code: event.target.value })} placeholder="站点代码" />
              <input value={marketDraft.name} onChange={(event) => setMarketDraft({ ...marketDraft, name: event.target.value })} placeholder="站点名称" />
              <input value={marketDraft.currency} onChange={(event) => setMarketDraft({ ...marketDraft, currency: event.target.value })} placeholder="币种" />
              <input type="number" step="0.0001" value={marketDraft.exchangeRate === 1 ? "" : marketDraft.exchangeRate} onChange={(event) => setMarketDraft({ ...marketDraft, exchangeRate: parseDraftNumber(event.target.value) || 1 })} placeholder="汇率" />
              <input type="number" step="0.0001" value={formatDraftNumber(marketDraft.commissionRate)} onChange={(event) => setMarketDraft({ ...marketDraft, commissionRate: parseDraftNumber(event.target.value) })} placeholder="佣金费率" />
              <input type="number" step="0.0001" value={formatDraftNumber(marketDraft.transactionFeeRate)} onChange={(event) => setMarketDraft({ ...marketDraft, transactionFeeRate: parseDraftNumber(event.target.value) })} placeholder="交易手续费率" />
              <input type="number" step="0.0001" value={formatDraftNumber(marketDraft.platformShippingRate)} onChange={(event) => setMarketDraft({ ...marketDraft, platformShippingRate: parseDraftNumber(event.target.value) })} placeholder="活动费率" />
              <input type="number" step="0.0001" value={formatDraftNumber(marketDraft.influencerRate)} onChange={(event) => setMarketDraft({ ...marketDraft, influencerRate: parseDraftNumber(event.target.value) })} placeholder="达人佣金费率" />
              <input type="number" step="0.0001" value={formatDraftNumber(marketDraft.taxRate)} onChange={(event) => setMarketDraft({ ...marketDraft, taxRate: parseDraftNumber(event.target.value) })} placeholder="税率" />
              <input type="number" step="0.01" value={formatDraftNumber(marketDraft.fixedAdjustment)} onChange={(event) => setMarketDraft({ ...marketDraft, fixedAdjustment: parseDraftNumber(event.target.value) })} placeholder="固定扣减" />
              <input type="number" step="0.01" value={marketDraft.promotionFeeCap === 100 ? "" : marketDraft.promotionFeeCap} onChange={(event) => setMarketDraft({ ...marketDraft, promotionFeeCap: parseDraftNumber(event.target.value) || 100 })} placeholder="活动费上限" />
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
              <button className="ghost" onClick={() => { setMarketDraft(createEmptyMarket()); setEditingMarketId(null); }}>清空</button>
            </div>
          </div>
        </section>
      ) : null}

      {activeTab === "sync" ? (
        <section className="sync-page-layout">
          <div className="card sync-card sync-main-card">
            <div className="section-title">
              <div>
                <h2>同步与备份</h2>
                <span>本地优先；可手动推送、拉取、导出和重置</span>
              </div>
              <span className={`status-pill ${workspace.sync.lastSyncStatus}`}>{workspace.sync.lastSyncStatus}</span>
            </div>
            <div className="sync-grid expanded-sync-grid">
              <input value={workspace.sync.apiBaseUrl} onChange={(event) => patchWorkspace((current) => ({ ...current, sync: { ...current.sync, apiBaseUrl: event.target.value } }))} placeholder="API 地址" />
              <button onClick={handlePing}>连通性检查</button>
              <button onClick={handlePull}>从服务器拉取</button>
              <button onClick={handlePush}>推送到服务器</button>
              <button className="ghost" onClick={exportWorkspace}>导出工作区</button>
              <button className="danger" onClick={resetWorkspace}>重置本地</button>
            </div>
            <div className="sync-status-grid">
              <div className="sync-status-item"><span>同步状态</span><strong>{workspace.sync.lastSyncStatus}</strong></div>
              <div className="sync-status-item"><span>最后同步</span><strong>{workspace.sync.lastSyncAt ? workspace.sync.lastSyncAt.slice(0, 19).replace("T", " ") : "未同步"}</strong></div>
              <div className="sync-status-item"><span>API 地址</span><strong>{workspace.sync.apiBaseUrl || "未配置"}</strong></div>
            </div>
            <p className="sync-message">{apiMessage}</p>
          </div>
          <div className="card sync-file-card">
            <div className="section-title">
              <div>
                <h2>工作区文件</h2>
                <span>导入或恢复本地备份 JSON</span>
              </div>
            </div>
            <div className="actions compact-actions-row">
              <button className="ghost" onClick={() => workspaceJsonInputRef.current?.click()}>导入工作区 JSON</button>
              <button className="ghost" onClick={exportWorkspace}>再次导出工作区</button>
            </div>
          </div>
        </section>
      ) : null}
    </main>
  );
}

export default App;
