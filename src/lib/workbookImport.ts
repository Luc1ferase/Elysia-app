import { read, utils, type WorkBook, type WorkSheet } from "xlsx";
import type { Listing, Market, Product, ShippingRate } from "../types";

const marketMeta = {
  "菲律宾Shopee": { code: "PH", currency: "PHP", logisticsKey: "菲律宾", fixedAdjustment: 0, promotionFeeCap: 100, shippingStrategy: "rounded_weight_lookup" as const },
  "新加坡Shopee": { code: "SG", currency: "SGD", logisticsKey: "新加坡", fixedAdjustment: 0, promotionFeeCap: Number.MAX_SAFE_INTEGER, shippingStrategy: "rounded_weight_lookup" as const },
  "马来西亚Shopee": { code: "MY", currency: "MYR", logisticsKey: "马来西亚", fixedAdjustment: 0.54, promotionFeeCap: Number.MAX_SAFE_INTEGER, shippingStrategy: "rounded_weight_lookup" as const },
  "越南Shopee": { code: "VN", currency: "VND", logisticsKey: "越南", fixedAdjustment: 3000, promotionFeeCap: Number.MAX_SAFE_INTEGER, shippingStrategy: "rounded_weight_lookup" as const },
  "泰国Shopee": { code: "TH", currency: "THB", logisticsKey: "泰国", fixedAdjustment: 0, promotionFeeCap: Number.MAX_SAFE_INTEGER, shippingStrategy: "rounded_weight_lookup" as const },
  "台湾Shopee": { code: "TW", currency: "TWD", logisticsKey: "台湾地区", fixedAdjustment: 0, promotionFeeCap: Number.MAX_SAFE_INTEGER, shippingStrategy: "taiwan_ifs" as const },
};

function clean(value: unknown) {
  if (typeof value === "string") {
    const normalized = value.replace(/\r/g, " ").replace(/\n/g, " ").replace(/\s+/g, " ").trim();
    return normalized || null;
  }
  return value ?? null;
}

function getSheetBounds(ws: WorkSheet) {
  const ref = ws["!ref"] ?? "A1:A1";
  return utils.decode_range(ref);
}

function cellValue(ws: WorkSheet, row: number, col: number) {
  const address = utils.encode_cell({ r: row - 1, c: col - 1 });
  return clean(ws[address]?.v);
}

function hasValue(values: unknown[]) {
  return values.some((value) => value !== null && value !== "");
}

function pickNumericValue(source: Record<string, unknown>, keywords: string[], fallback = 0) {
  const key = Object.keys(source).find((entry) => keywords.some((keyword) => entry.includes(keyword)));
  if (!key) {
    return fallback;
  }
  const value = Number(source[key]);
  return Number.isFinite(value) ? value : fallback;
}

function pickTextValue(source: Record<string, unknown>, keywords: string[], fallback = "") {
  const key = Object.keys(source).find((entry) => keywords.some((keyword) => entry.includes(keyword)));
  if (!key) {
    return fallback;
  }
  return typeof source[key] === "string" ? String(source[key]) : fallback;
}

function stableId(prefix: string, signature: string) {
  let hash = 0;
  for (let index = 0; index < signature.length; index += 1) {
    hash = (hash * 31 + signature.charCodeAt(index)) >>> 0;
  }
  return `${prefix}_${hash.toString(36)}`;
}

function extractMarketSheet(ws: WorkSheet) {
  const bounds = getSheetBounds(ws);
  const settings: Record<string, unknown> = {};
  const notes: string[] = [];

  for (let col = 1; col <= bounds.e.c + 1; col += 1) {
    const key = cellValue(ws, 1, col);
    const value = cellValue(ws, 2, col);
    if (typeof key === "string" && !["相关项目", "可修改", "手动填写", "勿改"].includes(key)) {
      if (value !== null) {
        settings[key] = value;
      } else {
        notes.push(key);
      }
    }
  }

  const headers: string[] = [];
  const selectedColumns: number[] = [];
  for (let col = 1; col <= bounds.e.c + 1; col += 1) {
    const header = cellValue(ws, 4, col);
    if (typeof header === "string") {
      selectedColumns.push(col);
      headers.push(header);
    }
  }

  const records: Array<Record<string, unknown>> = [];
  for (let row = 5; row <= bounds.e.r + 1; row += 1) {
    const rowValues = selectedColumns.map((col) => cellValue(ws, row, col));
    if (!hasValue(rowValues)) {
      continue;
    }
    const record: Record<string, unknown> = { _row: row };
    headers.forEach((header, index) => {
      record[header] = rowValues[index];
    });
    records.push(record);
  }

  return { settings, notes, records };
}

function extractLogisticsSheet(ws: WorkSheet) {
  const bounds = getSheetBounds(ws);
  const markets: Record<string, { columns: string[]; entries: Array<Record<string, unknown>> }> = {};

  for (let col = 1; col <= bounds.e.c + 1; col += 3) {
    const marketName = cellValue(ws, 2, col);
    if (typeof marketName !== "string") {
      continue;
    }
    const columns: string[] = [];
    const selectedColumns: number[] = [];
    for (let offset = 0; offset < 3; offset += 1) {
      const currentCol = col + offset;
      const label = cellValue(ws, 3, currentCol);
      if (typeof label === "string") {
        selectedColumns.push(currentCol);
        columns.push(label);
      }
    }

    const entries: Array<Record<string, unknown>> = [];
    for (let row = 4; row <= bounds.e.r + 1; row += 1) {
      const rowValues = selectedColumns.map((currentCol) => cellValue(ws, row, currentCol));
      if (!hasValue(rowValues)) {
        continue;
      }
      const entry: Record<string, unknown> = { _row: row };
      columns.forEach((header, index) => {
        entry[header] = rowValues[index];
      });
      entries.push(entry);
    }

    markets[marketName] = { columns, entries };
  }

  return { markets };
}

