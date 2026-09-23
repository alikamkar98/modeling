import { fetchWeather, manualWeather, requirementsFrom, climateWeather, PLACES } from './weather.js';
import { resolveOccasion, OCCASIONS, OCCASION_ORDER } from './occasions.js';
import { loadMoods, saveMoods, allMoods, extractPalette, moodFromPalette } from './moods.js';
import { suggestOutfits } from './outfits.js';
import { renderCollage, composeCollage } from './collage.js';
import { retiredIds, toggleRetired, activeItems } from './retired.js';

const state = {
  wardrobe: [],
  isDemo: false,
  weather: null,
  lastDestination: '',
  closetFilter: 'all',
  // Every outfit the engine ranked for the current request, and which slice of
  // them is on screen. Paging through a stored list rather than re-running the
  // engine is what lets "back" return the *same* outfits rather than a fresh
  // set that happens to score similarly.
  ranked: [],
  page: 0,
  place: 'linz',
  date: new Date().toISOString().slice(0, 10),
  moods: loadMoods(),
};

const PER_PAGE = 3;

const $ = (sel) => document.querySelector(sel);

/* ---------------------------------------------------------------- data -- */

async function loadWardrobe() {
  try {
    const res = await fetch('data/wardrobe.json', { cache: 'no-store' });
    const data = await res.json();
    if (data.items?.length) return { items: data.items, isDemo: false };
  } catch {
    // fall through to the demo set
  }
  try {
    const res = await fetch('data/demo-wardrobe.json', { cache: 'no-store' });
    const data = await res.json();
    return { items: data.items ?? [], isDemo: true };
  } catch {
    return { items: [], isDemo: false };
  }
}

/* ------------------------------------------------------------- weather -- */

function renderWeather() {
  const el = $('#weather');
  const w = state.weather;

  if (!w) {
    el.className = 'weather weather--manual';
    el.innerHTML = `
      <span class="weather__desc">No weather for ${PLACES[state.place].name}.</span>
      <span class="weather__meta">Pick roughly how it feels outside:</span>
      <span class="chips" id="manual-weather">
        ${['cold', 'cool', 'mild', 'warm', 'hot']
          .map((k) => `<button class="chip" data-manual="${k}">${k}</button>`).join('')}
      </span>`;
    el.querySelectorAll('[data-manual]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.weather = manualWeather(btn.dataset.manual, PLACES[state.place]);
        renderWeather();
        if (state.lastDestination) suggest(state.lastDestination);
      });
    });
    return;
  }

  const flags = [];
  const req = requirementsFrom(w);
  if (req.needsRainProtection) flags.push('rain likely');
  if (req.needsWindLayer) flags.push('windy');
  if (req.needsSnowFootwear) flags.push('snow');

  el.className = `weather${w.source === 'manual' ? ' weather--manual' : ''}`;
  el.innerHTML = `
    <span class="weather__temp">${Math.round(w.temperature)}°C</span>
    <span class="weather__desc">${w.description} · ${w.place}${w.date ? `, ${w.date}` : ''}</span>
    <span class="weather__meta">feels like ${Math.round(w.feelsLike)}°${
      w.high != null ? ` · ${Math.round(w.low)}–${Math.round(w.high)}°` : ''}</span>
    ${flags.length ? `<span class="weather__flag">${flags.join(' · ')}</span>` : ''}
    ${{ manual: 'set by hand', climate: 'climate average — no live forecast here', checked: 'looked up for this trip' }[w.source]
      ? `<span class="weather__meta">(${{ manual: 'set by hand', climate: 'climate average — no live forecast here', checked: 'looked up for this trip' }[w.source]})</span>` : ''}
    <span class="chips weather__adjust">
      ${['colder', 'warmer', w.precipitationProbability >= 40 ? 'dry' : 'rain']
        .map((k) => `<button class="chip" data-adjust="${k}">${k}</button>`).join('')}
    </span>`;
  el.querySelectorAll('[data-adjust]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.adjust;
      const w2 = { ...state.weather };
      if (k === 'colder' || k === 'warmer') {
        const d = k === 'colder' ? -3 : 3;
        w2.temperature += d; w2.feelsLike += d;
      } else {
        w2.precipitationProbability = k === 'rain' ? 80 : 0;
      }
      state.weather = w2;
      renderWeather();
      rerun();
    });
  });
}

