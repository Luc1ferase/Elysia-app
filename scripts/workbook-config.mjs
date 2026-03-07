export const marketMeta = {
  "菲律宾Shopee": { code: "PH", currency: "PHP", logisticsKey: "菲律宾", fixedAdjustment: 0, promotionFeeCap: 100, shippingStrategy: "rounded_weight_lookup" },
  "新加坡Shopee": { code: "SG", currency: "SGD", logisticsKey: "新加坡", fixedAdjustment: 0, promotionFeeCap: Number.MAX_SAFE_INTEGER, shippingStrategy: "rounded_weight_lookup" },
  "马来西亚Shopee": { code: "MY", currency: "MYR", logisticsKey: "马来西亚", fixedAdjustment: 0.54, promotionFeeCap: Number.MAX_SAFE_INTEGER, shippingStrategy: "rounded_weight_lookup" },
  "越南Shopee": { code: "VN", currency: "VND", logisticsKey: "越南", fixedAdjustment: 3000, promotionFeeCap: Number.MAX_SAFE_INTEGER, shippingStrategy: "rounded_weight_lookup" },
  "泰国Shopee": { code: "TH", currency: "THB", logisticsKey: "泰国", fixedAdjustment: 0, promotionFeeCap: Number.MAX_SAFE_INTEGER, shippingStrategy: "rounded_weight_lookup" },
  "台湾Shopee": { code: "TW", currency: "TWD", logisticsKey: "台湾地区", fixedAdjustment: 0, promotionFeeCap: Number.MAX_SAFE_INTEGER, shippingStrategy: "taiwan_ifs" },
};

export function marketIdForSheet(sheetName) {
  const meta = marketMeta[sheetName];
  if (!meta) {
    throw new Error(`Unknown market sheet: ${sheetName}`);
  }
  return `preset_mkt_${meta.code.toLowerCase()}`;
}

export function pickFirstKey(source, keywords) {
  return Object.keys(source).find((key) => keywords.some((keyword) => key.includes(keyword)));
}

export function pickNumericValue(source, keywords, fallback = 0) {
  const key = pickFirstKey(source, keywords);
  if (!key) {
    return fallback;
  }
  const value = Number(source[key]);
  return Number.isFinite(value) ? value : fallback;
}

export function pickTextValue(source, keywords, fallback = "") {
  const key = pickFirstKey(source, keywords);
  if (!key) {
    return fallback;
  }
  const value = source[key];
  return typeof value === "string" ? value.trim() : fallback;
}

export function buildSampleProduct(sheetName, sample, timestamp) {
  const meta = marketMeta[sheetName];
  if (!meta) {
    throw new Error(`Unknown market sheet: ${sheetName}`);
  }

  const rawSku = pickTextValue(sample.inputs, ["货号"], `${meta.code}-${sample.row}`);
  const normalizedSku = rawSku && rawSku !== "x" ? rawSku : `${meta.code}-${sample.row}`;

  return {
    id: `sample_prd_${meta.code.toLowerCase()}_${sample.row}`,
    sku: `${normalizedSku}-${sample.row}`,
    name: pickTextValue(sample.inputs, ["产品名字"], `Sample ${meta.code} ${sample.row}`),
    size: pickTextValue(sample.inputs, ["规格"], ""),
    costRmb: pickNumericValue(sample.inputs, ["商品成本 RMB"]),
    amortizedCostRmb: pickNumericValue(sample.inputs, ["摊销成本"]),
    weightGrams: pickNumericValue(sample.inputs, ["实重 g"]),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function buildSampleListing(sheetName, sample, timestamp) {
  const meta = marketMeta[sheetName];
  if (!meta) {
    throw new Error(`Unknown market sheet: ${sheetName}`);
  }

  return {
    id: `sample_lst_${meta.code.toLowerCase()}_${sample.row}`,
    productId: `sample_prd_${meta.code.toLowerCase()}_${sample.row}`,
    marketId: marketIdForSheet(sheetName),
    localPrice: pickNumericValue(sample.inputs, ["本地定价", "税前价"]),
    isActive: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

