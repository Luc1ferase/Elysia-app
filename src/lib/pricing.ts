import type { Listing, Market, PricingRow, Product, ShippingRate } from "../types";

function keepFourDigits(value: number) {
  return Number(value.toFixed(4));
}

function roundUpWeight(weightGrams: number, step = 10) {
  return Math.ceil(weightGrams / step) * step;
}

function resolveShippingFee(market: Market, product: Product, rates: ShippingRate[]) {
  if (!rates.length) {
    return 0;
  }

  const targetWeight = market.shippingStrategy === "exact_weight_lookup"
    ? product.weightGrams
    : roundUpWeight(product.weightGrams);

  const match = [...rates]
    .sort((left, right) => left.maxWeightGrams - right.maxWeightGrams)
    .find((rate) => targetWeight >= rate.minWeightGrams && targetWeight <= rate.maxWeightGrams);

  const orderedRates = [...rates].sort((left, right) => left.maxWeightGrams - right.maxWeightGrams);

  return match?.feeLocal ?? orderedRates[orderedRates.length - 1]?.feeLocal ?? 0;
}

export function calculatePricingRow(input: {
  product: Product;
  market: Market;
  listing: Listing;
  shippingRates: ShippingRate[];
}): PricingRow {
  const { product, market, listing, shippingRates } = input;
  const costLocal = (product.costRmb + product.amortizedCostRmb) / market.exchangeRate;
  const shippingFee = resolveShippingFee(market, product, shippingRates);
  const commissionFee = listing.localPrice * market.commissionRate;
  const transactionFee = listing.localPrice * market.transactionFeeRate;
  const promotionFee = Math.min(listing.localPrice * market.platformShippingRate, market.promotionFeeCap);
  const influencerFee = listing.localPrice * market.influencerRate;
  const taxFee = listing.localPrice * market.taxRate;
  const profitLocal = listing.localPrice
    - costLocal
    - shippingFee
    - commissionFee
    - transactionFee
    - promotionFee
    - influencerFee
    - taxFee
    - market.fixedAdjustment;

  return {
    productId: product.id,
    listingId: listing.id,
    sku: product.sku,
    name: product.name,
    size: product.size,
    weightGrams: product.weightGrams,
    localPrice: keepFourDigits(listing.localPrice),
    costLocal: keepFourDigits(costLocal),
    shippingFee: keepFourDigits(shippingFee),
    commissionFee: keepFourDigits(commissionFee),
    transactionFee: keepFourDigits(transactionFee),
    promotionFee: keepFourDigits(promotionFee),
    influencerFee: keepFourDigits(influencerFee),
    taxFee: keepFourDigits(taxFee),
    fixedAdjustment: keepFourDigits(market.fixedAdjustment),
    profitLocal: keepFourDigits(profitLocal),
    profitRmb: keepFourDigits(profitLocal * market.exchangeRate),
    grossMargin: keepFourDigits(listing.localPrice === 0 ? 0 : profitLocal / listing.localPrice),
  };
}
