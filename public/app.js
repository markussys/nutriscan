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

// `extra` rows are hidden in the nutrition table when the food has no value for them.
const NUTRIENTS = [
  { key: 'kcal', label: 'Calories', unit: 'kcal' },
  { key: 'protein', label: 'Protein', unit: 'g' },
  { key: 'carbs', label: 'Carbs', unit: 'g' },
  { key: 'sugar', label: 'of which sugars', unit: 'g', sub: true },
  { key: 'fat', label: 'Fat', unit: 'g' },
  { key: 'satfat', label: 'of which saturated', unit: 'g', sub: true, extra: true },
  { key: 'fiber', label: 'Fiber', unit: 'g' },
  { key: 'salt', label: 'Salt', unit: 'g' },
  { key: 'sodium', label: 'Sodium', unit: 'mg', extra: true },
  { key: 'potassium', label: 'Potassium', unit: 'mg', extra: true },
  { key: 'cholesterol', label: 'Cholesterol', unit: 'mg', extra: true },
  { key: 'creatine', label: 'Creatine (est.)', unit: 'g', extra: true },
];
// Shown in the "More nutrients" panel on Today. `goal` = key in goals, `limit` = staying under is the aim.
const EXTRAS = [
  { key: 'sugar', label: 'Sugars', unit: 'g' },
  { key: 'satfat', label: 'Saturated fat', unit: 'g' },
  { key: 'fiber', label: 'Fiber', unit: 'g', goal: 'fiber' },
  { key: 'sodium', label: 'Sodium', unit: 'mg', goal: 'sodium', limit: true },
  { key: 'potassium', label: 'Potassium', unit: 'mg' },
  { key: 'cholesterol', label: 'Cholesterol', unit: 'mg' },
  { key: 'creatine', label: 'Creatine (est.)', unit: 'g', goal: 'creatine', noMissing: true },
];
// Typical creatine content of raw meat/fish, g per 100 g (cooking loses roughly 10–30 %).
// `re` is matched against Open Food Facts category tags to auto-estimate plain meat and fish.
const CREATINE_EST = [
  { label: 'Sausage / ham / deli meat', v: 0.25, re: /sausage|\bhams?\b|salami|frankfurter|prepared-meat|cold-cut/ },
  { label: 'Herring / sprats', v: 0.7, re: /herring|sprat/ },
  { label: 'Salmon / trout', v: 0.45, re: /salmon|trout/ },
  { label: 'Tuna', v: 0.4, re: /tuna/ },
  { label: 'Cod / white fish', v: 0.3, re: /\bcod|pollock|hake|white-fish/ },
  { label: 'Pork', v: 0.5, re: /pork/ },
  { label: 'Beef / veal / lamb', v: 0.45, re: /beef|veal|lamb|mutton/ },
  { label: 'Chicken / turkey', v: 0.35, re: /chicken|turkey|poultr/ },
];
const MACROS = [
  { key: 'protein', label: 'Protein', color: 'var(--protein)' },
  { key: 'carbs', label: 'Carbs', color: 'var(--carbs)' },
  { key: 'fat', label: 'Fat', color: 'var(--fat)' },
];
const MEALS = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'];
const DEFAULT_GOALS = { kcal: 2000, protein: 120, carbs: 220, fat: 70, fiber: 30, sodium: 2300, creatine: 0 };

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
let recipes = store.get('recipes', {});   // id -> saved meal { name, items: [{ productId, name, per100, grams }], cooked }

const saveGoals = () => store.set('goals', goals);
const saveProducts = () => store.set('products', products);
const saveLog = () => store.set('log', log);
const saveRecipes = () => store.set('recipes', recipes);

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

// A per-100 g value, deriving sodium from salt (salt = sodium × 2.5) for foods saved before sodium existed.
function nval(per100, key) {
  const v = per100?.[key];
  if (v != null) return v;
  if (key === 'sodium' && per100?.salt != null) return per100.salt * 400;
  return null;
}

