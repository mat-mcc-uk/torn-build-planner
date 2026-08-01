// ==UserScript==
// @name         Torn Build Planner
// @namespace    https://github.com/mat-mcc-uk
// @version      1.0.1
// @description  Build planner on the Torn gym page — shows what to train next for your chosen build
// @author       mat-mcc-uk
// @match        https://www.torn.com/gym.php*
// @match        https://www.torn.com/loader.php*
// @match        https://www.torn.com/loader2.php*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @updateURL    https://raw.githubusercontent.com/mat-mcc-uk/torn-build-planner/main/torn-build-planner.user.js
// @downloadURL  https://raw.githubusercontent.com/mat-mcc-uk/torn-build-planner/main/torn-build-planner.user.js
// ==/UserScript==

(function () {
  'use strict';

  const BUILDS = {
    juggernaut: { name: 'Juggernaut', emoji: '⚔️', desc: '50 STR / 25 SPD / 25 DEF',
                  str: 0.50, spd: 0.25, def: 0.25, dex: 0 },
    phantom:    { name: 'Phantom',    emoji: '🥷', desc: '50 STR / 25 SPD / 25 DEX',
                  str: 0.50, spd: 0.25, def: 0,    dex: 0.25 },
    sentinel:   { name: 'Sentinel',   emoji: '⚖️', desc: '25 STR / 25 SPD / 25 DEF / 25 DEX',
                  str: 0.25, spd: 0.25, def: 0.25, dex: 0.25 },
  };

  const STAT_COLOUR = { str: '#e74c3c', spd: '#3498db', def: '#2ecc71', dex: '#f39c12' };
  const STAT_LABEL  = { str: 'STR',    spd: 'SPD',    def: 'DEF',    dex: 'DEX' };
  const STAT_KEYS   = ['str', 'spd', 'def', 'dex'];
  const MILESTONES  = [5e6, 10e6, 25e6, 50e6, 100e6, 250e6, 500e6, 1e9, 2.5e9, 5e9, 10e9];
  const STATS_TTL   = 5 * 60 * 1000;
  const TRAIN_GUARD = 30 * 1000;

  let tornKey        = GM_getValue('tbp_tornKey', '');
  let selectedBuild  = GM_getValue('tbp_build',  'juggernaut');
  let cachedStats    = GM_getValue('tbp_stats',   null);
  let statsFetchedAt = GM_getValue('tbp_statsAt', 0);
  let dom            = {};
  let lastTrainFetch = 0;

  // ---------------------------------------------------------------
  // Gym page detection
  // ---------------------------------------------------------------
  function isGymPage() {
    if (location.pathname.includes('gym.php')) return true;
    if (/gym/i.test(location.search)) return true;
    if (/gym/i.test(document.title)) return true;
    if (document.querySelector('[class*="gym"]')) return true;
    return false;
  }

  // ---------------------------------------------------------------
  // API
  // ---------------------------------------------------------------
  function apiFetch(selections) {
    return new Promise((resolve, reject) => {
      if (!tornKey) { reject(new Error('no key')); return; }
      GM_xmlhttpRequest({
        method: 'GET',
        url: `https://api.torn.com/user/?selections=${selections}&key=${tornKey}`,
        timeout: 15000,
        onload: (r) => {
          if (r.status >= 200 && r.status < 300) {
            try {
              const d = JSON.parse(r.responseText);
              if (d.error) reject(new Error(d.error.error));
              else resolve(d);
            } catch { reject(new Error('Bad JSON')); }
          } else { reject(new Error('HTTP ' + r.status)); }
        },
        onerror:   () => reject(new Error('Network error')),
        ontimeout: () => reject(new Error('Timeout')),
      });
    });
  }

  async function loadStats(force = false) {
    if (!tornKey) return;
    if (!force && cachedStats && Date.now() - statsFetchedAt < STATS_TTL) return;
    try {
      const d = await apiFetch('basic,battlestats');
      cachedStats = {
        name: d.name, level: d.level,
        str: d.strength || 0, spd: d.speed     || 0,
        def: d.defense  || 0, dex: d.dexterity || 0,
      };
      statsFetchedAt = Date.now();
      GM_setValue('tbp_stats',  cachedStats);
      GM_setValue('tbp_statsAt', statsFetchedAt);
    } catch (err) {
      console.warn('[Build Planner]', err.message);
    }
  }

  // ---------------------------------------------------------------
  // Build math
  // ---------------------------------------------------------------
  function calcPlan(stats, buildKey) {
    const build = BUILDS[buildKey];

    // Anchor = stat furthest ahead of its target ratio sets the scale.
    // All other build stats must grow to match relative to that anchor.
    let implied = 0;
    for (const k of STAT_KEYS) {
      if (build[k] > 0) implied = Math.max(implied, (stats[k] || 0) / build[k]);
    }

    const currentTotal = STAT_KEYS.reduce((s, k) => s + (stats[k] || 0), 0);
    const plan = {};
    let totalNeeded = 0, focusStat = null, maxNeeded = -1;

    for (const k of STAT_KEYS) {
      const current    = stats[k] || 0;
      const target     = Math.round(implied * build[k]);
      const needed     = Math.max(0, target - current);
      const excess     = Math.max(0, current - target);
      const currentPct = currentTotal > 0 ? (current / currentTotal) * 100 : 0;
      const targetPct  = build[k] * 100;
      const progress   = target > 0 ? Math.min(100, (current / target) * 100) : 100;

      totalNeeded += needed;
      if (build[k] > 0 && needed > maxNeeded) { maxNeeded = needed; focusStat = k; }

      plan[k] = { current, target, needed, excess, currentPct, targetPct, progress, inBuild: build[k] > 0 };
    }

    return { plan, totalNeeded, implied, currentTotal, focusStat, build };
  }

  // ---------------------------------------------------------------
  // Formatting
  // ---------------------------------------------------------------
  function fmt(n) {
    if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(1)  + 'M';
    if (n >= 1e3) return Math.round(n / 1e3)    + 'k';
    return String(Math.round(n));
  }

  // ---------------------------------------------------------------
  // CSS
  // ---------------------------------------------------------------
  GM_addStyle(`
    #tbp { position:fixed; bottom:50px; left:10px; width:310px; max-height:82vh;
      overflow-y:auto; background:#1b1b1b; color:#e0e0e0; border:1px solid #444;
      border-radius:6px; font-family:Arial,sans-serif; font-size:12px;
      z-index:9998; box-shadow:0 2px 10px rgba(0,0,0,.5); }
    #tbp.col .tbp-bd { display:none; }
    #tbp h3 { margin:0; padding:8px 10px; background:#2a2a2a; border-bottom:1px solid #444;
      cursor:pointer; user-select:none; display:flex; justify-content:space-between;
      align-items:center; font-size:12px; }
    .tbp-bd { padding:8px 10px; }
    .tbp-builds { display:flex; gap:4px; margin-bottom:6px; }
    .tbp-bb { flex:1; padding:5px 3px; font-size:10px; text-align:center;
      background:#2a2a2a; color:#666; border:1px solid #333;
      border-radius:4px; cursor:pointer; line-height:1.3; }
    .tbp-bb.on { background:#1e3a2a; color:#9fe8b0; border-color:#2d7d47; }
    .tbp-desc { font-size:10px; color:#555; margin-bottom:6px; }
    .tbp-dist { display:flex; height:7px; border-radius:4px; overflow:hidden; margin-bottom:8px; }
    .tbp-focus { background:#1e3a2a; border:1px solid #2d7d47;
      border-radius:4px; padding:7px 10px; margin-bottom:10px; }
    .tbp-fl { font-size:10px; color:#888; margin-bottom:2px; }
    .tbp-fs { font-size:18px; font-weight:bold; line-height:1.2; }
    .tbp-fsub { font-size:10px; color:#888; margin-top:2px; }
    .tbp-stat { margin-bottom:8px; }
    .tbp-sh { display:flex; justify-content:space-between; font-size:11px; margin-bottom:3px; }
    .tbp-sn { font-weight:bold; }
    .tbp-sp { color:#666; }
    .tbp-bw { background:#2a2a2a; border-radius:3px; height:7px; overflow:hidden; }
    .tbp-b  { height:100%; border-radius:3px; transition:width .4s; }
    .tbp-sg { font-size:10px; margin-top:2px; }
    .tbp-sec { font-size:10px; font-weight:bold; color:#555; text-transform:uppercase;
      letter-spacing:.5px; border-top:1px solid #2a2a2a; padding-top:7px; margin:8px 0 5px; }
    .tbp-m { display:flex; justify-content:space-between; font-size:10px;
      color:#555; margin-bottom:3px; }
    .tbp-m.done { color:#9fe8b0; }
    .tbp-mv { color:#444; }
    .tbp-m.done .tbp-mv { color:#2d7d47; }
    .tbp-foot { font-size:10px; color:#444; margin-top:6px; }
    .tbp-key label { display:block; color:#aaa; margin-bottom:3px; font-size:11px; }
    .tbp-key input { width:100%; box-sizing:border-box; background:#2a2a2a; color:#e0e0e0;
      border:1px solid #555; border-radius:3px; padding:4px 6px;
      font-size:11px; margin-bottom:6px; }
    .tbp-btn { background:#2a2a2a; color:#e0e0e0; border:1px solid #555;
      border-radius:3px; padding:3px 8px; cursor:pointer; font-size:11px; }
    .tbp-btn:hover { background:#333; }
    .tbp-btn.g { background:#1e5631; color:#9fe8b0; border-color:#2d7d47; }
    .tbp-ic { background:none; border:none; color:#e0e0e0; cursor:pointer; font-size:13px; padding:0 2px; }
  `);

  // ---------------------------------------------------------------
  // Panel
  // ---------------------------------------------------------------
  function buildPanel() {
    if (document.getElementById('tbp')) return;

    const p = document.createElement('div');
    p.id = 'tbp';
    p.classList.add('col');
    p.innerHTML = `
      <h3>
        <span>📊 Build Planner</span>
        <span style="display:flex;gap:4px;align-items:center">
          <button class="tbp-ic" id="tbp-ref" title="Refresh stats">↻</button>
          <button class="tbp-ic" id="tbp-tog">▲</button>
        </span>
      </h3>
      <div class="tbp-bd"><div id="tbp-c">Loading…</div></div>
    `;
    document.body.appendChild(p);
    dom.panel = p;
    dom.c     = document.getElementById('tbp-c');

    const tog = document.getElementById('tbp-tog');
    function toggle() {
      p.classList.toggle('col');
      tog.textContent = p.classList.contains('col') ? '▲' : '▼';
      if (!p.classList.contains('col')) render();
    }
    p.querySelector('h3').addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      toggle();
    });
    tog.addEventListener('pointerdown', (e) => e.stopPropagation());
    tog.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });

    const ref = document.getElementById('tbp-ref');
    ref.addEventListener('pointerdown', (e) => e.stopPropagation());
    ref.addEventListener('click', async (e) => {
      e.stopPropagation();
      await loadStats(true);
      render();
    });
  }

  // ---------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------
  function render() {
    if (!dom.c || dom.panel?.classList.contains('col')) return;

    if (!tornKey) {
      dom.c.innerHTML = `
        <div class="tbp-key">
          <label>Torn API key (Limited Access)</label>
          <input id="tbp-ki" type="password" placeholder="Paste your Torn API key">
          <button class="tbp-btn g" id="tbp-ks" style="width:100%;text-align:center">Save &amp; load stats</button>
          <div style="color:#444;font-size:10px;margin-top:4px">
            Get your key at torn.com/preferences.php#tab=api — Limited Access is enough.
          </div>
        </div>
      `;
      document.getElementById('tbp-ks').addEventListener('click', async () => {
        const val = document.getElementById('tbp-ki').value.trim();
        if (!val) return;
        const btn = document.getElementById('tbp-ks');
        btn.textContent = 'Verifying…';
        try {
          tornKey = val;
          const d = await apiFetch('basic');
          if (d.error) {
            tornKey = '';
            alert('Torn rejected key: ' + d.error.error);
            btn.textContent = 'Save & load stats'; return;
          }
          GM_setValue('tbp_tornKey', tornKey);
          await loadStats(true);
          render();
        } catch {
          tornKey = '';
          alert('Could not reach Torn API.');
          btn.textContent = 'Save & load stats';
        }
      });
      return;
    }

    if (!cachedStats) {
      dom.c.innerHTML = `<div style="color:#666;font-size:11px;padding:4px 0">Fetching stats…</div>`;
      return;
    }

    const s = cachedStats;
    const { plan, totalNeeded, currentTotal, focusStat, build } = calcPlan(s, selectedBuild);

    // Build buttons
    const btns = Object.entries(BUILDS).map(([k, b]) => `
      <button class="tbp-bb${k === selectedBuild ? ' on' : ''}" data-build="${k}">
        ${b.emoji}<br>${b.name}
      </button>`).join('');

    // Distribution strip
    const dist = STAT_KEYS.filter(k => s[k] > 0)
      .map(k => `<div style="flex:${s[k]};background:${STAT_COLOUR[k]}"></div>`).join('');

    // Focus box
    const focus = focusStat && plan[focusStat].needed > 0 ? `
      <div class="tbp-focus">
        <div class="tbp-fl">Train next</div>
        <div class="tbp-fs" style="color:${STAT_COLOUR[focusStat]}">
          ${STAT_LABEL[focusStat]} +${fmt(plan[focusStat].needed)}
        </div>
        <div class="tbp-fsub">
          ${fmt(plan[focusStat].current)} → ${fmt(plan[focusStat].target)}
          ${totalNeeded > plan[focusStat].needed ? ` · ${fmt(totalNeeded)} total gap` : ''}
        </div>
      </div>` : `
      <div class="tbp-focus">
        <div class="tbp-fl">Status</div>
        <div style="color:#9fe8b0;font-weight:bold">✓ On target for ${build.name}</div>
      </div>`;

    // Stat rows
    const rows = STAT_KEYS.map(k => {
      const p = plan[k];
      if (!p.inBuild && p.current === 0) return '';

      let gap;
      if (!p.inBuild) {
        gap = `<span style="color:#555">${fmt(p.current)} — not in this build</span>`;
      } else if (p.needed > 0) {
        const g = Math.round((1 - p.current / p.target) * 100);
        gap = `<span style="color:#f0d27a">+${fmt(p.needed)} needed (${g}% gap)</span>`;
      } else if (p.excess > 0) {
        gap = `<span style="color:#555">${fmt(p.excess)} ahead — train other stats</span>`;
      } else {
        gap = `<span style="color:#9fe8b0">On target</span>`;
      }

      const bw  = p.inBuild ? p.progress.toFixed(1) : '100';
      const bc  = !p.inBuild ? '#2a2a2a' : p.progress >= 100 ? STAT_COLOUR[k] : '#e67e22';

      return `
        <div class="tbp-stat">
          <div class="tbp-sh">
            <span class="tbp-sn" style="color:${STAT_COLOUR[k]}">${STAT_LABEL[k]}</span>
            <span class="tbp-sp">${Math.round(p.currentPct)}% now
              ${p.inBuild ? `→ ${Math.round(p.targetPct)}% target` : '(excluded)'}
            </span>
          </div>
          <div class="tbp-bw"><div class="tbp-b" style="width:${bw}%;background:${bc}"></div></div>
          <div class="tbp-sg">${gap}</div>
        </div>`;
    }).join('');

    // Milestones — show the last completed milestone as context, then the next 4 upcoming.
    // This keeps the table relevant whether you're at 8M or 800M total.
    const lastDoneIdx = MILESTONES.reduce((idx, m, i) => currentTotal >= m ? i : idx, -1);
    const windowStart = Math.max(0, lastDoneIdx);       // one done for context
    const windowEnd   = Math.min(MILESTONES.length, windowStart + 5);
    const miles = MILESTONES.slice(windowStart, windowEnd).map(m => {
      const done = currentTotal >= m;
      const vals = STAT_KEYS.filter(k => build[k] > 0)
        .map(k => `${STAT_LABEL[k]} ${fmt(m * build[k])}`).join(' · ');
      return `<div class="tbp-m${done ? ' done' : ''}">
        <span>${done ? '✓' : '○'} ${fmt(m)}</span>
        <span class="tbp-mv">${vals}</span>
      </div>`;
    }).join('');

    const age = statsFetchedAt ? Math.round((Date.now() - statsFetchedAt) / 60000) : null;

    dom.c.innerHTML = `
      <div class="tbp-builds">${btns}</div>
      <div class="tbp-desc">${build.desc}</div>
      <div class="tbp-dist">${dist}</div>
      ${focus}
      ${rows}
      <div class="tbp-sec">Milestones</div>
      ${miles}
      <div class="tbp-foot">
        ${s.name} · Lv${s.level} · ${fmt(currentTotal)} total
        ${age !== null ? ` · ${age}m ago` : ''}
      </div>
    `;

    document.querySelectorAll('.tbp-bb').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedBuild = btn.dataset.build;
        GM_setValue('tbp_build', selectedBuild);
        render();
      });
    });
  }

  // ---------------------------------------------------------------
  // Watch for training completion
  // ---------------------------------------------------------------
  function watchTraining() {
    let debounce = null;
    new MutationObserver(() => {
      const indicator = document.querySelector(
        '[class*="train-result"], [class*="gymResult"], [class*="gain"], [class*="levelUp"]'
      );
      if (!indicator) return;
      if (Date.now() - lastTrainFetch < TRAIN_GUARD) return;
      clearTimeout(debounce);
      debounce = setTimeout(async () => {
        lastTrainFetch = Date.now();
        await loadStats(true);
        render();
      }, 4000);
    }).observe(document.body, { childList: true, subtree: true });
  }

  // ---------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------
  async function init() {
    await new Promise(r => {
      if (document.readyState !== 'loading') r();
      else document.addEventListener('DOMContentLoaded', r);
    });
    if (!isGymPage()) return;
    buildPanel();
    await loadStats();
    render();
    watchTraining();
  }

  init();
})();
