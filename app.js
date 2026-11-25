(() => {
  const calc = TakeProfit;
  const byId = id => document.getElementById(id);
  const root = byId("levels");
  const main = document.querySelector("main");
  const presetTools = document.querySelector(".tools");
  const presetRows = {};
  const storageKey = "tp-calculator.trade";
  const primary = ["entry", "size", "single"].map(byId);
  const number = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const signed = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: "exceptZero" });
  const quantity = new Intl.NumberFormat("en-US", { maximumFractionDigits: 10 });
  const tinyQty = new Intl.NumberFormat("en-US", { maximumSignificantDigits: 8, notation: "scientific" });
  const asQty = v => v > 0 && v < 1e-9 ? tinyQty.format(v) : quantity.format(v);
  const percent = v => number.format(v) + "%";
  const signedPercent = v => signed.format(v) + "%";
  const blankLevel = () => ({ price: "", allocation: "" });

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey));
      if (saved && ["entry", "size", "single"].every(k => typeof saved[k] === "string") &&
          Array.isArray(saved.levels) && saved.levels.length &&
          saved.levels.every(l => l && typeof l.price === "string" && typeof l.allocation === "string") &&
          (saved.preset === null || Object.hasOwn(calc.presets, saved.preset))) return saved;
    } catch { /* Inputs still work when browser storage is unavailable. */ }
    return { entry: "", size: "", single: "", levels: Array.from({ length: 3 }, blankLevel), preset: null };
  }
  const config = load();

  function output(el, value, format = number.format) {
    const valid = Number.isFinite(value);
    el.textContent = valid ? format(value) : "—";
    if (valid) el.dataset.value = value;
    else delete el.dataset.value;
  }

  function outputSigned(el, value, format = signed.format) {
    output(el, value, format);
    // Match the sign of the displayed value, including rounding to zero.
    el.classList.toggle("positive", el.textContent.startsWith("+"));
    el.classList.toggle("negative", el.textContent.startsWith("-"));
  }

  function error(input, note, message) {
    note.textContent = message;
    input.setAttribute("aria-invalid", String(Boolean(message)));
    if (message) input.setAttribute("aria-describedby", note.id);
    else input.removeAttribute("aria-describedby");
  }
  function inputValue(input, raw) {
    let display = raw;
    if (input !== document.activeElement) {
      if (input.dataset.key === "allocation") {
        const weight = calc.basisPoints(raw);
        if (weight !== null) display = (weight / 100).toFixed(2);
      } else {
        const value = calc.positive(raw);
        if (value !== null) display = input.id === "size" ? asQty(value) : number.format(value);
      }
    }
    if (input.value !== display) input.value = display;
  }

  function buildLevels() {
    const fragment = document.createDocumentFragment();
    config.levels.forEach((_, i) => {
      const row = byId("level-template").content.firstElementChild.cloneNode(true);
      const name = "TP " + (i + 1);
      row.dataset.index = i;
      row.querySelector(".tp-name").textContent = name;
      row.querySelector('[data-key="price"]').setAttribute("aria-label", name + " target price");
      row.querySelector('[data-key="allocation"]').setAttribute("aria-label", name + " allocation percentage");
      row.querySelector('[type="range"]').setAttribute("aria-label", name + " allocation slider");
      row.querySelector(".remove").setAttribute("aria-label", "Remove " + name);
      row.querySelector(".remove").disabled = config.levels.length === 1;
      row.querySelector(".price-error").id = "price-error-" + i;
      row.querySelector(".weight-error").id = "weight-error-" + i;
      fragment.append(row);
    });
    root.replaceChildren(fragment);
  }

  function buildPresets() {
    for (const [key, { name, shape }] of Object.entries(calc.presets)) {
      const button = document.createElement("button");
      button.dataset.preset = key;
      button.innerHTML = '<span class="shape" aria-hidden="true"></span><span><b class="preset-name"></b><span class="preset-ratio"></span></span>';
      button.querySelector(".preset-name").textContent = name;
      for (const part of shape) {
        const bar = document.createElement("i");
        bar.style.height = (part / Math.max(...shape) * 100) + "%";
        button.firstElementChild.append(bar);
      }
      presetTools.append(button);
    }
    for (const key of ["current", ...Object.keys(calc.presets)]) {
      const row = byId("preset-rows").insertRow();
      const heading = document.createElement("th");
      heading.scope = "row";
      if (key === "current") {
        row.className = "current";
        heading.textContent = "Current split";
      } else {
        row.dataset.preset = key;
        const button = document.createElement("button");
        button.className = "preset-action";
        button.textContent = calc.presets[key].name;
        button.setAttribute("aria-label", "Apply " + button.textContent);
        heading.append(button);
      }
      row.append(heading);
      for (let i = 0; i < 5; i++) row.insertCell();
      presetRows[key] = row;
    }
  }

  function currentWeights() {
    return config.levels.map(level => level.allocation === "" && level.price === "" ? 0 : calc.basisPoints(level.allocation));
  }
  function renderLevels(result) {
    const segments = document.createDocumentFragment();
    result.rows.forEach((data, i) => {
      const row = root.children[i];
      const level = config.levels[i];
      const price = row.querySelector('[data-key="price"]');
      const allocation = row.querySelector('[data-key="allocation"]');
      inputValue(price, level.price);
      inputValue(allocation, level.allocation);
      const slider = row.querySelector('[type="range"]');
      slider.value = (data.weight ?? 0) / 100;
      slider.style.setProperty("--fill", slider.value + "%");
      slider.setAttribute("aria-valuetext", level.allocation === "" ? "Unassigned" : slider.value + "%");
      error(price, row.querySelector(".price-error"), data.priceError);
      const allocationError = level.allocation === "" ? "Enter a share or choose a preset." : "Use 0–100 with up to two decimals.";
      error(allocation, row.querySelector(".weight-error"), data.weight === null ? allocationError : "");
      output(row.querySelector(".qty"), level.allocation === "" ? null : data.qty, asQty);
      outputSigned(row.querySelector(".profit"), level.allocation === "" ? null : data.profit);
      if (data.weight > 0) {
        const segment = document.createElement("i");
        segment.style.width = (data.weight / Math.max(result.total ?? calc.FULL, calc.FULL) * 100) + "%";
        segments.append(segment);
      }
    });
    byId("allocation-bar").replaceChildren(segments);
    const started = config.levels.some(level => level.allocation !== "");
    output(byId("allocation"), started && result.total !== null ? result.total / 100 : null, percent);
    let note = "";
    if (started && result.total !== null && result.total !== calc.FULL) {
      const remainder = calc.FULL - result.total;
      note = percent(Math.abs(remainder) / 100) + (remainder > 0 ? " unallocated." : " overallocated.");
    }
    byId("allocation-note").textContent = note;
    byId("normalize").disabled = !started || result.total === null || result.total === calc.FULL;
    byId("normalize").title = result.total === 0 ? "Divide evenly when all shares are zero" : "Scale the current shares to 100%";
  }

  function renderComparison(trade, result) {
    outputSigned(byId("single-profit"), trade.profit);
    output(byId("avg-a"), trade.direction ? trade.single : null);
    output(byId("avg-b"), result.average);
    outputSigned(byId("profit-a"), trade.profit);
    outputSigned(byId("profit-b"), result.profit);
    outputSigned(byId("rate-a"), trade.rate, signedPercent);
    outputSigned(byId("rate-b"), result.rate, signedPercent);
    outputSigned(byId("difference"), result.difference);
    outputSigned(byId("improvement"), result.improvement, signedPercent);
    outputSigned(byId("points"), result.points);
    const ready = result.profit !== null;
    byId("compare-note").hidden = ready;
    byId("results").hidden = !ready;
    const max = Math.max(trade.profit, result.profit);
    for (const [id, value] of [["a", trade.profit], ["b", result.profit]]) {
      byId("chart-" + id).style.width = (ready && max > 0 ? value / max * 100 : 0) + "%";
    }
  }

  function render() {
    const trade = calc.trade(config);
    const order = calc.executionOrder(config.levels, trade.direction);
    const plans = {};
    for (const button of presetTools.children) {
      const key = button.dataset.preset;
      const ranked = calc.presetWeights(order.length, key);
      const byRow = [];
      order.forEach((row, i) => { byRow[row] = ranked[i]; });
      plans[key] = byRow;
      const selected = config.preset === key;
      button.setAttribute("aria-pressed", String(selected));
      button.querySelector(".preset-ratio").textContent = ranked.map(w => w / 100).join(" / ");
      if (selected) config.levels.forEach((level, i) => { level.allocation = (byRow[i] / 100).toFixed(2); });
    }
    const weights = currentWeights();
    const result = calc.strategy(config.levels, weights, trade);
    for (const input of primary) {
      const key = input.id;
      inputValue(input, config[key]);
      let note = config[key] !== "" && trade[key] === null ? "Enter a positive number." : "";
      if (key === "single" && trade.single && trade.single === trade.entry) note = "Single TP must differ from entry.";
      error(input, byId(key + "-error"), note);
    }
    output(byId("notional"), trade.notional);
    byId("direction").hidden = !trade.direction;
    byId("direction").textContent = trade.direction > 0 ? "Long" : trade.direction < 0 ? "Short" : "";
    renderLevels(result);
    renderComparison(trade, result);
    for (const [key, row] of Object.entries(presetRows)) {
      const allocation = key === "current" ? config.levels.map(level => calc.basisPoints(level.allocation)) : plans[key];
      const metrics = key === "current" ? result : calc.strategy(config.levels, allocation, trade);
      row.cells[1].textContent = allocation.map(w => w === null ? "—" : w / 100).join(" / ");
      output(row.cells[2], metrics.average);
      outputSigned(row.cells[3], metrics.profit);
      outputSigned(row.cells[4], metrics.difference);
      outputSigned(row.cells[5], metrics.improvement, signedPercent);
    }
  }

  function changed() {
    render();
    try {
      localStorage.setItem(storageKey, JSON.stringify(config));
      byId("storage-error").hidden = true;
    } catch {
      byId("storage-error").hidden = false;
    }
  }
  function binding(input) {
    if (primary.includes(input)) return [config, input.id];
    return [config.levels[Number(input.closest(".level").dataset.index)], input.dataset.key || "allocation"];
  }
  main.addEventListener("focusin", event => {
    const input = event.target;
    if (!input.matches("input:not([type=range])")) return;
    const [record, key] = binding(input);
    input.value = record[key];
    input.select();
  });
  main.addEventListener("focusout", event => {
    const input = event.target;
    if (!input.matches("input:not([type=range])")) return;
    const [record, key] = binding(input);
    queueMicrotask(() => inputValue(input, record[key]));
  });
  main.addEventListener("input", event => {
    const input = event.target;
    if (!input.matches("input")) return;
    const [record, key] = binding(input);
    if (key === "allocation") config.preset = null;
    record[key] = input.value.trim();
    changed();
  });
  main.addEventListener("click", event => {
    const target = event.target;
    const preset = target.closest("[data-preset]");
    if (preset) {
      config.preset = preset.dataset.preset;
      changed();
    } else if (target.closest("#normalize")) {
      config.preset = null;
      const normalized = calc.distribute(currentWeights());
      config.levels.forEach((level, i) => { level.allocation = (normalized[i] / 100).toFixed(2); });
      changed();
    } else if (target.closest("#add")) {
      config.preset = null;
      config.levels.push(blankLevel());
      buildLevels();
      changed();
      root.lastElementChild.querySelector("input").focus();
    } else if (target.closest(".remove") && config.levels.length > 1) {
      const i = Number(target.closest(".level").dataset.index);
      config.preset = null;
      config.levels.splice(i, 1);
      buildLevels();
      changed();
      root.children[Math.min(i, config.levels.length - 1)].querySelector("input").focus();
    }
  });
  buildPresets();
  buildLevels();
  render();
})();