function totals(entries) {
  const t = Object.fromEntries(NUTRIENTS.map(n => [n.key, 0]));
  for (const e of entries) {
    for (const n of NUTRIENTS) t[n.key] += (nval(e.per100, n.key) || 0) * (e.grams || 0) / 100;
  }
  return t;
}

// per-100 g values of a mixture; null for nutrients no ingredient has data for
function combinedPer100(items, weight) {
  const t = totals(items);
  return Object.fromEntries(NUTRIENTS.map(n => [n.key,
    weight > 0 && items.some(i => nval(i.per100, n.key) != null) ? t[n.key] / weight * 100 : null]));
}

function guessCreatine(tags) {
  const s = (tags || []).join(' ');
  if (!/en:(meats|fishes|poultries|seafood)\b/.test(s) || /en:(meals|meat-analogues|plant-based)/.test(s)) return null;
  return CREATINE_EST.find(c => c.re.test(s))?.v ?? null;
}

/* ================= Open Food Facts ================= */

const OFF_FIELDS = [
  'code', 'product_name', 'product_name_en', 'product_name_lv', 'generic_name',
  'brands', 'image_front_small_url', 'image_front_url', 'nutriments', 'serving_quantity', 'categories_tags',
].join(',');
const mg = v => { const x = num(v); return x == null ? null : x * 1000; }; // OFF stores minerals in g

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
  const sodium = mg(n.sodium_100g);
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
      satfat: num(n['saturated-fat_100g']),
      fiber: num(n.fiber_100g),
      salt: num(n.salt_100g) ?? (sodium == null ? null : sodium / 400),
      sodium,
      potassium: mg(n.potassium_100g),
      cholesterol: mg(n.cholesterol_100g),
      creatine: guessCreatine(p.categories_tags),
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
    renderRecipes();
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

  renderExtras(entries, t);

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
              <div class="muted small">${fmt(e.grams)} g${e.items ? ` · meal of ${e.items.length} food${e.items.length > 1 ? 's' : ''}` : ''}${e.brand ? ' · ' + esc(e.brand) : ''}</div>
            </div>
            <div class="kcal">${fmt((e.per100.kcal || 0) * e.grams / 100, 'kcal')}<small> kcal</small></div>
          </li>`).join('')}
        </ul>
      </div>`;
  }).join('');
}

function renderExtras(entries, t) {
  const row = x => {
    const goal = x.goal ? goals[x.goal] : 0;
    const v = t[x.key];
    const over = x.limit && goal > 0 && v > goal;
    const missing = x.noMissing ? 0 : entries.filter(e => nval(e.per100, x.key) == null).length;
    const noData = missing > 0 && missing === entries.length;
    return `
      <div class="extra">
        <div class="extra-head">
          <span>${x.label}</span>
          <span><b class="${over ? 'over' : ''}">${noData ? '–' : fmt(v)}</b>${goal > 0 ? ` / ${goal}` : ''} ${x.unit}${
            x.key === 'sodium' ? ` <span class="muted small">(${fmt(v / 400)} g salt)</span>` : ''}${
            missing && !noData ? ` <span class="muted small">· ${missing} without data</span>` : ''}</span>
        </div>
        ${goal > 0 ? `<div class="bar${over ? ' over' : ''}"><div style="width:${pct(v, goal)}%"></div></div>` : ''}
      </div>`;
  };
  $('#extras-list').innerHTML = EXTRAS.map(row).join('');
  $('#extras-preview').textContent = `Sodium ${fmt(t.sodium)} mg · Creatine ${fmt(t.creatine)} g`;
}

/* ---------- my foods ---------- */

const thumb = p => p.image
  ? `<img class="thumb" src="${esc(p.image)}" alt="" loading="lazy">`
  : `<div class="thumb ph">${esc((p.name || '?').charAt(0).toUpperCase())}</div>`;

