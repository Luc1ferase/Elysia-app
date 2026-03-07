import fs from "node:fs";
import path from "node:path";

const rootJsonPath = path.resolve(process.cwd(), "../【升级】Shopee商品定价表（分享版） Copy.json");
const outputPath = path.resolve(process.cwd(), "src/data/workbookPreset.json");

const marketMeta = {
  "菲律宾Shopee": { code: "PH", currency: "PHP", logisticsKey: "菲律宾", fixedAdjustment: 0, promotionFeeCap: 100, shippingStrategy: "rounded_weight_lookup" },
  "新加坡Shopee": { code: "SG", currency: "SGD", logisticsKey: "新加坡", fixedAdjustment: 0, promotionFeeCap: 999999999, shippingStrategy: "rounded_weight_lookup" },
  "马来西亚Shopee": { code: "MY", currency: "MYR", logisticsKey: "马来西亚", fixedAdjustment: 0.54, promotionFeeCap: 999999999, shippingStrategy: "rounded_weight_lookup" },
  "越南Shopee": { code: "VN", currency: "VND", logisticsKey: "越南", fixedAdjustment: 3000, promotionFeeCap: 999999999, shippingStrategy: "rounded_weight_lookup" },
  "泰国Shopee": { code: "TH", currency: "THB", logisticsKey: "泰国", fixedAdjustment: 0, promotionFeeCap: 999999999, shippingStrategy: "rounded_weight_lookup" },
  "台湾Shopee": { code: "TW", currency: "TWD", logisticsKey: "台湾地区", fixedAdjustment: 0, promotionFeeCap: 999999999, shippingStrategy: "taiwan_ifs" },
};

const source = JSON.parse(fs.readFileSync(rootJsonPath, "utf-8"));
const logisticsSheet = source.sheets["物流价卡"];
const timestamp = new Date().toISOString();

function valueByKeyword(settings, keyword) {
  const key = Object.keys(settings).find((entry) => entry.includes(keyword));
  return key ? Number(settings[key]) : 0;
}

const markets = [];
const shippingRates = [];

for (const [sheetName, meta] of Object.entries(marketMeta)) {
  const sheet = source.sheets[sheetName];
  const marketId = `preset_mkt_${meta.code.toLowerCase()}`;
  markets.push({
    id: marketId,
    code: meta.code,
    name: sheetName.replace("Shopee", "").trim(),
    currency: meta.currency,
    exchangeRate: valueByKeyword(sheet.settings, "汇率换算"),
    commissionRate: valueByKeyword(sheet.settings, "佣金"),
    transactionFeeRate: valueByKeyword(sheet.settings, "手续费"),
    platformShippingRate: valueByKeyword(sheet.settings, "活动费率") || valueByKeyword(sheet.settings, "平台运费"),
    influencerRate: valueByKeyword(sheet.settings, "达人佣金"),
    taxRate: valueByKeyword(sheet.settings, "消费税") || valueByKeyword(sheet.settings, "增值税") || valueByKeyword(sheet.settings, "商品税"),
    fixedAdjustment: meta.fixedAdjustment,
    promotionFeeCap: meta.promotionFeeCap,
    shippingStrategy: meta.shippingStrategy,
    notes: Array.isArray(sheet.notes) ? sheet.notes.join("；") : "",
    createdAt: timestamp,
    updatedAt: timestamp,
  });

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

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify({ markets, shippingRates }, null, 2));
console.log(`Workbook preset generated: ${outputPath}`);

