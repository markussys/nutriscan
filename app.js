'use strict';

/* ================= helpers ================= */

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const num = v => { const x = parseFloat(v); return Number.isFinite(x) ? x : null; };
const pct = (v, goal) => goal > 0 ? Math.min(100, (v / goal) * 100) : 0;

function fmt(v, unit = 'g') {
  if (v == null || Number.isNaN(v)) return '–';
  if (unit === 'kcal') return String(Math.round(v));
  return String(v < 10 ? Math.round(v * 10) / 10 : Math.round(v));
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

/* ================= config ================= */

const NUTRIENTS = [
  { key: 'kcal', label: 'Calories', unit: 'kcal' },
  { key: 'protein', label: 'Protein', unit: 'g' },
  { key: 'carbs', label: 'Carbs', unit: 'g' },
  { key: 'sugar', label: 'of which sugars', unit: 'g', sub: true },
  { key: 'fat', label: 'Fat', unit: 'g' },
  { key: 'fiber', label: 'Fiber', unit: 'g' },
  { key: 'salt', label: 'Salt', unit: 'g' },
];
const MACROS = [
  { key: 'protein', label: 'Protein', color: 'var(--protein)' },
  { key: 'carbs', label: 'Carbs', color: 'var(--carbs)' },
  { key: 'fat', label: 'Fat', color: 'var(--fat)' },
];
const MEALS = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'];
const DEFAULT_GOALS = { kcal: 2000, protein: 120, carbs: 220, fat: 70 };

/* ================= storage ================= */

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem('nutriscan.' + key);
      return v ? JSON.parse(v) : fallback;
    } catch { return fallback; }
  },
  set(key, val) {
    try { localStorage.setItem('nutriscan.' + key, JSON.stringify(val)); }
    catch { toast('Could not save – browser storage is full or blocked'); }
  },
};

let goals = { ...DEFAULT_GOALS, ...store.get('goals', {}) };
let products = store.get('products', {}); // id -> product (scanned + custom)
let log = store.get('log', {});           // 'YYYY-MM-DD' -> entry[]

const saveGoals = () => store.set('goals', goals);
const saveProducts = () => store.set('products', products);
const saveLog = () => store.set('log', log);

/* ================= dates ================= */

function dayKey(d) {
  const z = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}
