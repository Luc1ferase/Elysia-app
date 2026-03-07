import fs from "node:fs";
import path from "node:path";
import { buildSampleListing, buildSampleProduct, marketIdForSheet, marketMeta, pickNumericValue } from "./workbook-config.mjs";

const rootWorkbookJsonPath = path.resolve(process.cwd(), "../【升级】Shopee商品定价表（分享版） Copy.json");
const rootFixturePath = path.resolve(process.cwd(), "../formula_validation_fixture.json");
const presetOutputPath = path.resolve(process.cwd(), "src/data/workbookPreset.json");
const sampleOutputPath = path.resolve(process.cwd(), "src/data/workbookSamples.json");

const source = JSON.parse(fs.readFileSync(rootWorkbookJsonPath, "utf-8"));
const fixture = JSON.parse(fs.readFileSync(rootFixturePath, "utf-8"));
const logisticsSheet = source.sheets["物流价卡"];
const timestamp = new Date().toISOString();

const markets = [];
const shippingRates = [];
const products = [];
const listings = [];

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
    products.push(buildSampleProduct(sheetName, sample, timestamp));
    listings.push(buildSampleListing(sheetName, sample, timestamp));
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
fs.writeFileSync(sampleOutputPath, JSON.stringify({ products, listings }, null, 2));
console.log(`Workbook preset generated: ${presetOutputPath}`);
console.log(`Workbook samples generated: ${sampleOutputPath}`);