async function loadWeather() {
  const place = PLACES[state.place];
  const today = new Date().toISOString().slice(0, 10);
  const days = (new Date(state.date) - new Date(today)) / 864e5;
  $('#weather').innerHTML = `<span class="weather__loading">Checking ${place.name}…</span>`;
  try {
    if (days < 0 || days > 15) throw new Error('out of forecast range');
    state.weather = await fetchWeather(place, { date: days === 0 ? null : state.date, timeoutMs: 5000 });
  } catch {
    // No network (or too far out): the month's climate, or a day looked up
    // for this trip, is still far better than no weather at all.
    state.weather = climateWeather(place, state.date);
  }
  renderWeather();
  rerun();
}

function rerun() {
  if (state.lastDestination) suggest(state.lastDestination);
}

function activeMood() {
  return allMoods(state.moods).find((m) => m.id === state.moods.active) ?? null;
}

/* ------------------------------------------------------------- results -- */

function thumb(item) {
  const src = item.cutout || item.image;
  if (src) return `<img src="${src}" alt="${item.name}" loading="lazy">`;
  return `<span class="item__swatch" style="background:${item.hex}"></span>`;
}

function outfitCard(outfit, index, offset) {
  const items = outfit.items;
  const number = String(offset + index + 1).padStart(2, '0');
  return `
    <article class="outfit">
      <div class="outfit__figure" data-outfit="${index}">${renderCollage(items, { id: index })}</div>
      <div>
        <p class="outfit__rank">${number} · ${outfit.name ?? ''}</p>
        <p class="outfit__why">${outfit.rationale.join(' · ')}</p>
        ${outfit.warnings.length
          ? `<p class="outfit__warn">⚠ ${outfit.warnings.join(' · ')}</p>` : ''}
        <ul class="items">
          ${items.map((i) => `
            <li class="item">
              <span class="item__thumb">${thumb(i)}</span>
              <span class="item__name">${i.name}</span>
            </li>`).join('')}
        </ul>
        <div class="palette" aria-hidden="true">
          ${items.map((i) => `<span style="background:${i.hex}"></span>`).join('')}
        </div>
      </div>
    </article>`;
}

function suggest(destination) {
  state.lastDestination = destination;
  const results = $('#results');

  if (!state.wardrobe.length) {
    results.innerHTML = `<div class="notice">
      <strong>No clothes yet.</strong>
      <p class="muted">The wardrobe catalog is empty, so there is nothing to build an outfit from.</p>
    </div>`;
    return;
  }

  const { key, confident } = resolveOccasion(destination);
  const profile = OCCASIONS[key];
  const req = state.weather ? requirementsFrom(state.weather) : null;
  const available = activeItems(state.wardrobe);
  const result = suggestOutfits(available, key, req, { count: 30, mood: activeMood() });
  document.querySelectorAll('#quick [data-pick]').forEach((b) => b.classList.toggle('is-on', b.dataset.pick === key));

  const header = confident
    ? `<p class="muted">${profile.label} — ${profile.note}</p>`
    : `<p class="muted">I don't recognise “${destination}”, so I've treated it as everyday wear.
       Pick one of the buttons above if that's wrong.</p>`;

  // Count only what the wearer chose to retire. Duplicate photos are also
  // excluded, but they aren't clothes being held back — saying so would
  // misreport the wardrobe.
  const retired = retiredIds();
  const retiredCount = state.wardrobe.filter((i) => retired.has(i.id) && !i.duplicateOf).length;
  const retiredNote = retiredCount
    ? `<p class="muted">${retiredCount} retired item${retiredCount === 1 ? '' : 's'} left out — bring ${retiredCount === 1 ? 'it' : 'them'} back under My clothes.</p>`
    : '';

  if (!result.ok) {
    results.innerHTML = `${header}${retiredNote}
      <div class="notice">
        <strong>I can't put a full outfit together for that.</strong>
        <ul>${result.missing.map((m) => `<li>${m}</li>`).join('')}</ul>
      </div>`;
    return;
  }

  state.ranked = result.outfits;
  state.page = 0;
  state.header = header + retiredNote;
  renderPage();
}