function parseKey(k) {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function addDays(k, n) {
  const d = parseKey(k);
  d.setDate(d.getDate() + n);
  return dayKey(d);
}
const todayKey = () => dayKey(new Date());

function dayLabel(k) {
  const today = todayKey();
  if (k === today) return 'Today';
  if (k === addDays(today, -1)) return 'Yesterday';
  return parseKey(k).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

function guessMeal() {
  const h = new Date().getHours();
  if (h < 11) return 'Breakfast';
  if (h < 16) return 'Lunch';
  if (h < 21) return 'Dinner';
  return 'Snacks';
}

let currentDay = todayKey();

/* ================= nutrition math ================= */

function totals(entries) {
  const t = Object.fromEntries(NUTRIENTS.map(n => [n.key, 0]));
  for (const e of entries) {
    for (const n of NUTRIENTS) t[n.key] += (e.per100[n.key] || 0) * e.grams / 100;
  }
  return t;
}

/* ================= Open Food Facts ================= */

const OFF_FIELDS = [
  'code', 'product_name', 'product_name_en', 'product_name_lv', 'generic_name',
  'brands', 'image_front_small_url', 'image_front_url', 'nutriments', 'serving_quantity',
].join(',');

async function fetchProduct(code) {
  const res = await fetch(
    `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=${OFF_FIELDS}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  if (data.status !== 1 || !data.product) return null;
  return fromOFF(code, data.product);
}

function fromOFF(code, p) {
  const n = p.nutriments || {};
  let kcal = num(n['energy-kcal_100g']);
  if (kcal == null) {
    const kj = num(n['energy-kj_100g']) ?? num(n['energy_100g']);
    if (kj != null) kcal = kj / 4.184;
  }
  return {
    id: code,
    barcode: code,
    name: p.product_name || p.product_name_en || p.product_name_lv || p.generic_name || 'Unnamed product',
    brand: (p.brands || '').split(',')[0].trim(),
    image: p.image_front_small_url || p.image_front_url || '',
    per100: {
      kcal,
      protein: num(n.proteins_100g),
      carbs: num(n.carbohydrates_100g),
      sugar: num(n.sugars_100g),
      fat: num(n.fat_100g),
      fiber: num(n.fiber_100g),
      salt: num(n.salt_100g),
    },
    serving: num(p.serving_quantity) || null,
    source: 'off',
    updated: Date.now(),
  };
}

const findByBarcode = code =>
  products[code] || Object.values(products).find(p => p.barcode === code);

let lookupBusy = false;
async function lookup(raw) {
  const code = String(raw).replace(/\D/g, '');
  if (code.length < 6) { toast('That doesn\'t look like a barcode'); return; }
  if (lookupBusy) return;
  lookupBusy = true;
  await stopScanner();

  try {
    const saved = findByBarcode(code);
    if (saved) { openProduct(saved); return; }

    setScanStatus(`Looking up ${code}…`);
    const p = await fetchProduct(code);
    if (!p) {
      openFoodEditor({ barcode: code }, 'Not found in Open Food Facts. Enter the values from the label – it\'s saved for next time.');
    } else if (p.per100.kcal == null) {
      openFoodEditor(p, 'Found the product, but it has no nutrition data. Please fill it in from the label.');
    } else {
      products[p.id] = p;
      saveProducts();
      openProduct(p);
    }
  } catch (err) {
    console.error(err);
    toast('Lookup failed – check your internet connection');
  } finally {
    setScanStatus('');
    lookupBusy = false;
  }
}

/* ================= views ================= */

function show(view) {
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
  $$('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.goto === view));
  if (view !== 'scan') stopScanner();

  if (view === 'today') renderToday();
  if (view === 'scan') {
    renderFoods();
    if (store.get('autoCamera', false)) startScanner();
  }
  if (view === 'history') renderHistory();
  if (view === 'settings') fillGoals();
  window.scrollTo(0, 0);
}

/* ---------- today ---------- */

function renderToday() {
  const entries = log[currentDay] || [];
  const t = totals(entries);

  $('#date-label').textContent = dayLabel(currentDay);
  $('#next-day').disabled = currentDay >= todayKey();

  $('#kcal-eaten').textContent = fmt(t.kcal, 'kcal');
  $('#kcal-goal').textContent = goals.kcal;
  const left = goals.kcal - t.kcal;
  const leftEl = $('#kcal-left');
  leftEl.textContent = left >= 0 ? `${Math.round(left)} kcal left` : `${Math.round(-left)} kcal over`;
  leftEl.classList.toggle('over', left < 0);

  const kcalBar = $('#kcal-bar');
  kcalBar.style.width = pct(t.kcal, goals.kcal) + '%';
  kcalBar.parentElement.classList.toggle('over', t.kcal > goals.kcal);

  $('#macro-bars').innerHTML = MACROS.map(m => `
    <div class="macro">
      <div class="macro-head">
        <span class="lbl"><i class="dot" style="background:${m.color}"></i>${m.label}</span>
        <b>${fmt(t[m.key])}</b> / ${goals[m.key]} g
      </div>
      <div class="bar" style="--c:${m.color}"><div style="width:${pct(t[m.key], goals[m.key])}%"></div></div>
    </div>`).join('');

  if (!entries.length) {
    $('#meals').innerHTML = `<div class="card empty">Nothing logged ${currentDay === todayKey() ? 'yet today' : 'on this day'}.<br>Scan a barcode to get started.</div>`;
    return;
  }

  $('#meals').innerHTML = MEALS.map(meal => {
    const list = entries.filter(e => e.meal === meal);
    if (!list.length) return '';
    return `
      <div class="card">
        <div class="meal-head"><h3>${meal}</h3><span class="muted small">${fmt(totals(list).kcal, 'kcal')} kcal</span></div>
        <ul class="list">${list.map(e => `
          <li data-entry="${esc(e.id)}">
            <div class="grow">
              <div class="name">${esc(e.name)}</div>
              <div class="muted small">${fmt(e.grams)} g${e.brand ? ' · ' + esc(e.brand) : ''}</div>
            </div>
            <div class="kcal">${fmt((e.per100.kcal || 0) * e.grams / 100, 'kcal')}<small> kcal</small></div>
          </li>`).join('')}
        </ul>
      </div>`;
  }).join('');
}

/* ---------- my foods ---------- */

const thumb = p => p.image
  ? `<img class="thumb" src="${esc(p.image)}" alt="" loading="lazy">`
  : `<div class="thumb ph">${esc((p.name || '?').charAt(0).toUpperCase())}</div>`;

function renderFoods() {
  const q = $('#food-filter').value.trim().toLowerCase();
  const list = Object.values(products)
    .filter(p => !q || `${p.name} ${p.brand || ''} ${p.barcode || ''}`.toLowerCase().includes(q))
    .sort((a, b) => (b.lastUsed || b.updated || 0) - (a.lastUsed || a.updated || 0));

  $('#food-list').innerHTML = list.length
    ? list.map(p => `
        <li data-product="${esc(p.id)}">
          ${thumb(p)}
          <div class="grow">
            <div class="name">${esc(p.name)}</div>
            <div class="muted small">${esc(p.brand || '')}</div>
          </div>
          <div class="kcal">${fmt(p.per100.kcal, 'kcal')}<small> kcal/100g</small></div>
        </li>`).join('')
    : `<li class="empty">${q ? 'No matches.' : 'Foods you scan or create will show up here.'}</li>`;
}

/* ---------- history ---------- */

function renderHistory() {
  const today = todayKey();
  const last7 = Array.from({ length: 7 }, (_, i) => addDays(today, -i)).filter(k => log[k]?.length);

  if (last7.length) {
    const t = totals(last7.flatMap(k => log[k]));
    const avg = k => t[k] / last7.length;
    $('#history-avg').innerHTML = `Average per logged day (${last7.length} day${last7.length > 1 ? 's' : ''}):<br>
      <b>${fmt(avg('kcal'), 'kcal')} kcal</b> · P ${fmt(avg('protein'))} g · C ${fmt(avg('carbs'))} g · F ${fmt(avg('fat'))} g`;
  } else {
    $('#history-avg').textContent = 'Nothing logged in the last 7 days.';
  }

  const days = Object.keys(log).filter(k => log[k].length).sort().reverse();
  $('#history-list').innerHTML = days.length
    ? days.map(k => {
        const t = totals(log[k]);
        return `
          <li class="hist-day" data-day="${k}">
            <div class="hist-top">
              <b>${dayLabel(k)}</b>
              <span><b>${fmt(t.kcal, 'kcal')}</b> <span class="muted">/ ${goals.kcal} kcal</span></span>
            </div>
            <div class="bar${t.kcal > goals.kcal ? ' over' : ''}"><div style="width:${pct(t.kcal, goals.kcal)}%"></div></div>
            <div class="muted small">P ${fmt(t.protein)} g · C ${fmt(t.carbs)} g · F ${fmt(t.fat)} g · ${log[k].length} item${log[k].length > 1 ? 's' : ''}</div>
          </li>`;
      }).join('')
    : '<li class="empty">No history yet.</li>';
}

/* ---------- settings ---------- */

function fillGoals() {
  for (const k of Object.keys(DEFAULT_GOALS)) $('#goal-' + k).value = goals[k];
}

/* ================= product sheet ================= */

const productDialog = $('#product-dialog');
let sheet = null; // { product, entry? }

function openProduct(product, entry = null) {
  sheet = { product, entry };

  $('#p-name').textContent = product.name;
  $('#p-brand').textContent = [product.brand, product.barcode].filter(Boolean).join(' · ');
  const img = $('#p-img');
  img.hidden = !product.image;
  if (product.image) img.src = product.image; else img.removeAttribute('src');

  $('#p-grams').value = entry ? entry.grams : (product.serving || 100);
  $('#p-meal').value = entry ? entry.meal : guessMeal();

  const opts = [];
  if (product.serving) opts.push({ g: product.serving, label: `1 serving · ${fmt(product.serving)} g` });
  for (const g of [50, 100, 150, 200, 250]) opts.push({ g, label: `${g} g` });
  $('#p-chips').innerHTML = opts.map(o => `<button type="button" class="chip" data-g="${o.g}">${o.label}</button>`).join('');

  $('#p-submit').textContent = entry ? 'Save' : 'Add';
  $('#p-delete').hidden = !entry;
  $('#p-edit').hidden = !!entry || !products[product.id];

  renderSheetTable();
  productDialog.showModal();
}

function renderSheetTable() {
  const g = num($('#p-grams').value) || 0;
  const p = sheet.product.per100;
  const cell = (v, unit) => v == null ? '–' : `${fmt(v, unit)} ${unit}`;
  $('#p-table').innerHTML = `
    <thead><tr><th></th><th>per 100 g</th><th>${fmt(g)} g</th></tr></thead>
    <tbody>${NUTRIENTS.map(n => `
      <tr class="${n.sub ? 'sub' : ''} ${n.key === 'kcal' ? 'kcal-row' : ''}">
        <td>${n.label}</td>
        <td>${cell(p[n.key], n.unit)}</td>
        <td><b>${cell(p[n.key] == null ? null : p[n.key] * g / 100, n.unit)}</b></td>
      </tr>`).join('')}
    </tbody>`;
}

function submitProduct(e) {
  e.preventDefault();
  const grams = num($('#p-grams').value);
  if (!(grams > 0)) { toast('Enter an amount in grams'); return; }
  const meal = $('#p-meal').value;
  const { product, entry } = sheet;

  if (entry) {
    entry.grams = grams;
    entry.meal = meal;
    toast('Updated');
  } else {
    (log[currentDay] ||= []).push({
      id: uid(),
      productId: product.id,
      name: product.name,
      brand: product.brand || '',
      per100: { ...product.per100 }, // snapshot, so editing a food later doesn't rewrite history
      grams,
      meal,
      t: Date.now(),
    });
    if (products[product.id]) {
      products[product.id].lastUsed = Date.now();
      saveProducts();
    }
    toast(`Added to ${dayLabel(currentDay).toLowerCase() === 'today' ? 'today' : dayLabel(currentDay)} · ${fmt(product.per100.kcal * grams / 100, 'kcal')} kcal`);
  }
  saveLog();
  productDialog.close();
  show('today');
}

function deleteEntry() {
  const { entry } = sheet;
  log[currentDay] = (log[currentDay] || []).filter(x => x.id !== entry.id);
  if (!log[currentDay].length) delete log[currentDay];
  saveLog();
  productDialog.close();
  renderToday();
  toast('Removed');
}

/* ================= food editor ================= */

const foodDialog = $('#food-dialog');
const foodForm = $('#food-form');
const fld = name => foodForm.elements.namedItem(name);
const PER100_KEYS = ['kcal', 'protein', 'carbs', 'sugar', 'fat', 'fiber', 'salt'];
let editingId = null;

function openFoodEditor(prefill = {}, hint = '') {
  foodForm.reset();
  editingId = prefill.id || null;
  const isExisting = !!(editingId && products[editingId]);

  $('#food-title').textContent = isExisting ? 'Edit food' : 'New food';
  $('#food-hint').textContent = hint;
  $('#food-hint').hidden = !hint;
  $('#food-delete').hidden = !isExisting;

  fld('name').value = prefill.name || '';
  fld('brand').value = prefill.brand || '';
  fld('barcode').value = prefill.barcode || '';
  fld('serving').value = prefill.serving ?? '';
  for (const k of PER100_KEYS) {
    const v = prefill.per100?.[k];
    fld(k).value = v == null ? '' : Math.round(v * 10) / 10;
  }
  foodDialog.showModal();
  setTimeout(() => (fld('name').value ? fld('kcal') : fld('name')).focus(), 50);
}

function submitFood(e) {
  e.preventDefault();
  const val = k => fld(k).value.trim();
  const barcode = val('barcode').replace(/\D/g, '');
  const prev = editingId ? products[editingId] : null;
  const id = editingId || barcode || 'custom-' + uid();

  const p = {
    ...(prev || {}),
    id,
    barcode,
    name: val('name'),
    brand: val('brand'),
    image: prev?.image || '',
    per100: Object.fromEntries(PER100_KEYS.map(k => [k, num(val(k))])),
    serving: num(val('serving')) || null,
    source: prev?.source === 'off' || prev?.source === 'off-edited' ? 'off-edited' : 'custom',
    updated: Date.now(),
  };
  products[id] = p;
  saveProducts();
  foodDialog.close();
  renderFoods();
  openProduct(p);
}

function deleteFood() {
  if (!editingId || !confirm('Delete this food from "My foods"? Your logged entries stay.')) return;
  delete products[editingId];
  saveProducts();
  foodDialog.close();
  renderFoods();
  toast('Food deleted');
}

/* ================= scanner ================= */

let scanner = null;
let scanning = false;

const setScanStatus = msg => { $('#scan-status').textContent = msg; };

function updateScanButton() {
  $('#scan-toggle').textContent = scanning ? 'Stop camera' : 'Start camera';
  $('#reader-placeholder').hidden = scanning;
}

async function startScanner() {
  if (scanning) return;
  const lib = window.__Html5QrcodeLibrary__;
  if (!lib) { setScanStatus('Scanner failed to load. You can still type the barcode below.'); return; }
  if (!window.isSecureContext) {
    setScanStatus('The camera only works over HTTPS (or on localhost). Type the barcode below instead.');
    return;
  }
  const F = lib.Html5QrcodeSupportedFormats;
  scanner ||= new lib.Html5Qrcode('reader', {
    formatsToSupport: [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128],
    experimentalFeatures: { useBarCodeDetectorIfSupported: true },
    verbose: false,
  });

  try {
    setScanStatus('Starting camera…');
    await scanner.start(
      { facingMode: 'environment' },
      {
        fps: 12,
        // Higher resolution + continuous focus: thin 1D barcode bars blur at the default ~480p.
        videoConstraints: {
          facingMode: 'environment',
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          advanced: [{ focusMode: 'continuous' }],
        },
        qrbox: (w, h) => ({
          width: Math.max(60, Math.floor(Math.min(w * 0.85, 360))),
          height: Math.max(60, Math.floor(Math.min(h * 0.45, 180))),
        }),
      },
      onScan,
      () => {} // called on every frame without a barcode – ignore
    );
    scanning = true;
    store.set('autoCamera', true);
    setScanStatus('Hold the barcode inside the box');
  } catch (err) {
    console.error(err);
    setScanStatus('Could not start the camera: ' + (err?.message || err));
  }
  updateScanButton();
}

async function stopScanner() {
  if (!scanner || !scanning) return;
  scanning = false;
  try { await scanner.stop(); } catch { /* already stopped */ }
  setScanStatus('');
  updateScanButton();
}

function onScan(text) {
  if (lookupBusy) return;
  navigator.vibrate?.(60);
  lookup(text);
}

/* ================= backup ================= */

function exportData() {
  const data = { app: 'nutriscan', version: 1, exported: new Date().toISOString(), goals, products, log };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `nutriscan-backup-${todayKey()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importData(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'nutriscan' || typeof data.log !== 'object' || typeof data.products !== 'object') {
      throw new Error('not a NutriScan backup');
    }
    if (!confirm('Replace ALL current data with this backup?')) return;
    goals = { ...DEFAULT_GOALS, ...data.goals };
    products = data.products;
    log = data.log;
    saveGoals(); saveProducts(); saveLog();
    toast('Backup restored');
    fillGoals();
  } catch (err) {
    toast('Import failed: ' + err.message);
  }
}

function clearData() {
  if (!confirm('Delete ALL foods, logs and goals on this device? This cannot be undone.')) return;
  goals = { ...DEFAULT_GOALS };
  products = {};
  log = {};
  saveGoals(); saveProducts(); saveLog();
  fillGoals();
  toast('All data deleted');
}

/* ================= wiring ================= */

function init() {
  $('#p-meal').innerHTML = MEALS.map(m => `<option>${m}</option>`).join('');

  // navigation (tab bar + any [data-goto] button)
  document.addEventListener('click', e => {
    const go = e.target.closest('[data-goto]');
    if (go) show(go.dataset.goto);
    const close = e.target.closest('[data-close]');
    if (close) close.closest('dialog').close();
  });

  // close dialogs when tapping the backdrop
  for (const d of [productDialog, foodDialog]) {
    d.addEventListener('click', e => { if (e.target === d) d.close(); });
  }

  // today
  $('#prev-day').addEventListener('click', () => { currentDay = addDays(currentDay, -1); renderToday(); });
  $('#next-day').addEventListener('click', () => {
    if (currentDay < todayKey()) { currentDay = addDays(currentDay, 1); renderToday(); }
  });
  $('#date-label').addEventListener('click', () => { currentDay = todayKey(); renderToday(); });
  $('#meals').addEventListener('click', e => {
    const li = e.target.closest('[data-entry]');
    if (!li) return;
    const entry = (log[currentDay] || []).find(x => x.id === li.dataset.entry);
    if (!entry) return;
    const saved = products[entry.productId];
    openProduct({
      id: entry.productId,
      name: entry.name,
      brand: entry.brand,
      barcode: saved?.barcode,
      image: saved?.image,
      serving: saved?.serving,
      per100: entry.per100,
    }, entry);
  });

  // scan
  $('#scan-toggle').addEventListener('click', () => (scanning ? stopScanner() : startScanner()));
  $('#manual-form').addEventListener('submit', e => {
    e.preventDefault();
    lookup($('#manual-code').value);
    $('#manual-code').value = '';
  });
  $('#new-food').addEventListener('click', () => openFoodEditor());
  $('#food-filter').addEventListener('input', renderFoods);
  $('#food-list').addEventListener('click', e => {
    const li = e.target.closest('[data-product]');
    if (li && products[li.dataset.product]) openProduct(products[li.dataset.product]);
  });

  // product sheet
  $('#add-form').addEventListener('submit', submitProduct);
  $('#p-grams').addEventListener('input', renderSheetTable);
  $('#p-chips').addEventListener('click', e => {
    const chip = e.target.closest('[data-g]');
    if (!chip) return;
    $('#p-grams').value = chip.dataset.g;
    renderSheetTable();
  });
  $('#p-delete').addEventListener('click', deleteEntry);
  $('#p-edit').addEventListener('click', () => {
    const p = products[sheet.product.id];
    productDialog.close();
    openFoodEditor(p);
  });

  // food editor
  foodForm.addEventListener('submit', submitFood);
  $('#food-delete').addEventListener('click', deleteFood);

  // history
  $('#history-list').addEventListener('click', e => {
    const li = e.target.closest('[data-day]');
    if (!li) return;
    currentDay = li.dataset.day;
    show('today');
  });

  // settings
  $('#goals-form').addEventListener('submit', e => {
    e.preventDefault();
    for (const k of Object.keys(DEFAULT_GOALS)) goals[k] = Math.max(0, Math.round(num($('#goal-' + k).value) || 0));
    saveGoals();
    toast('Goals saved');
  });
  $('#export-btn').addEventListener('click', exportData);
  $('#import-file').addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) importData(file);
    e.target.value = '';
  });
  $('#clear-btn').addEventListener('click', clearData);

  // stop the camera when the app goes to the background
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopScanner(); });

  // jump to the new day if the app is left open past midnight
  let lastToday = todayKey();
  setInterval(() => {
    const now = todayKey();
    if (now !== lastToday) {
      if (currentDay === lastToday) currentDay = now;
      lastToday = now;
      if ($('#view-today').classList.contains('active')) renderToday();
    }
  }, 60_000);

  renderToday();

  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* e.g. self-signed cert – app still works */ });
  }
}

init();
