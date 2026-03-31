import fs from "node:fs";
import path from "node:path";
import { read, utils } from "xlsx";
import { marketMeta, pickNumericValue, pickTextValue } from "./workbook-config.mjs";

const apiBaseUrl = process.env.API_BASE_URL?.replace(/\/$/, "") || "http://127.0.0.1:9800";
const workbookPath = path.resolve(process.cwd(), process.argv[2] || "../V2.xlsx");
const backupPath = path.resolve(process.cwd(), "pricing-workspace-before-excel-import.json");
const timestamp = new Date().toISOString();

function clean(value) {
  if (typeof value === "string") {
    const normalized = value.replace(/\r/g, " ").replace(/\n/g, " ").replace(/\s+/g, " ").trim();
    return normalized || null;
  }
  return value ?? null;
}

function getSheetBounds(ws) {
  const ref = ws["!ref"] ?? "A1:A1";
  return utils.decode_range(ref);
}

function cellValue(ws, row, col) {
  const address = utils.encode_cell({ r: row - 1, c: col - 1 });
  return clean(ws[address]?.v);
}

function directCellValue(ws, ref) {
  return clean(ws[ref]?.v);
}

function hasValue(values) {
  return values.some((value) => value !== null && value !== "");
}

const marketSettingCells = {
  "菲律宾Shopee": { exchangeRate: "D2", commissionRate: "E2", transactionFeeRate: "F2", platformShippingRate: "G2", influencerRate: "H2" },
  "新加坡Shopee": { exchangeRate: "D2", commissionRate: "E2", transactionFeeRate: "F2", platformShippingRate: "G2", influencerRate: "H2", taxRate: "I2" },
  "马来西亚Shopee": { exchangeRate: "D2", commissionRate: "E2", transactionFeeRate: "F2", platformShippingRate: "G2", influencerRate: "H2", taxRate: "I2" },
  "越南Shopee": { exchangeRate: "B2", commissionRate: "C2", transactionFeeRate: "D2", platformShippingRate: "E2", influencerRate: "F2", taxRate: "G2" },
  "泰国Shopee": { exchangeRate: "B2", commissionRate: "C2", transactionFeeRate: "D2", platformShippingRate: "E2", influencerRate: "F2", taxRate: "G2" },
  "台湾Shopee": { exchangeRate: "B2", commissionRate: "C2", transactionFeeRate: "D2", platformShippingRate: "E2", influencerRate: "F2" },
};

function stableId(prefix, signature) {
  let hash = 0;
  for (let index = 0; index < signature.length; index += 1) {
    hash = (hash * 31 + signature.charCodeAt(index)) >>> 0;
  }
  return `${prefix}_${hash.toString(36)}`;
}

function extractMarketSheet(ws, sheetName) {
  const bounds = getSheetBounds(ws);
  const settings = {
    "汇率换算": directCellValue(ws, marketSettingCells[sheetName].exchangeRate),
    "佣金": directCellValue(ws, marketSettingCells[sheetName].commissionRate),
    "手续费": directCellValue(ws, marketSettingCells[sheetName].transactionFeeRate),
    "活动费率": directCellValue(ws, marketSettingCells[sheetName].platformShippingRate),
    "达人佣金": directCellValue(ws, marketSettingCells[sheetName].influencerRate),
    "税率": marketSettingCells[sheetName].taxRate ? directCellValue(ws, marketSettingCells[sheetName].taxRate) : 0,
  };
  const notes = [];

  for (let col = 1; col <= bounds.e.c + 1; col += 1) {
    const key = cellValue(ws, 1, col);
    const value = cellValue(ws, 2, col);
    if (typeof key === "string" && !["相关项目", "可修改", "手动填写", "勿改"].includes(key)) {
      if (value === null) {
        notes.push(key);
      }
    }
  }

  const headers = [];
  const selectedColumns = [];
  for (let col = 1; col <= bounds.e.c + 1; col += 1) {
    const header = cellValue(ws, 4, col);
    if (typeof header === "string") {
      headers.push(header);
      selectedColumns.push(col);
    } else if (col === 3) {
      headers.push("规格");
      selectedColumns.push(col);
    }
  }

  const records = [];
  for (let row = 5; row <= bounds.e.r + 1; row += 1) {
    const rowValues = selectedColumns.map((col) => cellValue(ws, row, col));
    if (!hasValue(rowValues)) {
      continue;
    }
    const record = { _row: row };
    headers.forEach((header, index) => {
      record[header] = rowValues[index];
    });
    records.push(record);
  }

  return { settings, notes, records };
}