function foodListHTML(q) {
  q = q.trim().toLowerCase();
  const list = Object.values(products)
    .filter(p => !q || `${p.name} ${p.brand || ''} ${p.barcode || ''}`.toLowerCase().includes(q))
    .sort((a, b) => (b.lastUsed || b.updated || 0) - (a.lastUsed || a.updated || 0));

  return list.length
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

function renderFoods() {
  $('#food-list').innerHTML = foodListHTML($('#food-filter').value);
}

/* ---------- my meals ---------- */

// Ingredients follow later edits to the food; the stored copy is only a fallback if the food was deleted.
function freshItem(it) {
  const p = products[it.productId];
  return p
    ? { productId: p.id, name: p.name, brand: p.brand || '', per100: { ...p.per100 }, grams: it.grams }
    : { ...it, per100: { ...it.per100 } };
}

function renderRecipes() {
  const list = Object.values(recipes)
    .sort((a, b) => (b.lastUsed || b.updated || 0) - (a.lastUsed || a.updated || 0));
  $('#recipe-list').innerHTML = list.length
    ? list.map(r => {
        const items = r.items.map(freshItem);
        const raw = items.reduce((s, i) => s + (i.grams || 0), 0);
        return `
          <li data-recipe="${esc(r.id)}">
            <div class="thumb ph">${esc((r.name || '?').charAt(0).toUpperCase())}</div>
            <div class="grow">
              <div class="name">${esc(r.name)}</div>
              <div class="muted small">${items.length} food${items.length > 1 ? 's' : ''} · ${fmt(r.cooked || raw)} g</div>
            </div>
            <div class="kcal">${fmt(totals(items).kcal, 'kcal')}<small> kcal</small></div>
          </li>`;
      }).join('')
    : '<li class="empty">Combine your foods into a meal you can log in one go.</li>';
}

/* ---------- history ---------- */

function renderHistory() {
  const today = todayKey();
  const last7 = Array.from({ length: 7 }, (_, i) => addDays(today, -i)).filter(k => log[k]?.length);

  if (last7.length) {
    const t = totals(last7.flatMap(k => log[k]));
    const avg = k => t[k] / last7.length;
    $('#history-avg').innerHTML = `Average per logged day (${last7.length} day${last7.length > 1 ? 's' : ''}):<br>
      <b>${fmt(avg('kcal'), 'kcal')} kcal</b> · P ${fmt(avg('protein'))} g · C ${fmt(avg('carbs'))} g · F ${fmt(avg('fat'))} g<br>
      <span class="small">Fiber ${fmt(avg('fiber'))} g · Sodium ${fmt(avg('sodium'))} mg · Creatine ${fmt(avg('creatine'))} g</span>`;
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
  $('#p-table').innerHTML = `
    <thead><tr><th></th><th>per 100 g</th><th>${fmt(g)} g</th></tr></thead>
    <tbody>${nutriRows(sheet.product.per100, [100, g])}</tbody>`;
}

// one column per amount in grams; the last column is bold
function nutriRows(per100, amounts) {
  return NUTRIENTS.filter(n => !n.extra || nval(per100, n.key) != null).map(n => {
    const v = nval(per100, n.key);
    const cells = amounts.map((g, i) => {
      const c = v == null ? '–' : `${fmt(v * g / 100, n.unit)} ${n.unit}`;
      return `<td>${i === amounts.length - 1 ? `<b>${c}</b>` : c}</td>`;
    });
    return `
      <tr class="${n.sub ? 'sub' : ''} ${n.key === 'kcal' ? 'nutri-kcal' : ''}">
        <td>${n.label}</td>${cells.join('')}
      </tr>`;
  }).join('');
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

function removeEntry(id, dialog) {
  log[currentDay] = (log[currentDay] || []).filter(x => x.id !== id);
  if (!log[currentDay].length) delete log[currentDay];
  saveLog();
  dialog.close();
  renderToday();
  toast('Removed');
}

/* ================= food editor ================= */

const foodDialog = $('#food-dialog');
const foodForm = $('#food-form');
const fld = name => foodForm.elements.namedItem(name);
const PER100_KEYS = NUTRIENTS.map(n => n.key);
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
    const v = nval(prefill.per100, k);
    fld(k).value = v == null ? '' : Math.round(v * 100) / 100;
  }
  $('#creatine-guess').value = '';
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

/* ================= meal builder ================= */

const mealDialog = $('#meal-dialog');
const pickDialog = $('#pick-dialog');
// { recipeId, entry?, items, frac }: frac = share of the dish eaten, kept when ingredient amounts change
let ms = null;

const rawWeight = () => ms.items.reduce((s, i) => s + (i.grams || 0), 0);
const mealWeight = () => num($('#m-cooked').value) || rawWeight();

function openMeal({ recipe = null, entry = null } = {}) {
  const src = entry || recipe;
  ms = {
    recipeId: entry ? entry.recipeId || null : recipe?.id || null,
    entry,
    // a logged meal keeps its own snapshot; a saved meal picks up edits made to its foods
    items: (src?.items || []).map(it => entry ? { ...it, per100: { ...it.per100 } } : freshItem(it)),
  };
  $('#meal-title').textContent = entry ? 'Logged meal' : recipe ? 'Saved meal' : 'New meal';
  $('#m-name').value = src?.name || '';
  $('#m-cooked').value = src?.cooked || '';
  $('#m-meal').value = entry ? entry.meal : guessMeal();
  const w = mealWeight();
  ms.frac = entry && w > 0 ? entry.grams / w : 1;
  $('#m-grams').value = entry ? Math.round(entry.grams) : Math.round(w) || '';

  $('#m-submit').textContent = entry ? 'Save' : 'Add to log';
  $('#m-delete').textContent = entry ? 'Remove' : 'Delete meal';
  $('#m-save').hidden = !!entry;
  renderMealItems();
  updateMealButtons();
  mealDialog.showModal();
  if (!src) setTimeout(() => $('#m-name').focus(), 50);
}

function updateMealButtons() {
  $('#m-delete').hidden = !ms.entry && !recipes[ms.recipeId];
}

const itemKcal = it => fmt((it.per100.kcal || 0) * (it.grams || 0) / 100, 'kcal');

function renderMealItems() {
  $('#m-items').innerHTML = ms.items.length
    ? ms.items.map((it, i) => `
        <li data-i="${i}">
          <div class="grow">
            <div class="name">${esc(it.name)}</div>
            <div class="muted small"><span data-kcal>${itemKcal(it)}</span> kcal</div>
          </div>
          <input class="grams" type="number" min="0" step="any" inputmode="decimal" value="${it.grams}" aria-label="Grams of ${esc(it.name)}">
          <span class="muted small">g</span>
          <button type="button" class="icon-btn x" data-remove aria-label="Remove ${esc(it.name)}">&times;</button>
        </li>`).join('')
    : '<li class="empty">Add foods from your list to build this meal.</li>';
  renderMealTable();
}

// ingredient amounts or cooked weight changed: keep the eaten share, update the grams
function mealWeightChanged() {
  const w = mealWeight();
  if (w > 0) $('#m-grams').value = Math.round(ms.frac * w);
  renderMealTable();
}

function renderMealTable() {
  const w = mealWeight();
  const raw = rawWeight();
  const eaten = num($('#m-grams').value) || 0;
  const cooked = num($('#m-cooked').value);
  $('#m-weight').textContent = !ms.items.length ? ''
    : cooked ? `Ingredients add up to ${fmt(raw)} g raw; nutrients are spread over the ${fmt(cooked)} g cooked weight.`
    : `Ingredients add up to ${fmt(raw)} g.`;
  $('#m-table').innerHTML = ms.items.length ? `
    <thead><tr><th></th><th>whole<br>${fmt(w)} g</th><th>eaten<br>${fmt(eaten)} g</th></tr></thead>
    <tbody>${nutriRows(combinedPer100(ms.items, w), [w, eaten])}</tbody>` : '';
}

function mealSnapshot() {
  return ms.items.map(({ productId, name, brand, per100, grams }) => ({ productId, name, brand, per100: { ...per100 }, grams }));
}

function saveRecipe() {
  const name = $('#m-name').value.trim();
  if (!name) { toast('Give the meal a name'); $('#m-name').focus(); return false; }
  if (!ms.items.length) { toast('Add at least one food'); return false; }
  const id = ms.recipeId || 'meal-' + uid();
  recipes[id] = {
    id,
    name,
    items: mealSnapshot(),
    cooked: num($('#m-cooked').value) || null,
    updated: Date.now(),
    lastUsed: recipes[id]?.lastUsed,
  };
  ms.recipeId = id;
  saveRecipes();
  renderRecipes();
  updateMealButtons();
  return true;
}

function submitMeal(e) {
  e.preventDefault();
  if (!ms.items.length) { toast('Add at least one food'); return; }
  const grams = num($('#m-grams').value);
  if (!(grams > 0)) { toast('Enter how much you ate'); return; }
  const w = mealWeight();
  const name = $('#m-name').value.trim();

  // a brand-new meal with a name is saved for next time; tweaks to a saved meal only affect this log entry
  if (!ms.entry && !ms.recipeId && name) saveRecipe();
  if (recipes[ms.recipeId]) { recipes[ms.recipeId].lastUsed = Date.now(); saveRecipes(); }

  const data = {
    recipeId: ms.recipeId,
    name: name || 'Meal',
    brand: '',
    items: mealSnapshot(),
    cooked: num($('#m-cooked').value) || null,
    per100: combinedPer100(ms.items, w),
    grams,
    meal: $('#m-meal').value,
  };
  if (ms.entry) {
    Object.assign(ms.entry, data);
    toast('Updated');
  } else {
    (log[currentDay] ||= []).push({ id: uid(), ...data, t: Date.now() });
    toast(`Added ${data.name} · ${fmt(data.per100.kcal * grams / 100, 'kcal')} kcal`);
  }
  saveLog();
  mealDialog.close();
  show('today');
}

function deleteMeal() {
  if (ms.entry) { removeEntry(ms.entry.id, mealDialog); return; }
  if (!confirm('Delete this saved meal? Days you already logged it on stay as they are.')) return;
  delete recipes[ms.recipeId];
  saveRecipes();
  mealDialog.close();
  renderRecipes();
  toast('Meal deleted');
}

function openPicker() {
  $('#pick-filter').value = '';
  $('#pick-list').innerHTML = foodListHTML('');
  pickDialog.showModal();
}

function pickFood(p) {
  const old = mealWeight();
  ms.items.push({ productId: p.id, name: p.name, brand: p.brand || '', per100: { ...p.per100 }, grams: p.serving || 100 });
  pickDialog.close();
  if (!(old > 0)) ms.frac = 1; // first ingredient: default to eating the whole thing
  renderMealItems();
  mealWeightChanged();
  const inputs = $$('#m-items input.grams');
  inputs.at(-1)?.select();
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
  const data = { app: 'nutriscan', version: 1, exported: new Date().toISOString(), goals, products, recipes, log };
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
    recipes = data.recipes || {};
    log = data.log;
    saveGoals(); saveProducts(); saveRecipes(); saveLog();
    toast('Backup restored');
    fillGoals();
  } catch (err) {
    toast('Import failed: ' + err.message);
  }
}

function clearData() {
  if (!confirm('Delete ALL foods, meals, logs and goals on this device? This cannot be undone.')) return;
  goals = { ...DEFAULT_GOALS };
  products = {};
  recipes = {};
  log = {};
  saveGoals(); saveProducts(); saveRecipes(); saveLog();
  fillGoals();
  toast('All data deleted');
}

/* ================= wiring ================= */

function init() {
  const mealOptions = MEALS.map(m => `<option>${m}</option>`).join('');
  $('#p-meal').innerHTML = mealOptions;
  $('#m-meal').innerHTML = mealOptions;
  $('#creatine-guess').innerHTML = '<option value="">Pick meat or fish…</option>' +
    CREATINE_EST.map(c => `<option value="${c.v}">${c.label} · ${c.v} g</option>`).join('');

  // navigation (tab bar + any [data-goto] button)
  document.addEventListener('click', e => {
    const go = e.target.closest('[data-goto]');
    if (go) show(go.dataset.goto);
    const close = e.target.closest('[data-close]');
    if (close) close.closest('dialog').close();
  });

  // close dialogs when tapping the backdrop
  for (const d of [productDialog, foodDialog, mealDialog, pickDialog]) {
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
    if (entry.items) { openMeal({ entry }); return; }
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
  $('#new-meal').addEventListener('click', () => openMeal());
  $('#recipe-list').addEventListener('click', e => {
    const li = e.target.closest('[data-recipe]');
    if (li && recipes[li.dataset.recipe]) openMeal({ recipe: recipes[li.dataset.recipe] });
  });
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
  $('#p-delete').addEventListener('click', () => removeEntry(sheet.entry.id, productDialog));
  $('#p-edit').addEventListener('click', () => {
    const p = products[sheet.product.id];
    productDialog.close();
    openFoodEditor(p);
  });

  // food editor
  foodForm.addEventListener('submit', submitFood);
  $('#food-delete').addEventListener('click', deleteFood);
  fld('salt').addEventListener('input', () => {
    const v = num(fld('salt').value);
    fld('sodium').value = v == null ? '' : Math.round(v * 400);
  });
  fld('sodium').addEventListener('input', () => {
    const v = num(fld('sodium').value);
    fld('salt').value = v == null ? '' : Math.round(v / 4) / 100;
  });
  $('#creatine-guess').addEventListener('change', e => { if (e.target.value) fld('creatine').value = e.target.value; });

  // meal builder
  $('#meal-form').addEventListener('submit', submitMeal);
  $('#m-add').addEventListener('click', openPicker);
  $('#m-save').addEventListener('click', () => { if (saveRecipe()) toast('Meal saved'); });
  $('#m-delete').addEventListener('click', deleteMeal);
  $('#m-items').addEventListener('input', e => {
    const li = e.target.closest('[data-i]');
    if (!li || !e.target.matches('input.grams')) return;
    const it = ms.items[li.dataset.i];
    it.grams = num(e.target.value) || 0;
    $('[data-kcal]', li).textContent = itemKcal(it);
    mealWeightChanged();
  });
  $('#m-items').addEventListener('click', e => {
    const li = e.target.closest('[data-i]');
    if (!li || !e.target.closest('[data-remove]')) return;
    ms.items.splice(Number(li.dataset.i), 1);
    renderMealItems();
    mealWeightChanged();
  });
  $('#m-cooked').addEventListener('input', mealWeightChanged);
  $('#m-grams').addEventListener('input', () => {
    const w = mealWeight();
    ms.frac = w > 0 ? (num($('#m-grams').value) || 0) / w : 1;
    renderMealTable();
  });
  $('#m-chips').addEventListener('click', e => {
    const chip = e.target.closest('[data-f]');
    if (!chip) return;
    ms.frac = Number(chip.dataset.f);
    mealWeightChanged();
  });
  $('#pick-filter').addEventListener('input', e => { $('#pick-list').innerHTML = foodListHTML(e.target.value); });
  $('#pick-list').addEventListener('click', e => {
    const li = e.target.closest('[data-product]');
    if (li && products[li.dataset.product]) pickFood(products[li.dataset.product]);
  });

  // today: remember whether "More nutrients" is open
  const extras = $('#extras');
  extras.open = store.get('extrasOpen', false);
  extras.addEventListener('toggle', () => store.set('extrasOpen', extras.open));

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
    for (const k of Object.keys(DEFAULT_GOALS)) goals[k] = Math.max(0, Math.round((num($('#goal-' + k).value) || 0) * 10) / 10);
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
