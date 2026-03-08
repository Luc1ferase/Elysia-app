import type { Listing, Market, PricingRow, Product, ShippingRate } from "../types";

function keepFourDigits(value: number) {
  return Number(value.toFixed(4));
}

function roundUpWeight(weightGrams: number, step = 10) {
  return Math.ceil(weightGrams / step) * step;
}

export function resolveLookupWeight(market: Market, product: Product) {
  return market.shippingStrategy === "exact_weight_lookup"
    ? product.weightGrams
    : roundUpWeight(product.weightGrams);
}

function resolveTaiwanShippingFee(weightGrams: number) {
  const roundedWeight = roundUpWeight(weightGrams);
  if (roundedWeight <= 500) {
    return 25;
  }
  if (roundedWeight <= 1000) {
    return 55;
  }
  if (roundedWeight <= 1500) {
    return 95;
  }
  if (roundedWeight <= 2000) {
    return 135;
  }
  if (roundedWeight <= 2500) {
    return 185;
  }
  return 185 + 60 * Math.ceil((roundedWeight - 2500) / 500);
}

export function resolveShippingFeeForWeight(market: Market, weightGrams: number, rates: ShippingRate[]) {
  if (market.shippingStrategy === "taiwan_ifs") {
    return resolveTaiwanShippingFee(weightGrams);
  }

  if (!rates.length) {
    return 0;
  }

  const targetWeight = market.shippingStrategy === "exact_weight_lookup"
    ? weightGrams
    : roundUpWeight(weightGrams);
  const orderedRates = [...rates].sort((left, right) => left.maxWeightGrams - right.maxWeightGrams);
  const match = orderedRates.find((rate) => targetWeight >= rate.minWeightGrams && targetWeight <= rate.maxWeightGrams);

  return match?.feeLocal ?? orderedRates[orderedRates.length - 1]?.feeLocal ?? 0;
}

function resolveShippingFee(market: Market, product: Product, rates: ShippingRate[]) {
  return resolveShippingFeeForWeight(market, product.weightGrams, rates);
}


function resolveListingSku(listing: Listing, product: Product) {
  if (listing.marketSku?.trim()) {
    return listing.marketSku.trim();
  }

  const fallbackMatch = /^db_lst_([a-z]+)_(\d+)$/i.exec(listing.id);
  if (fallbackMatch) {
    return `${fallbackMatch[1].toUpperCase()}-${fallbackMatch[2]}`;
  }

  return product.sku;
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
  const displayPrice = listing.localPrice * (1 + market.taxRate);
  const taxFee = displayPrice - listing.localPrice;
  const profitLocal = listing.localPrice
    - costLocal
    - shippingFee
    - commissionFee
    - transactionFee
    - promotionFee
    - influencerFee
    - market.fixedAdjustment;

  return {
    productId: product.id,
    listingId: listing.id,
    sku: resolveListingSku(listing, product),
    name: product.name,
    size: product.size,
    weightGrams: product.weightGrams,
    localPrice: keepFourDigits(listing.localPrice),
    displayPrice: keepFourDigits(displayPrice),
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