function extractLogisticsSheet(ws) {
  const bounds = getSheetBounds(ws);
  const markets = {};
  for (let col = 1; col <= bounds.e.c + 1; col += 3) {
    const marketName = cellValue(ws, 2, col);
    if (typeof marketName !== "string") continue;
    const columns = [];
    const selectedColumns = [];
    for (let offset = 0; offset < 3; offset += 1) {
      const currentCol = col + offset;
      const header = cellValue(ws, 3, currentCol);
      if (typeof header === "string") {
        columns.push(header);
        selectedColumns.push(currentCol);
      }
    }
    const entries = [];
    for (let row = 4; row <= bounds.e.r + 1; row += 1) {
      const rowValues = selectedColumns.map((currentCol) => cellValue(ws, row, currentCol));
      if (!hasValue(rowValues)) continue;
      const entry = { _row: row };
      columns.forEach((header, index) => {
        entry[header] = rowValues[index];
      });
      entries.push(entry);
    }
    markets[marketName] = { columns, entries: entries.slice(0, 20) };
  }
  return { markets };
}

function buildSnapshot() {
  const workbook = read(fs.readFileSync(workbookPath), { type: "buffer" });
  const logisticsSheet = extractLogisticsSheet(workbook.Sheets["物流价卡"]);
  const markets = [];
  const shippingRates = [];
  const products = [];
  const listings = [];
  const productIdBySignature = new Map();
  const listingKeySet = new Set();

  for (const [sheetName, meta] of Object.entries(marketMeta)) {
    const sheet = extractMarketSheet(workbook.Sheets[sheetName], sheetName);
    const marketId = `db_mkt_${meta.code.toLowerCase()}`;

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
      taxRate: pickNumericValue(sheet.settings, ["税率"]),
      fixedAdjustment: meta.fixedAdjustment,
      promotionFeeCap: meta.promotionFeeCap,
      shippingStrategy: meta.shippingStrategy,
      notes: sheet.notes.join("；"),
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    let lastSku = "";
    let lastName = "";
    for (const record of sheet.records) {
      const name = pickTextValue(record, ["产品名字"]) || lastName;
      const size = pickTextValue(record, ["规格"]);
      const sku = pickTextValue(record, ["货号"]) || lastSku;
      const costRmb = pickNumericValue(record, ["商品成本 RMB"]);
      const amortizedCostRmb = pickNumericValue(record, ["摊销成本"]);
      const weightGrams = pickNumericValue(record, ["实重 g"]);
      const localPrice = pickNumericValue(record, ["本地定价", "税前价"]);
      const row = Number(record._row);
      if (!name || !Number.isFinite(costRmb) || !Number.isFinite(weightGrams) || !Number.isFinite(localPrice) || localPrice <= 0) continue;

      if (sku && sku !== "x") lastSku = sku;
      if (name) lastName = name;

      const cleanedSku = sku && sku !== "x" ? sku : "";
      const signature = cleanedSku
        ? `sku:${cleanedSku}|${size}`
        : `fallback:${name}|${size}`;
      let productId = productIdBySignature.get(signature);
      if (!productId) {
        productId = stableId("db_prd", signature);
        productIdBySignature.set(signature, productId);
        const finalSku = cleanedSku
          ? (size ? `${cleanedSku}-${size}` : cleanedSku)
          : `${meta.code}-${row}`;
        products.push({
          id: productId,
          sku: finalSku,
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
      if (listingKeySet.has(listingKey)) continue;
      listingKeySet.add(listingKey);
      listings.push({
        id: `db_lst_${meta.code.toLowerCase()}_${row}`,
        productId,
        marketId,
        marketSku: cleanedSku || `${meta.code}-${row}`,
        localPrice,
        isActive: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }

    if (meta.shippingStrategy === "taiwan_ifs") continue;
    const marketLogistics = logisticsSheet.markets[meta.logisticsKey];
    if (!marketLogistics) continue;
    const weightKey = marketLogistics.columns[0];
    const feeKey = marketLogistics.columns[1];
    for (const entry of marketLogistics.entries) {
      const weight = Number(entry[weightKey]);
      const fee = Number(entry[feeKey]);
      if (!Number.isFinite(weight) || !Number.isFinite(fee)) continue;
      shippingRates.push({
        id: `db_shr_${meta.code.toLowerCase()}_${weight}`,
        marketId,
        minWeightGrams: weight,
        maxWeightGrams: weight,
        feeLocal: fee,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }
  }

  return { products, markets, shippingRates, listings };
}

async function request(pathname, init) {
  const response = await fetch(`${apiBaseUrl}${pathname}`, {
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${response.status} ${pathname} -> ${text}`);
  return body;
}

const snapshot = buildSnapshot();
const backup = await request('/workspace/snapshot');
fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));
await request('/workspace/snapshot', { method: 'PUT', body: JSON.stringify(snapshot) });
const imported = await request('/workspace/snapshot');
console.log(JSON.stringify({
  backupSavedTo: backupPath,
  importedProducts: imported.products.length,
  importedMarkets: imported.markets.length,
  importedShippingRates: imported.shippingRates.length,
  importedListings: imported.listings.length,
}, null, 2));