/** Draw the current page of outfits, plus the controls to move between pages. */
function renderPage() {
  const results = $('#results');
  const total = state.ranked.length;
  const start = state.page * PER_PAGE;
  const shown = state.ranked.slice(start, start + PER_PAGE);
  const hasPrev = state.page > 0;
  const hasNext = start + PER_PAGE < total;

  results.innerHTML = state.header
    + shown.map((o, i) => outfitCard(o, i, start)).join('')
    + `<div class="pager">
         <button class="btn" id="pager-prev" ${hasPrev ? '' : 'disabled'}>← Previous</button>
         <span class="pager__count">${start + 1}–${Math.min(start + PER_PAGE, total)} of ${total}</span>
         <button class="btn btn--primary" id="pager-next" ${hasNext ? '' : 'disabled'}>Show me others →</button>
       </div>`;

  results.querySelectorAll('[data-outfit]').forEach((host) => {
    composeCollage(host.querySelector('.collage'), shown[Number(host.dataset.outfit)].items);
  });

  $('#pager-prev').addEventListener('click', () => {
    if (state.page > 0) { state.page--; renderPage(); scrollToResults(); }
  });
  $('#pager-next').addEventListener('click', () => {
    if ((state.page + 1) * PER_PAGE < total) { state.page++; renderPage(); scrollToResults(); }
  });
}

function scrollToResults() {
  $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* -------------------------------------------------------------- closet -- */

function renderCloset() {
  const status = $('#closet-status');
  const grid = $('#closet');

  if (!state.wardrobe.length) {
    status.textContent = 'No clothes catalogued yet.';
    grid.innerHTML = '';
    return;
  }

  status.textContent = state.isDemo
    ? 'Showing placeholder clothes — these are not yours.'
    : `${state.wardrobe.length} items in your wardrobe`;

  const cats = ['all', ...new Set(state.wardrobe.map((i) => i.category))];
  $('#closet-filters').innerHTML = cats
    .map((c) => `<button class="chip${c === state.closetFilter ? ' is-on' : ''}" data-cat="${c}">${c}</button>`)
    .join('');
  $('#closet-filters').querySelectorAll('[data-cat]').forEach((btn) => {
    btn.addEventListener('click', () => { state.closetFilter = btn.dataset.cat; renderCloset(); });
  });

  const shown = state.closetFilter === 'all'
    ? state.wardrobe
    : state.wardrobe.filter((i) => i.category === state.closetFilter);

  const retired = retiredIds();
  grid.innerHTML = shown.map((i) => `
    <div class="card${retired.has(i.id) ? ' card--retired' : ''}">
      <div class="card__media">${thumb(i)}</div>
      <div class="card__body">
        <div class="card__name">${i.name}</div>
        <div class="card__meta">${i.category} · warmth ${i.warmth} · ${i.style ?? '—'}</div>
        ${i.duplicateOf ? '<div class="card__meta">duplicate photo — not suggested</div>' : ''}
        ${i.duplicateOf ? '' : `<button class="card__retire" data-retire="${i.id}">
          ${retired.has(i.id) ? 'Bring back' : 'Never suggest'}
        </button>`}
      </div>
    </div>`).join('');

  grid.querySelectorAll('[data-retire]').forEach((btn) => {
    btn.addEventListener('click', () => {
      toggleRetired(btn.dataset.retire);
      renderCloset();
      if (state.lastDestination) suggest(state.lastDestination);
    });
  });
}

/* ---------------------------------------------------------------- moods -- */

function renderMoods() {
  const moods = allMoods(state.moods);
  $('#mood-pick').innerHTML = '<option value="">No mood board</option>'
    + moods.map((m) => `<option value="${m.id}"${m.id === state.moods.active ? ' selected' : ''}>${m.label}</option>`).join('');

  $('#moods').innerHTML = moods.map((m) => `
    <div class="mood${m.id === state.moods.active ? ' is-on' : ''}">
      <button class="mood__pick" data-mood="${m.id}">
        <span class="mood__swatches">${m.palette.map((h) => `<span style="background:${h}"></span>`).join('')}</span>
        <span class="mood__label">${m.label}</span>
      </button>
      ${m.photos?.length ? `<div class="mood__photos">${m.photos.map((p) => `<img src="${p}" alt="">`).join('')}</div>` : ''}
      ${m.custom ? `<button class="card__retire" data-mood-del="${m.id}">Delete</button>` : ''}
    </div>`).join('');

  $('#moods').querySelectorAll('[data-mood]').forEach((btn) => btn.addEventListener('click', () => {
    state.moods.active = state.moods.active === btn.dataset.mood ? null : btn.dataset.mood;
    saveMoods(state.moods); renderMoods(); rerun();
  }));
  $('#moods').querySelectorAll('[data-mood-del]').forEach((btn) => btn.addEventListener('click', () => {
    state.moods.custom = state.moods.custom.filter((m) => m.id !== btn.dataset.moodDel);
    if (state.moods.active === btn.dataset.moodDel) state.moods.active = null;
    saveMoods(state.moods); renderMoods(); rerun();
  }));
}

/** Shrink a photo, keep a small thumbnail, and sample its pixels. */
function readPhoto(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = 160 / Math.max(img.width, img.height);
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * scale));
      c.height = Math.max(1, Math.round(img.height * scale));
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve({ thumb: c.toDataURL('image/jpeg', 0.7), data: ctx.getImageData(0, 0, c.width, c.height).data });
    };
    img.onerror = reject;
    img.src = url;
  });
}

