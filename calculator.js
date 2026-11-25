// Allocation arithmetic uses integer hundredths of one percent.
const TakeProfit = (() => {
  const FULL = 10000;
  const presets = {
    equal: { name: "Equal Weight", shape: [1, 1, 1] },
    front: { name: "Front-loaded", shape: [50, 30, 20] },
    back: { name: "Back-loaded", shape: [20, 30, 50] },
    conservative: { name: "Conservative", shape: [70, 20, 10] },
    aggressive: { name: "Aggressive", shape: [10, 20, 70] },
    balanced: { name: "Balanced", shape: [25, 50, 25] }
  };

  function positive(raw) {
    if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw)) return null;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  function basisPoints(raw) {
    if (!/^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(raw)) return null;
    const [whole, fraction = ""] = String(raw).split(".");
    const value = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
    return value <= FULL ? value : null;
  }

  // Largest remainders receive the spare hundredths, with stable tie-breaking.
  function distribute(weights) {
    const sum = weights.reduce((a, b) => a + b, 0);
    if (sum === 0) return distribute(weights.map(() => 1));
    const parts = weights.map((weight, i) => ({
      i, amount: Math.floor(weight * FULL / sum), remainder: weight * FULL % sum
    }));
    const allocated = parts.reduce((total, part) => total + part.amount, 0);
    const ranked = [...parts].sort((a, b) => b.remainder - a.remainder);
    for (let i = 0; i < FULL - allocated; i++) ranked[i].amount++;
    return parts.map(part => part.amount);
  }

  function presetWeights(count, kind) {
    if (count === 1) return [FULL];
    const shape = presets[kind].shape;
    if (count === 3) return distribute(shape);
    const span = count - 1;
    const weights = Array.from({ length: count }, (_, i) => {
      if (kind === "front") return count - i;
      if (kind === "back") return i + 1;
      // Interpolate between the near, middle and far weights using integer ranks.
      const segment = 2 * i <= span ? 0 : 1;
      const offset = 2 * i - segment * span;
      return shape[segment] * (span - offset) + shape[segment + 1] * offset;
    });
    return distribute(weights);
  }

  function executionOrder(levels, direction) {
    const order = levels.map((_, i) => i);
    const prices = levels.map(level => positive(level.price));
    if (direction && prices.every(price => price !== null)) {
      order.sort((a, b) => direction * (prices[a] - prices[b]));
    }
    return order;
  }

  function trade(config) {
    const entry = positive(config.entry);
    const size = positive(config.size);
    const single = positive(config.single);
    const direction = entry && single ? Math.sign(single - entry) : 0;
    const notional = entry && size ? entry * size : null;
    const profit = direction && size ? direction * (single - entry) * size : null;
    const rate = profit !== null && notional > 0 ? profit / notional * 100 : null;
    return { entry, size, single, direction, notional, profit, rate };
  }

  function strategy(levels, weights, trade) {
    const total = weights.includes(null) ? null : weights.reduce((a, b) => a + b, 0);
    const rows = levels.map((level, i) => {
      const weight = weights[i];
      const price = positive(level.price);
      const qty = weight !== null && trade.size ? trade.size * (weight / FULL) : null;
      if (weight === 0) return { qty: 0, profit: 0, weight, priceError: "" };
      let priceError = "";
      if (weight !== null && price === null) priceError = "Enter a positive target price.";
      else if (weight !== null && trade.direction && trade.direction * (price - trade.entry) <= 0) {
        priceError = trade.direction > 0 ? "Target must be above entry." : "Target must be below entry.";
      }
      const profit = !priceError && trade.direction && qty !== null
        ? trade.direction * (price - trade.entry) * qty : null;
      return { qty, profit, weight, priceError };
    });
    const result = { rows, total, average: null, profit: null, rate: null, difference: null, improvement: null, points: null };
    if (total !== FULL || !trade.notional || !Number.isFinite(trade.notional) ||
        !Number.isFinite(trade.profit) || !Number.isFinite(trade.rate) ||
        rows.some(row => !Number.isFinite(row.profit))) return result;

    const average = levels.reduce((sum, level, i) =>
      weights[i] ? sum + Number(level.price) * (weights[i] / FULL) : sum, 0);
    const profit = rows.reduce((sum, row) => sum + row.profit, 0);
    const rate = profit / trade.notional * 100;
    const difference = profit - trade.profit;
    const improvement = trade.profit > 0 ? difference / trade.profit * 100 : null;
    const points = rate - trade.rate;
    if ([average, profit, rate, difference, points].every(Number.isFinite)) {
      Object.assign(result, { average, profit, rate, difference, improvement, points });
    }
    return result;
  }

  return { FULL, presets, positive, basisPoints, distribute, presetWeights, executionOrder, trade, strategy };
})();
