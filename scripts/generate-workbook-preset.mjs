import fs from "node:fs";
import path from "node:path";
import { read, utils } from "xlsx";
import { buildSampleListing, buildSampleProduct, marketIdForSheet, marketMeta, pickNumericValue, pickTextValue } from "./workbook-config.mjs";

const rootWorkbookPath = path.resolve(process.cwd(), "../【升级】Shopee商品定价表（分享版） Copy.xlsx");
const rootFixturePath = path.resolve(process.cwd(), "../formula_validation_fixture.json");
const presetOutputPath = path.resolve(process.cwd(), "src/data/workbookPreset.json");
const sampleOutputPath = path.resolve(process.cwd(), "src/data/workbookSamples.json");
const fullDataOutputPath = path.resolve(process.cwd(), "src/data/workbookFullData.json");

const fixture = JSON.parse(fs.readFileSync(rootFixturePath, "utf-8"));
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

function directCellValue(ws, ref) {
  return clean(ws[ref]?.v);
}

function attachCanonicalSettings(sheetName, ws, settings) {
  const config = marketSettingCells[sheetName];
  if (!config) {
    return settings;
  }
  return {
    ...settings,
    "汇率换算": config.exchangeRate ? directCellValue(ws, config.exchangeRate) : settings["汇率换算"],
    "佣金": config.commissionRate ? directCellValue(ws, config.commissionRate) : settings["佣金"],
    "手续费": config.transactionFeeRate ? directCellValue(ws, config.transactionFeeRate) : settings["手续费"],
    "活动费率": config.platformShippingRate ? directCellValue(ws, config.platformShippingRate) : settings["活动费率"],
    "达人佣金": config.influencerRate ? directCellValue(ws, config.influencerRate) : settings["达人佣金"],
    "税率": config.taxRate ? directCellValue(ws, config.taxRate) : settings["税率"],
  };
}

function cellValue(ws, row, col) {
  const address = utils.encode_cell({ r: row - 1, c: col - 1 });
  return clean(ws[address]?.v);
}

function hasValue(values) {
  return values.some((value) => value !== null && value !== "");
}

function stableId(prefix, signature) {
  let hash = 0;
  for (let index = 0; index < signature.length; index += 1) {
    hash = (hash * 31 + signature.charCodeAt(index)) >>> 0;
  }
  return `${prefix}_${hash.toString(36)}`;
}

function extractMarketSheet(ws, sheetName) {
  const bounds = getSheetBounds(ws);
  const settings = {};
  const notes = [];

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

  const headers = [];
  const selectedColumns = [];
  for (let col = 1; col <= bounds.e.c + 1; col += 1) {
    const header = cellValue(ws, 4, col);
    if (typeof header === "string") {
      selectedColumns.push(col);
      headers.push(header);
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

  return { settings: attachCanonicalSettings(sheetName, ws, settings), notes, records };
}

function extractLogisticsSheet(ws) {
  const bounds = getSheetBounds(ws);
  const markets = {};

  for (let col = 1; col <= bounds.e.c + 1; col += 3) {
    const marketName = cellValue(ws, 2, col);
    if (typeof marketName !== "string") {
      continue;
    }

    const columns = [];
    const selectedColumns = [];
    for (let offset = 0; offset < 3; offset += 1) {
      const currentCol = col + offset;
      const label = cellValue(ws, 3, currentCol);
      if (typeof label === "string") {
        selectedColumns.push(currentCol);
        columns.push(label);
      }
    }

    const entries = [];
    for (let row = 4; row <= bounds.e.r + 1; row += 1) {
      const rowValues = selectedColumns.map((currentCol) => cellValue(ws, row, currentCol));
      if (!hasValue(rowValues)) {
        continue;
      }
      const entry = { _row: row };
      columns.forEach((header, index) => {
        entry[header] = rowValues[index];
      });
      entries.push(entry);
    }

    markets[marketName] = { columns, entries };
  }

  return { markets };
}

function extractWorkbook(filePath) {
  const workbook = read(fs.readFileSync(filePath), { type: "buffer" });
  const sheets = {};
  for (const name of workbook.SheetNames) {
    const ws = workbook.Sheets[name];
    if (!ws) continue;
    if (name === "物流价卡") {
      sheets[name] = extractLogisticsSheet(ws);
    } else if (name in marketMeta) {
      sheets[name] = extractMarketSheet(ws, name);
    }
  }
  return { sheets };
}

const source = extractWorkbook(rootWorkbookPath);
const logisticsSheet = source.sheets["物流价卡"];
const markets = [];
const shippingRates = [];
const sampleProducts = [];
const sampleListings = [];
const fullProducts = [];
const fullListings = [];
const productIdBySignature = new Map();
const listingKeySet = new Set();

for (const [sheetName, meta] of Object.entries(marketMeta)) {
  const sheet = source.sheets[sheetName];
  const marketId = marketIdForSheet(sheetName);

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
    notes: Array.isArray(sheet.notes) ? sheet.notes.join("；") : "",
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  const samples = fixture.sheets[sheetName]?.samples ?? [];
  for (const sample of samples) {
    sampleProducts.push(buildSampleProduct(sheetName, sample, timestamp));
    sampleListings.push(buildSampleListing(sheetName, sample, timestamp));
  }

  for (const record of sheet.records ?? []) {
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
      productId = stableId("full_prd", signature);
      productIdBySignature.set(signature, productId);
      fullProducts.push({
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
    fullListings.push({
      id: `full_lst_${meta.code.toLowerCase()}_${row}`,
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

  const marketLogistics = logisticsSheet.markets[meta.logisticsKey];
  if (!marketLogistics) {
    continue;
  }

  const weightKey = marketLogistics.columns[0];
  const feeKey = marketLogistics.columns[1];
  for (const entry of marketLogistics.entries) {
    const weight = Number(entry[weightKey]);
    const fee = Number(entry[feeKey]);
    if (!Number.isFinite(weight) || !Number.isFinite(fee)) {
      continue;
    }
    shippingRates.push({
      id: `preset_shr_${meta.code.toLowerCase()}_${weight}`,
      marketId,
      minWeightGrams: weight,
      maxWeightGrams: weight,
      feeLocal: fee,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }
}

fs.mkdirSync(path.dirname(presetOutputPath), { recursive: true });
fs.writeFileSync(presetOutputPath, JSON.stringify({ markets, shippingRates }, null, 2));
fs.writeFileSync(sampleOutputPath, JSON.stringify({ products: sampleProducts, listings: sampleListings }, null, 2));
fs.writeFileSync(fullDataOutputPath, JSON.stringify({ products: fullProducts, listings: fullListings }, null, 2));
console.log(`Workbook preset generated: ${presetOutputPath}`);
console.log(`Workbook samples generated: ${sampleOutputPath}`);
console.log(`Workbook full dataset generated: ${fullDataOutputPath}`);
