import fs from "node:fs";
import path from "node:path";
import { calculatePricingRow, resolveLookupWeight } from "../src/lib/pricing.ts";
import type { Listing, Market, Product, ShippingRate } from "../src/types";

const workbookPresetPath = path.resolve(process.cwd(), "src/data/workbookPreset.json");
const fixturePath = path.resolve(process.cwd(), "../formula_validation_fixture.json");

const workbookPreset = JSON.parse(fs.readFileSync(workbookPresetPath, "utf-8")) as {
  markets: Market[];
  shippingRates: ShippingRate[];
};
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf-8")) as {
  sheets: Record<string, { samples: Array<{ row: number; inputs: Record<string, unknown>; expected: Record<string, unknown> }> }>;
};

const { buildSampleListing, buildSampleProduct, marketIdForSheet } = await import("./workbook-config.mjs");

const tolerance = 0.0001;

function nearlyEqual(left: number, right: number) {
  return Math.abs(left - right) <= tolerance;
}

function getExpectedValue(expected: Record<string, unknown>, matcher: RegExp) {
  const key = Object.keys(expected).find((item) => matcher.test(item));
  if (!key) {
    return undefined;
  }
  const value = expected[key];
  return typeof value === "number" ? value : undefined;
}

function buildEntities(sheetName: string, sample: { row: number; inputs: Record<string, unknown> }) {
  const timestamp = new Date().toISOString();
  const product = buildSampleProduct(sheetName, sample, timestamp) as Product;
  const listing = buildSampleListing(sheetName, sample, timestamp) as Listing;
  const marketId = marketIdForSheet(sheetName);
  const market = workbookPreset.markets.find((item) => item.id === marketId);
  if (!market) {
    throw new Error(`Market not found for ${sheetName}`);
  }
  const shippingRates = workbookPreset.shippingRates.filter((item) => item.marketId === marketId);
  return { product, listing, market, shippingRates };
}

function compareNumeric(label: string, actual: number, expected: number, bucket: string[]) {
  if (!nearlyEqual(actual, expected)) {
    bucket.push(`${label}: actual=${actual} expected=${expected}`);
  }
}

let sampleCount = 0;
const mismatches: string[] = [];

for (const [sheetName, payload] of Object.entries(fixture.sheets)) {
  for (const sample of payload.samples) {
    sampleCount += 1;
    const { product, listing, market, shippingRates } = buildEntities(sheetName, sample);
    const actual = calculatePricingRow({ product, market, listing, shippingRates });
    const expected = sample.expected;
    const localMismatches: string[] = [];

    const displayPrice = getExpectedValue(expected, /展示价/);
    const costLocal = getExpectedValue(expected, /成本项/);
    const shippingFee = getExpectedValue(expected, /物流费用/);
    const commissionFee = getExpectedValue(expected, /佣金费/);
    const transactionFee = getExpectedValue(expected, /交易手续费/);
    const promotionFee = getExpectedValue(expected, /活动费/);
    const influencerFee = getExpectedValue(expected, /达人佣金/);
    const profitLocal = getExpectedValue(expected, /^利润(?!.*￥)/);
    const profitRmb = getExpectedValue(expected, /利润￥|人民币/);
    const grossMargin = getExpectedValue(expected, /毛利率/);
    const lookupWeight = getExpectedValue(expected, /_lookup_weight/);

    if (displayPrice !== undefined) compareNumeric("displayPrice", actual.displayPrice, displayPrice, localMismatches);
    if (costLocal !== undefined) compareNumeric("costLocal", actual.costLocal, costLocal, localMismatches);
    if (shippingFee !== undefined) compareNumeric("shippingFee", actual.shippingFee, shippingFee, localMismatches);
    if (commissionFee !== undefined) compareNumeric("commissionFee", actual.commissionFee, commissionFee, localMismatches);
    if (transactionFee !== undefined) compareNumeric("transactionFee", actual.transactionFee, transactionFee, localMismatches);
    if (promotionFee !== undefined) compareNumeric("promotionFee", actual.promotionFee, promotionFee, localMismatches);
    if (influencerFee !== undefined) compareNumeric("influencerFee", actual.influencerFee, influencerFee, localMismatches);
    if (profitLocal !== undefined) compareNumeric("profitLocal", actual.profitLocal, profitLocal, localMismatches);
    if (profitRmb !== undefined) compareNumeric("profitRmb", actual.profitRmb, profitRmb, localMismatches);
    if (grossMargin !== undefined) compareNumeric("grossMargin", actual.grossMargin, grossMargin, localMismatches);
    if (lookupWeight !== undefined) compareNumeric("lookupWeight", resolveLookupWeight(market, product), lookupWeight, localMismatches);

    if (localMismatches.length > 0) {
      mismatches.push(`${sheetName} row ${sample.row} -> ${localMismatches.join(", ")}`);
    }
  }
}

if (mismatches.length > 0) {
  console.error(`Formula validation failed for ${mismatches.length} samples.`);
  for (const mismatch of mismatches) {
    console.error(mismatch);
  }
  process.exit(1);
}

console.log(`Formula validation passed for ${sampleCount} workbook samples.`);

