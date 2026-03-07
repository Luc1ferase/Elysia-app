import type { Listing, Market, Product, ShippingRate, WorkspaceData } from "../types";

function now() {
  return new Date().toISOString();
}

export function createId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

export function createEmptyProduct(): Product {
  const timestamp = now();
  return {
    id: createId("prd"),
    sku: "",
    name: "",
    size: "",
    costRmb: 0,
    amortizedCostRmb: 0,
    weightGrams: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function createEmptyMarket(): Market {
  const timestamp = now();
  return {
    id: createId("mkt"),
    code: "",
    name: "",
    currency: "",
    exchangeRate: 1,
    commissionRate: 0,
    transactionFeeRate: 0,
    platformShippingRate: 0,
    influencerRate: 0,
    taxRate: 0,
    fixedAdjustment: 0,
    promotionFeeCap: 100,
    shippingStrategy: "rounded_weight_lookup",
    notes: "",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function createEmptyShippingRate(marketId = ""): ShippingRate {
  const timestamp = now();
  return {
    id: createId("shr"),
    marketId,
    minWeightGrams: 0,
    maxWeightGrams: 10,
    feeLocal: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function createEmptyListing(): Listing {
  const timestamp = now();
  return {
    id: createId("lst"),
    productId: "",
    marketId: "",
    localPrice: 0,
    isActive: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function createInitialWorkspace(): WorkspaceData {
  return {
    products: [],
    markets: [],
    shippingRates: [],
    listings: [],
    sync: {
      apiBaseUrl: "http://127.0.0.1:3000",
      lastSyncStatus: "idle",
    },
  };
}

