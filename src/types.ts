export interface Product {
  id: string;
  sku: string;
  name: string;
  size: string;
  costRmb: number;
  amortizedCostRmb: number;
  weightGrams: number;
  createdAt: string;
  updatedAt: string;
}

export interface Market {
  id: string;
  code: string;
  name: string;
  currency: string;
  exchangeRate: number;
  commissionRate: number;
  transactionFeeRate: number;
  platformShippingRate: number;
  influencerRate: number;
  taxRate: number;
  fixedAdjustment: number;
  promotionFeeCap: number;
  shippingStrategy: "rounded_weight_lookup" | "exact_weight_lookup";
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface ShippingRate {
  id: string;
  marketId: string;
  minWeightGrams: number;
  maxWeightGrams: number;
  feeLocal: number;
  createdAt: string;
  updatedAt: string;
}

export interface Listing {
  id: string;
  productId: string;
  marketId: string;
  localPrice: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SyncState {
  apiBaseUrl: string;
  lastSyncAt?: string;
  lastSyncStatus: "idle" | "success" | "error";
  lastError?: string;
}

export interface WorkspaceData {
  products: Product[];
  markets: Market[];
  shippingRates: ShippingRate[];
  listings: Listing[];
  sync: SyncState;
}

export interface PricingRow {
  productId: string;
  listingId: string;
  sku: string;
  name: string;
  size: string;
  weightGrams: number;
  localPrice: number;
  costLocal: number;
  shippingFee: number;
  commissionFee: number;
  transactionFee: number;
  promotionFee: number;
  influencerFee: number;
  taxFee: number;
  fixedAdjustment: number;
  profitLocal: number;
  profitRmb: number;
  grossMargin: number;
}

export interface SnapshotPayload {
  products: Product[];
  markets: Market[];
  shippingRates: ShippingRate[];
  listings: Listing[];
}