function buildWorkspace(extracted: { sheets: Record<string, ReturnType<typeof extractMarketSheet> | ReturnType<typeof extractLogisticsSheet>> }) {
  const timestamp = new Date().toISOString();
  const markets: Market[] = [];
  const shippingRates: ShippingRate[] = [];
  const products: Product[] = [];
  const listings: Listing[] = [];
  const productIdBySignature = new Map<string, string>();
  const listingKeySet = new Set<string>();
  const logistics = extracted.sheets["物流价卡"] as ReturnType<typeof extractLogisticsSheet>;

  for (const [sheetName, meta] of Object.entries(marketMeta)) {
    const sheet = extracted.sheets[sheetName] as ReturnType<typeof extractMarketSheet>;
    const marketId = `import_mkt_${meta.code.toLowerCase()}`;

    markets.push({
      id: marketId,
      code: meta.code,
      name: sheetName.replace("Shopee", "").trim(),
      currency: meta.currency,
      exchangeRate: pickNumericValue(sheet.settings, ["汇率换算"]),
      commissionRate: pickNumericValue(sheet.settings, ["佣金"]),
      transactionFeeRate: pickNumericValue(sheet.settings, ["手续费"]),
      platformShippingRate: pickNumericValue(sheet.settings, ["活动费率", "平台运费"]),
      influencerRate: pickNumericValue(sheet.settings, ["达人佣金"]),
      taxRate: pickNumericValue(sheet.settings, ["消费税", "增值税", "商品税"]),
      fixedAdjustment: meta.fixedAdjustment,
      promotionFeeCap: meta.promotionFeeCap,
      shippingStrategy: meta.shippingStrategy,
      notes: sheet.notes.join("；"),
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    for (const record of sheet.records) {
      const name = pickTextValue(record, ["产品名字"]);
      const size = pickTextValue(record, ["规格"]);
      const sku = pickTextValue(record, ["货号"]);
      const costRmb = pickNumericValue(record, ["商品成本 RMB"]);
      const amortizedCostRmb = pickNumericValue(record, ["摊销成本"]);
      const weightGrams = pickNumericValue(record, ["实重 g"]);
      const localPrice = pickNumericValue(record, ["本地定价", "税前价"]);
      const row = Number(record._row);

      if (!name || !Number.isFinite(costRmb) || !Number.isFinite(weightGrams) || !Number.isFinite(localPrice) || localPrice <= 0) {
        continue;
      }

      const cleanedSku = sku && sku !== "x" ? sku : "";
      const signature = cleanedSku
        ? `sku:${cleanedSku}|${size}|${costRmb}|${amortizedCostRmb}|${weightGrams}`
        : `fallback:${name}|${size}|${costRmb}|${amortizedCostRmb}|${weightGrams}`;

      let productId = productIdBySignature.get(signature);
      if (!productId) {
        productId = stableId(`prd_${meta.code.toLowerCase()}`, signature);
        productIdBySignature.set(signature, productId);
        products.push({
          id: productId,
          sku: cleanedSku || `${meta.code}-${row}`,
          name,
          size,
          costRmb,
          amortizedCostRmb,
          weightGrams,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      }

      const listingKey = `${productId}:${marketId}`;
      if (listingKeySet.has(listingKey)) {
        continue;
      }
      listingKeySet.add(listingKey);
      listings.push({
        id: `lst_${meta.code.toLowerCase()}_${row}`,
        productId,
        marketId,
        localPrice,
        isActive: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }

    if (meta.shippingStrategy === "taiwan_ifs") {
      continue;
    }

    const logisticsMarket = logistics.markets[meta.logisticsKey];
    if (!logisticsMarket) {
      continue;
    }

    const weightKey = logisticsMarket.columns[0];
    const feeKey = logisticsMarket.columns[1];
    for (const entry of logisticsMarket.entries) {
      const weight = Number(entry[weightKey]);
      const fee = Number(entry[feeKey]);
      if (!Number.isFinite(weight) || !Number.isFinite(fee)) {
        continue;
      }
      shippingRates.push({
        id: `shr_${meta.code.toLowerCase()}_${weight}`,
        marketId,
        minWeightGrams: weight,
        maxWeightGrams: weight,
        feeLocal: fee,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }
  }

  return { markets, shippingRates, products, listings };
}

function extractWorkbook(workbook: WorkBook) {
  const sheets: Record<string, ReturnType<typeof extractMarketSheet> | ReturnType<typeof extractLogisticsSheet>> = {};
  for (const name of workbook.SheetNames) {
    const ws = workbook.Sheets[name];
    if (!ws) {
      continue;
    }
    if (name === "物流价卡") {
      sheets[name] = extractLogisticsSheet(ws);
    } else if (name in marketMeta) {
      sheets[name] = extractMarketSheet(ws);
    }
  }
  return { sheets };
}

export async function importWorkbookFile(file: File) {
  const buffer = await file.arrayBuffer();
  const workbook = read(buffer, { type: "array" });
  const extracted = extractWorkbook(workbook);
  return buildWorkspace(extracted);
}
