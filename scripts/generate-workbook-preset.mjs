import fs from "node:fs";
import path from "node:path";
import { buildSampleListing, buildSampleProduct, marketIdForSheet, marketMeta, pickNumericValue, pickTextValue } from "./workbook-config.mjs";

const rootWorkbookJsonPath = path.resolve(process.cwd(), "../【升级】Shopee商品定价表（分享版） Copy.json");
const rootFixturePath = path.resolve(process.cwd(), "../formula_validation_fixture.json");
const presetOutputPath = path.resolve(process.cwd(), "src/data/workbookPreset.json");
const sampleOutputPath = path.resolve(process.cwd(), "src/data/workbookSamples.json");
const fullDataOutputPath = path.resolve(process.cwd(), "src/data/workbookFullData.json");

const source = JSON.parse(fs.readFileSync(rootWorkbookJsonPath, "utf-8"));
const fixture = JSON.parse(fs.readFileSync(rootFixturePath, "utf-8"));
const logisticsSheet = source.sheets["物流价卡"];
const timestamp = new Date().toISOString();

function stableId(prefix, signature) {
  return `${prefix}_${Buffer.from(signature).toString("base64url").replace(/-/g, "").replace(/_/g, "").slice(0, 20)}`;
}

function extractProductRecord(record) {
  return {
    sku: pickTextValue(record, ["货号"]),
    name: pickTextValue(record, ["产品名字"]),
    size: pickTextValue(record, ["规格"]),
    costRmb: pickNumericValue(record, ["商品成本 RMB"]),
    amortizedCostRmb: pickNumericValue(record, ["摊销成本"]),
    weightGrams: pickNumericValue(record, ["实重 g"]),
    localPrice: pickNumericValue(record, ["本地定价", "税前价"]),
  };
}

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
    const normalized = extractProductRecord(record);
    if (!normalized.name || !Number.isFinite(normalized.costRmb) || !Number.isFinite(normalized.weightGrams) || !Number.isFinite(normalized.localPrice) || normalized.localPrice <= 0) {
      continue;
    }

    const cleanedSku = normalized.sku && normalized.sku !== "x" ? normalized.sku : "";
    const signature = cleanedSku
      ? `sku:${cleanedSku}|${normalized.size}|${normalized.costRmb}|${normalized.amortizedCostRmb}|${normalized.weightGrams}`
      : `fallback:${normalized.name}|${normalized.size}|${normalized.costRmb}|${normalized.amortizedCostRmb}|${normalized.weightGrams}`;

    let productId = productIdBySignature.get(signature);
    if (!productId) {
      productId = stableId("full_prd", signature);
      productIdBySignature.set(signature, productId);
      fullProducts.push({
        id: productId,
        sku: cleanedSku || `${meta.code}-${record._row}`,
        name: normalized.name,
        size: normalized.size,
        costRmb: normalized.costRmb,
        amortizedCostRmb: normalized.amortizedCostRmb,
        weightGrams: normalized.weightGrams,
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
      id: `full_lst_${meta.code.toLowerCase()}_${record._row}`,
      productId,
      marketId,
      localPrice: normalized.localPrice,
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