function wireMoodForm() {
  $('#mood-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const files = [...$('#mood-files').files].slice(0, 8);
    if (!files.length) return;
    const photos = await Promise.all(files.map(readPhoto));
    // One palette for the whole board: sample all photos together.
    const merged = new Uint8ClampedArray(photos.reduce((n, p) => n + p.data.length, 0));
    let o = 0;
    for (const p of photos) { merged.set(p.data, o); o += p.data.length; }
    const id = `custom-${Date.now()}`;
    const mood = moodFromPalette(id, $('#mood-name').value.trim() || 'My board', extractPalette(merged, 6));
    mood.photos = photos.map((p) => p.thumb);
    state.moods.custom.push(mood);
    state.moods.active = id;
    saveMoods(state.moods);
    $('#mood-form').reset();
    renderMoods();
    rerun();
  });
}

/* ---------------------------------------------------------------- init -- */

function wireTabs() {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => {
        const on = t === tab;
        t.classList.toggle('is-active', on);
        t.setAttribute('aria-selected', String(on));
      });
      $('#tab-suggest').classList.toggle('is-hidden', tab.dataset.tab !== 'suggest');
      $('#tab-closet').classList.toggle('is-hidden', tab.dataset.tab !== 'closet');
      $('#tab-mood').classList.toggle('is-hidden', tab.dataset.tab !== 'mood');
    });
  });
}

function wireAsk() {
  $('#quick').innerHTML = OCCASION_ORDER
    .map((k) => `<button class="chip" data-pick="${k}">${OCCASIONS[k].label}</button>`).join('');
  $('#quick').querySelectorAll('[data-pick]').forEach((btn) => {
    btn.addEventListener('click', () => {
      $('#destination').value = '';
      suggest(btn.dataset.pick);
    });
  });

  $('#place').addEventListener('change', (e) => { state.place = e.target.value; loadWeather(); });
  $('#date').value = state.date;
  $('#date').addEventListener('change', (e) => { state.date = e.target.value || state.date; loadWeather(); });
  $('#mood-pick').addEventListener('change', (e) => {
    state.moods.active = e.target.value || null;
    saveMoods(state.moods);
    renderMoods();
    rerun();
  });

  $('#ask-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const value = $('#destination').value.trim();
    if (value) suggest(value);
  });
}

async function init() {
  wireTabs();
  wireAsk();
  wireMoodForm();
  renderMoods();

  const { items, isDemo } = await loadWardrobe();
  state.wardrobe = items;
  state.isDemo = isDemo;
  renderCloset();

  await loadWeather();
}

init();
