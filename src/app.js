import { fetchWeather, manualWeather, requirementsFrom, LINZ } from './weather.js';
import { resolveOccasion, QUICK_PICKS, OCCASIONS } from './occasions.js';
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
      <span class="weather__desc">Couldn't reach the weather service.</span>
      <span class="weather__meta">Pick roughly how it feels outside:</span>
      <span class="chips" id="manual-weather">
        ${['cold', 'cool', 'mild', 'warm', 'hot']
          .map((k) => `<button class="chip" data-manual="${k}">${k}</button>`).join('')}
      </span>`;
    el.querySelectorAll('[data-manual]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.weather = manualWeather(btn.dataset.manual);
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
    <span class="weather__desc">${w.description} in ${w.place}</span>
    <span class="weather__meta">feels like ${Math.round(w.feelsLike)}°${
      w.high != null ? ` · ${Math.round(w.low)}–${Math.round(w.high)}°` : ''}</span>
    ${flags.length ? `<span class="weather__flag">${flags.join(' · ')}</span>` : ''}
    ${w.source === 'manual' ? '<span class="weather__meta">(set by hand — live weather unavailable)</span>' : ''}`;
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
        <p class="outfit__rank">Outfit ${number}</p>
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
  const result = suggestOutfits(available, key, req, { count: 15 });

  const header = confident
    ? `<p class="muted">${profile.label} — ${profile.note}</p>`
    : `<p class="muted">I don't recognise “${destination}”, so I've treated it as everyday wear.
       Try one of the buttons above if that's wrong.</p>`;

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
    });
  });
}

function wireAsk() {
  $('#quick').innerHTML = QUICK_PICKS
    .map((p) => `<button class="chip" data-pick="${p}">${p}</button>`).join('');
  $('#quick').querySelectorAll('[data-pick]').forEach((btn) => {
    btn.addEventListener('click', () => {
      $('#destination').value = btn.dataset.pick;
      suggest(btn.dataset.pick);
    });
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

  const { items, isDemo } = await loadWardrobe();
  state.wardrobe = items;
  state.isDemo = isDemo;
  renderCloset();

  try {
    state.weather = await fetchWeather(LINZ);
  } catch {
    state.weather = null;   // renderWeather offers the manual fallback
  }
  renderWeather();
}

init();
