// =============================================================================
// CONSTANTS & CALCULATIONS
// =============================================================================

var NEW_RING = 22.8051;

var LIMITS = {
  yellow: 0.0295,
  orange: 0.0591,
  red:    0.1181
};

function calcWear(measurement) {
  return Math.round((measurement - NEW_RING) * 10000) / 10000;
}

function getStatus(wear) {
  if (wear >= LIMITS.red)    return { key: 'red',    label: 'Replace Part Now',  color: '#C0392B' };
  if (wear >= LIMITS.orange) return { key: 'orange', label: 'Have Parts Ready',  color: '#E67E22' };
  if (wear >= LIMITS.yellow) return { key: 'yellow', label: 'Order Parts',       color: '#F1C40F' };
  return                            { key: 'normal', label: 'Normal',            color: '#FFFFFF' };
}

function getOverallStatus(results) {
  var valid = results.filter(function(r) { return r.wear !== null; });
  if (!valid.length) return { key: 'normal', label: '\u2014' };
  var worst = Math.max.apply(null, valid.map(function(r) { return r.wear; }));
  return getStatus(worst);
}

function validateMeasurement(val) {
  if (val === '' || val === null || val === undefined) return { valid: false, number: null };
  var n = parseFloat(val);
  if (isNaN(n)) return { valid: false };
  if (n < NEW_RING - 0.5 || n > NEW_RING + 0.5) return { valid: false, error: 'Out of range' };
  return { valid: true, number: n };
}

function fmt4(n) {
  return (n !== null && !isNaN(n)) ? n.toFixed(4) : '\u2014';
}

// =============================================================================
// DRAFTS
// Live, in-progress values for a module (separate from the saved history in
// STORE_KEY). Lets a tab's in-progress entry survive switching to another
// tab, and lets other code (combined report) check "does this component
// currently have anything entered" without needing it mounted on screen.
// =============================================================================

function draftKey(storageKey) { return 'draft_' + storageKey; }

function loadDraft(storageKey) {
  try {
    var raw = localStorage.getItem(draftKey(storageKey));
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function saveDraftData(storageKey, data) {
  try { localStorage.setItem(draftKey(storageKey), JSON.stringify(data)); } catch (e) {}
}

function clearDraft(storageKey) {
  try { localStorage.removeItem(draftKey(storageKey)); } catch (e) {}
}

function anyNonEmpty(val) {
  if (val === '' || val === null || val === undefined) return false;
  if (Array.isArray(val)) return val.some(anyNonEmpty);
  if (typeof val === 'object') return Object.keys(val).some(function(k) { return anyNonEmpty(val[k]); });
  return true;
}

function draftHasData(storageKey) {
  var d = loadDraft(storageKey);
  return !!(d && d.measurements && anyNonEmpty(d.measurements));
}

// =============================================================================
// STORAGE
// =============================================================================

var STORE_KEY = 'steckel_inspections';

function storeSave(moduleId, data) {
  try {
    var raw = localStorage.getItem(STORE_KEY);
    var store = raw ? JSON.parse(raw) : { version: 1, inspections: [] };
    var id = moduleId + '_' + Date.now();
    store.inspections.push({
      id: id,
      moduleId: moduleId,
      timestamp: new Date().toISOString(),
      data: data
    });
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
    return id;
  } catch(e) {
    return null;
  }
}

// =============================================================================
// TOAST
// =============================================================================

var _toastTimer;

function showToast(msg, type) {
  var t = document.getElementById('app-toast');
  t.textContent = msg;
  t.className = 'visible t-' + (type || 'info');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(function() { t.className = ''; }, 3000);
}

// =============================================================================
// PDF SAVE
// =============================================================================

// =============================================================================
// MILL ASSIGNMENT SYSTEM
// Each wobbler (Bottom / Top) has its own mill number.
// Bottom and Top cannot share the same mill number.
// Persists in localStorage (per-device — does not sync between computers).
//
// SECURITY NOTE: MILL_PASSWORD is a UI speed bump, not access control. This
// is a static, client-side-only app with no server and no auth system, so
// this value is always readable via browser view-source by anyone with the
// URL. Do NOT treat it as protecting anything sensitive, and do not reuse
// a password here that is used anywhere else. If it needs to change, edit
// the value below AND see "Rotating MILL_PASSWORD" in the README — changing
// it here does not remove the old value from git history.
// =============================================================================

var MILL_PASSWORD = 'Nucor2024';
var SM_MILLS = ['SM01', 'SM02', 'SM03', 'SM04'];
var RM_MILLS = ['RM01', 'RM02', 'RM03', 'RM04'];

// groupKey convention: '<family>_<position>', e.g. 'steckel_bottom', 'rougher2_top'.
// family = mill family (steckel, rougher, rougher2, ...); position = 'bottom' or 'top'.
// Add a friendly label here when introducing a new family; everything else
// (display name, opposite-position lookup, default mill) derives automatically.
var FAMILY_LABELS = {
  steckel: 'Steckel',
  rougher: 'Rougher'
};

// Default mill assigned to a group the first time it's used, before any
// manual assignment is stored. Only needed if you want a specific starting
// mill; otherwise new groups automatically default to the first mill in
// their family's list (see getMillFor below).
var GROUP_DEFAULT_MILL = {
  steckel_bottom: 'SM01',
  steckel_top:    'SM02',
  rougher_bottom: 'RM01',
  rougher_top:    'RM02'
};

function getGroupFamily(groupKey) {
  var parts = groupKey.split('_');
  parts.pop(); // drop 'bottom' / 'top'
  return parts.join('_');
}

function getMillFor(groupKey) {
  var stored = localStorage.getItem('mill_' + groupKey);
  if (stored) return stored;
  if (GROUP_DEFAULT_MILL[groupKey]) return GROUP_DEFAULT_MILL[groupKey];
  return getMillsForGroup(groupKey)[0];
}

function setMillFor(groupKey, mill) {
  localStorage.setItem('mill_' + groupKey, mill);
}

function getMillsForGroup(groupKey) {
  return getWobblerPool(getGroupFamily(groupKey));
}

// ---- Wobbler pool (the actual SM##/RM## units available to a mill family) ----
// Defaults to SM_MILLS/RM_MILLS above; once a family's pool is edited via the
// Manage Wobblers panel, the edited list is stored in localStorage per-device
// under 'wobbler_pool_<family>' and takes over from the hardcoded default.

function getWobblerPool(family) {
  var stored = localStorage.getItem('wobbler_pool_' + family);
  if (stored) {
    try {
      var arr = JSON.parse(stored);
      if (Array.isArray(arr) && arr.length) return arr;
    } catch (e) {}
  }
  return (family.indexOf('rougher') === 0 ? RM_MILLS : SM_MILLS).slice();
}

function setWobblerPool(family, arr) {
  localStorage.setItem('wobbler_pool_' + family, JSON.stringify(arr));
}

function getWobblerPrefix(family) {
  return family.indexOf('rougher') === 0 ? 'RM' : 'SM';
}

function isValidWobblerNumber(family, value) {
  var prefix = getWobblerPrefix(family);
  return new RegExp('^' + prefix + '\\d{2,}$').test(value);
}

// Every NAV_GROUPS group whose family matches, e.g. both steckel_bottom and
// steckel_top for family 'steckel'. Read lazily since NAV_GROUPS is defined
// later in this file — safe because this only runs after the app has booted.
function getGroupKeysInFamily(family) {
  return NAV_GROUPS
    .map(function(g) { return g.key; })
    .filter(function(k) { return getGroupFamily(k) === family; });
}

function getAssignedWobblersInFamily(family) {
  return getGroupKeysInFamily(family).map(function(k) { return getMillFor(k); });
}

function addWobbler(family, number) {
  number = number.trim().toUpperCase();
  if (!isValidWobblerNumber(family, number)) {
    return { ok: false, error: getWobblerPrefix(family) + ' + at least 2 digits (e.g. ' + getWobblerPrefix(family) + '05)' };
  }
  var pool = getWobblerPool(family);
  if (pool.indexOf(number) !== -1) {
    return { ok: false, error: number + ' already exists' };
  }
  pool.push(number);
  pool.sort();
  setWobblerPool(family, pool);
  return { ok: true };
}

function removeWobbler(family, number) {
  var assigned = getAssignedWobblersInFamily(family);
  if (assigned.indexOf(number) !== -1) {
    return { ok: false, error: number + ' is currently assigned to a wobbler position \u2014 reassign it first' };
  }
  var pool = getWobblerPool(family).filter(function(m) { return m !== number; });
  if (!pool.length) {
    return { ok: false, error: 'At least one wobbler must remain' };
  }
  setWobblerPool(family, pool);
  return { ok: true };
}

function getOtherGroupKey(groupKey) {
  if (groupKey.slice(-7) === '_bottom') return groupKey.slice(0, -7) + '_top';
  if (groupKey.slice(-4) === '_top')    return groupKey.slice(0, -4) + '_bottom';
  return groupKey;
}

function getGroupDisplayName(groupKey) {
  var family = getGroupFamily(groupKey);
  var position = groupKey.slice(family.length + 1); // 'bottom' or 'top'
  var familyLabel = FAMILY_LABELS[family] || (family.charAt(0).toUpperCase() + family.slice(1));
  var positionLabel = position.charAt(0).toUpperCase() + position.slice(1);
  return familyLabel + ' ' + positionLabel + ' Wobbler';
}

function buildFilename(moduleTitle, groupKey, date) {
  // moduleTitle: "Bottom Wobbler — Face Ring Inspection"
  // or          "Rougher Bottom Wobbler — Face Ring Inspection"
  var parts  = moduleTitle.split(' — ');
  var module = parts[1] ? parts[1].replace(' Inspection', '').trim() : '';
  var mill   = getMillFor(groupKey);
  var wobblerLabel = getGroupDisplayName(groupKey);
  var d = date || new Date().toISOString().slice(0, 10);
  return d + ' - ' + mill + ' ' + wobblerLabel + ' - ' + module;
}

function savePDF(moduleTitle, groupKey, date) {
  var filename = buildFilename(moduleTitle, groupKey, date);
  var orig = document.title;
  document.title = filename;
  setTimeout(function() {
    window.print();
    setTimeout(function() { document.title = orig; }, 1500);
  }, 80);
}

// =============================================================================
// COMBINED REPORT
// Prints one PDF containing a page for each component (Face Ring, Centering
// Ring, Slipper, Sliding Shoe) that currently has data entered anywhere for
// this wobbler group — regardless of which tab is on screen right now.
// Components with nothing entered are skipped entirely; only 1 is required.
//
// IMPORTANT: this renders throwaway module instances via MODULE_FACTORIES,
// never the live singleton instance already mounted in the sidebar tab —
// re-running .init() on a module that's currently on screen would repoint
// its cached DOM refs at the new container and silently break the visible
// tab. A fresh instance reads the same localStorage draft, so it shows the
// same data without touching what's on screen.
// =============================================================================

var MODULE_FACTORIES = {
  faceRing:      createFaceRingModule,
  centeringRing: createCenteringRingModule,
  slipper:       createSlipperModule,
  slidingShoe:   createSlidingShoeModule
};

function saveCombinedReport(groupKey) {
  var group = null;
  for (var i = 0; i < NAV_GROUPS.length; i++) {
    if (NAV_GROUPS[i].key === groupKey) { group = NAV_GROUPS[i]; break; }
  }
  if (!group) return;

  // group.tabs is already in the fixed order: Face Ring, Centering Ring,
  // Slipper, Sliding Shoe — so the printed pages and filename follow that
  // same order regardless of the order components were filled in.
  var included = group.tabs.filter(function(tab) {
    return draftHasData(tab.module.config.storageKey);
  });

  if (!included.length) {
    showToast('Enter data in at least one component before printing', 'error');
    return;
  }

  // Log each included component to inspection history, same as an
  // individual "Save Inspection" click would.
  included.forEach(function(tab) {
    var draft = loadDraft(tab.module.config.storageKey);
    if (draft) storeSave(tab.module.config.storageKey, draft);
  });

  var old = document.getElementById('combined-report-container');
  if (old) old.remove();
  var combined = document.createElement('div');
  combined.id = 'combined-report-container';
  document.body.appendChild(combined);

  included.forEach(function(tab) {
    var factory = MODULE_FACTORIES[tab.module.type];
    if (!factory) return;
    var page = document.createElement('div');
    page.className = 'combined-report-page';
    var wrapper = document.createElement('div');
    wrapper.className = 'module-wrapper';
    page.appendChild(wrapper);
    combined.appendChild(page);
    // Distinct DOM id prefix so this throwaway instance never collides with
    // the same tab if it happens to be live-mounted elsewhere on the page
    // right now — same storageKey underneath, so drafts/history still match.
    var printConfig = Object.assign({}, tab.module.config, {
      domPrefix: tab.module.config.storageKey + '__print'
    });
    factory(printConfig).init(wrapper); // fresh, throwaway instance
  });

  var componentLabels = included.map(function(tab) { return tab.label; });
  var mill = getMillFor(groupKey);
  var wobblerLabel = getGroupDisplayName(groupKey);
  var d = new Date().toISOString().slice(0, 10);
  var filename = d + ' - ' + mill + ' ' + wobblerLabel + ' - ' + componentLabels.join(' - ');

  var orig = document.title;
  document.title = filename;
  document.body.classList.add('combined-print-mode');

  setTimeout(function() {
    window.print();
    setTimeout(function() {
      document.title = orig;
      document.body.classList.remove('combined-print-mode');
      var c = document.getElementById('combined-report-container');
      if (c) c.remove();
    }, 1500);
  }, 80);
}

function getNavGroupLabel(groupKey) {
  return getMillFor(groupKey) + ' ' + getGroupDisplayName(groupKey);
}

function getPositionLabel(groupKey) {
  return groupKey.slice(-4) === '_top' ? 'Top' : 'Bottom';
}

function openMillModal(groupKey, textNode) {
  var existing = document.getElementById('mill-modal-overlay');
  if (existing) existing.remove();

  var overlay = document.createElement('div');
  overlay.id = 'mill-modal-overlay';
  overlay.className = 'mill-modal-overlay';
  overlay.innerHTML = [
    '<div class="mill-modal">',
    '  <div class="mill-modal-title">Change Mill — ' + getPositionLabel(groupKey) + ' Wobbler</div>',
    '  <div class="mill-modal-sub">Enter password to unlock</div>',
    '  <input id="mill-pw-input" type="password" placeholder="Password" class="mill-modal-input" autocomplete="off" />',
    '  <div id="mill-pw-error" class="mill-modal-error"></div>',
    '  <div class="mill-modal-btns">',
    '    <button id="mill-pw-cancel" class="btn btn-ghost">Cancel</button>',
    '    <button id="mill-pw-submit" class="btn btn-primary">Unlock</button>',
    '  </div>',
    '</div>'
  ].join('');
  document.body.appendChild(overlay);

  var input = document.getElementById('mill-pw-input');
  input.focus();

  overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
  document.getElementById('mill-pw-cancel').addEventListener('click', function() { overlay.remove(); });
  document.getElementById('mill-pw-submit').addEventListener('click', function() {
    checkMillPassword(groupKey, textNode);
  });
  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') checkMillPassword(groupKey, textNode);
  });
}

function checkMillPassword(groupKey, textNode) {
  var input = document.getElementById('mill-pw-input');
  var error = document.getElementById('mill-pw-error');
  if (input.value !== MILL_PASSWORD) {
    error.textContent = 'Incorrect password';
    input.value = '';
    input.focus();
    return;
  }
  renderMillSelect(groupKey, textNode);
}

function renderMillSelect(groupKey, textNode) {
  var otherKey  = getOtherGroupKey(groupKey);
  var otherMill = getMillFor(otherKey);
  var available = getMillsForGroup(groupKey).filter(function(m) { return m !== otherMill; });

  var overlay = document.getElementById('mill-modal-overlay');
  overlay.querySelector('.mill-modal').innerHTML = [
    '<div class="mill-modal-title">Select Mill — ' + getPositionLabel(groupKey) + ' Wobbler</div>',
    '<div class="mill-modal-sub">' + getGroupDisplayName(getOtherGroupKey(groupKey)) + ' is using ' + otherMill + '</div>',
    '<div class="mill-modal-mills">',
    available.map(function(m) {
      var cls = m === getMillFor(groupKey) ? ' mill-btn-active' : '';
      var millLabel = m.startsWith('RM') ? m + ' Rougher' : m + ' Steckel';
      return '<button class="mill-btn' + cls + '" data-mill="' + m + '">' + millLabel + '</button>';
    }).join(''),
    '</div>',
    '<div class="mill-modal-btns">',
    '  <button id="wobbler-manage-link" class="btn btn-ghost">Manage Wobblers\u2026</button>',
    '  <button id="mill-select-cancel" class="btn btn-ghost">Cancel</button>',
    '</div>'
  ].join('');

  overlay.querySelectorAll('.mill-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      setMillFor(groupKey, btn.dataset.mill);
      if (textNode) textNode.nodeValue = getNavGroupLabel(groupKey) + ' ';
      overlay.remove();
      showToast(getGroupDisplayName(groupKey) + ' set to ' + btn.dataset.mill, 'success');
    });
  });
  document.getElementById('mill-select-cancel').addEventListener('click', function() {
    overlay.remove();
  });
  document.getElementById('wobbler-manage-link').addEventListener('click', function() {
    renderWobblerAdmin(groupKey, textNode);
  });
}

function renderWobblerAdmin(groupKey, textNode) {
  var family = getGroupFamily(groupKey);
  var overlay = document.getElementById('mill-modal-overlay');
  var modal = overlay.querySelector('.mill-modal');
  modal.classList.add('mill-admin-modal');

  function draw(errorMsg) {
    var pool = getWobblerPool(family);
    var assigned = getAssignedWobblersInFamily(family);
    modal.innerHTML = [
      '<div class="mill-modal-title">Manage Wobblers \u2014 ' + (FAMILY_LABELS[family] || family) + '</div>',
      '<div class="mill-modal-sub">Remove is blocked for a wobbler currently in service</div>',
      '<div class="mill-admin-list">',
      pool.map(function(m) {
        var inUse = assigned.indexOf(m) !== -1;
        return '<div class="mill-admin-row">' +
          '<span class="mill-admin-name">' + m + (inUse ? ' (in use)' : '') + '</span>' +
          '<button class="mill-admin-del" data-wobbler="' + m + '"' + (inUse ? ' disabled' : '') + '>Remove</button>' +
          '</div>';
      }).join(''),
      '</div>',
      errorMsg ? '<div class="mill-modal-error">' + errorMsg + '</div>' : '',
      '<div class="mill-admin-add">',
      '  <input id="wobbler-add-input" class="mill-modal-input" placeholder="' + getWobblerPrefix(family) + '05" autocomplete="off" />',
      '  <button id="wobbler-add-btn" class="btn btn-primary">Add</button>',
      '</div>',
      '<div class="mill-modal-btns">',
      '  <button id="wobbler-admin-done" class="btn btn-ghost">Done</button>',
      '</div>'
    ].join('');

    modal.querySelectorAll('.mill-admin-del').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var res = removeWobbler(family, btn.dataset.wobbler);
        draw(res.ok ? null : res.error);
        if (res.ok) showToast(btn.dataset.wobbler + ' removed', 'success');
      });
    });
    document.getElementById('wobbler-add-btn').addEventListener('click', function() {
      var val = document.getElementById('wobbler-add-input').value;
      var res = addWobbler(family, val);
      if (res.ok) {
        showToast(val.trim().toUpperCase() + ' added', 'success');
        draw(null);
      } else {
        draw(res.error);
      }
    });
    document.getElementById('wobbler-admin-done').addEventListener('click', function() {
      modal.classList.remove('mill-admin-modal');
      renderMillSelect(groupKey, textNode);
    });
  }

  draw(null);
}

// =============================================================================
// FACE RING SVG
// =============================================================================

var SVG_NS = 'http://www.w3.org/2000/svg';
var CX = 200, CY = 200, OR = 148, IR = 104;

function svgEl(tag, attrs, text) {
  var n = document.createElementNS(SVG_NS, tag);
  Object.keys(attrs).forEach(function(k) { n.setAttribute(k, attrs[k]); });
  if (text != null) n.textContent = text;
  return n;
}

function renderFaceRing(container, locations) {
  var indicators = {};
  var readouts = {};
  container.innerHTML = '';

  var svg = svgEl('svg', { viewBox: '0 0 400 400', class: 'face-ring-svg' });

  svg.appendChild(svgEl('circle', { cx: CX, cy: CY, r: OR,  fill: 'none', stroke: '#4A5568', 'stroke-width': 3 }));
  svg.appendChild(svgEl('circle', { cx: CX, cy: CY, r: IR,  fill: 'none', stroke: '#4A5568', 'stroke-width': 2 }));
  svg.appendChild(svgEl('circle', { cx: CX, cy: CY, r: 22,  fill: '#1A2535', stroke: '#4A5568', 'stroke-width': 2 }));
  svg.appendChild(svgEl('text',   { x: CX, y: CY - 4, 'text-anchor': 'middle', fill: '#7F8C8D', 'font-size': 9, 'font-family': 'monospace' }, 'FACE'));
  svg.appendChild(svgEl('text',   { x: CX, y: CY + 8, 'text-anchor': 'middle', fill: '#7F8C8D', 'font-size': 9, 'font-family': 'monospace' }, 'RING'));

  locations.forEach(function(loc) {
    var rad  = (loc.angle * Math.PI) / 180;
    var cosA = Math.cos(rad);
    var sinA = Math.sin(rad);

    // Dashed axis line spanning the full diameter
    svg.appendChild(svgEl('line', {
      x1: CX + cosA * OR, y1: CY - sinA * OR,
      x2: CX - cosA * OR, y2: CY + sinA * OR,
      stroke: '#2E3F55', 'stroke-width': 1, 'stroke-dasharray': '4 4'
    }));

    // Split label into two end-names
    // "Top Bottom"           -> end1="T"  end2="B"
    // "Left Right"           -> end1="L"  end2="R"
    // "Top Left Bottom Right"-> end1="TL" end2="BR"
    // "Top Right Bottom Left"-> end1="TR" end2="BL"
    var words = loc.label.split(' ');
    var half  = words.length / 2;
    var end1  = words.slice(0, half).map(function(w){ return w[0]; }).join('');
    var end2  = words.slice(half).map(function(w){ return w[0]; }).join('');

    // Indicator dot sits ON the ring surface at the end1 side
    var dot = svgEl('circle', {
      cx: CX + cosA * OR,
      cy: CY - sinA * OR,
      r: 10,
      fill: '#FFFFFF',
      stroke: '#2C3E50',
      'stroke-width': 2
    });
    svg.appendChild(dot);
    indicators[loc.id] = dot;

    var LO = OR + 22;  // label offset — just outside the ring surface

    // Label at end1 (positive direction)
    svg.appendChild(svgEl('text', {
      x: CX + cosA * LO,
      y: CY - sinA * LO,
      'text-anchor': 'middle', 'dominant-baseline': 'middle',
      fill: '#95A5A6', 'font-size': 11, 'font-weight': 'bold', 'font-family': 'monospace'
    }, end1));

    // Label at end2 (opposite end)
    svg.appendChild(svgEl('text', {
      x: CX - cosA * LO,
      y: CY + sinA * LO,
      'text-anchor': 'middle', 'dominant-baseline': 'middle',
      fill: '#95A5A6', 'font-size': 11, 'font-weight': 'bold', 'font-family': 'monospace'
    }, end2));

    // Live measurement readout — just inside the ring near the dot
    var RO = OR - 20;
    var anchor = cosA > 0.15 ? 'end' : (cosA < -0.15 ? 'start' : 'middle');
    var readout = svgEl('text', {
      x: CX + cosA * RO,
      y: CY - sinA * RO,
      'text-anchor': anchor,
      'dominant-baseline': 'middle',
      fill: 'transparent',
      'font-size': 14,
      'font-family': 'monospace'
    }, '');
    svg.appendChild(readout);
    readouts[loc.id] = readout;
  });

  container.appendChild(svg);
  return { indicators: indicators, readouts: readouts };
}

function updateSVGColors(indicators, colorMap) {
  Object.keys(colorMap).forEach(function(id) {
    if (indicators[id]) indicators[id].setAttribute('fill', colorMap[id]);
  });
}

function updateSVGReadouts(readouts, valueMap) {
  Object.keys(valueMap).forEach(function(id) {
    if (readouts[id]) {
      var val = valueMap[id];
      readouts[id].textContent = val || '';
      readouts[id].setAttribute('fill', val ? '#E8EDF2' : 'transparent');
    }
  });
}

function shortLabel(label) {
  return label.split(' ').map(function(w) { return w[0]; }).join('/');
}

// =============================================================================
// WOBBLER MODULE
// =============================================================================

var LOCATIONS = [
  { id: 'tb',   label: 'Top Bottom',           angle: 90  },
  { id: 'lr',   label: 'Left Right',            angle: 0   },
  { id: 'tlbr', label: 'Top Left Bottom Right', angle: 135 },
  { id: 'trbl', label: 'Top Right Bottom Left', angle: 45  }
];

// =============================================================================
// FACE RING MODULE FACTORY
// Creates an independent Face Ring inspection instance.
// Each instance has its own state, DOM IDs (prefixed), and save key.
// This is called once for Bottom Wobbler and once for Top Wobbler.
// =============================================================================

function createFaceRingModule(config) {
  // config = { storageKey: 'bottom_wobbler', title: 'Bottom Wobbler — Face Ring Inspection' }

  var p = config.domPrefix || config.storageKey; // prefix for DOM IDs — keeps instances isolated

  var NOM = config.nominal || NEW_RING;  // per-instance nominal

  var state = {
    inspector: '',
    date: '',
    measurements: { tb: '', lr: '', tlbr: '', trbl: '' }
  };

  var el = {};   // cached DOM refs
  var tbody;

  function calcWearLocal(m) { return Math.round((m - NOM) * 10000) / 10000; }
  function validateLocal(val) {
    if (val === '' || val === null || val === undefined) return { valid: false, number: null };
    var n = parseFloat(val);
    if (isNaN(n) || n < NOM - 1.0 || n > NOM + 1.0) return { valid: false };
    return { valid: true, number: n };
  }

  // ── Build & mount ──────────────────────────────────────────────────────────

  function init(container) {
    var draft = loadDraft(config.storageKey);
    state.measurements = (draft && draft.measurements) ? draft.measurements : { tb: '', lr: '', tlbr: '', trbl: '' };
    state.inspector = (draft && draft.inspector) || '';
    state.date = (draft && draft.date) || '';

    var cardsHTML = LOCATIONS.map(function(loc) {
      return [
        '<div class="measurement-card" id="' + p + '-card-' + loc.id + '">',
        '  <div class="card-label">' + loc.label + '</div>',
        '  <input id="' + p + '-inp-' + loc.id + '" type="number" step="0.0001"',
        '    placeholder="' + NOM.toFixed(4) + '" class="card-input" />',
        '  <div class="card-wear" id="' + p + '-wear-' + loc.id + '">\u2014</div>',
        '  <div class="card-status" id="' + p + '-stat-' + loc.id + '">\u2014</div>',
        '</div>'
      ].join('');
    }).join('');

    container.innerHTML = [
      '<div class="module-header">',
      '  <h2 class="module-title">' + config.title + '</h2>',
      '  <div class="module-meta">',
      '    <label class="meta-field">',
      '      <span>Inspector</span>',
      '      <input id="' + p + '-inspector" type="text" placeholder="Name" class="meta-input" />',
      '    </label>',
      '    <label class="meta-field">',
      '      <span>Date</span>',
      '      <input id="' + p + '-date" type="date" class="meta-input" />',
      '    </label>',
      '  </div>',
      '</div>',
      '<div class="module-body">',
      '  <div class="ring-panel">',
      '    <div class="panel-title">Face Ring</div>',
      '    <div id="' + p + '-svg" class="svg-container"></div>',
      '    <p class="ring-caption">Nominal diameter: ' + NOM.toFixed(4) + '&Prime;</p>',
      '  </div>',
      '  <div class="data-panel">',
      '    <div id="' + p + '-banner" class="status-banner s-normal">\u2014</div>',
      '    <div class="measurements-grid">' + cardsHTML + '</div>',
      '  </div>',
      '</div>',
      '<div class="table-section">',
      '  <div class="panel-title">Inspection Results</div>',
      '  <div id="' + p + '-table"></div>',
      '</div>',
      '<div class="action-bar">',
      '  <button id="' + p + '-save"  class="btn btn-primary">Save Inspection</button>',
      '  <button id="' + p + '-reset" class="btn btn-ghost">Reset</button>',
      '  <button id="' + p + '-print" class="btn btn-ghost">Print Report</button>',
      '  <button id="' + p + '-save-combined" class="btn btn-primary">Save Combined Report</button>',
      '</div>'
    ].join('');

    // Cache DOM refs
    el.banner    = container.querySelector('#' + p + '-banner');
    el.tableDiv  = container.querySelector('#' + p + '-table');
    el.inspector = container.querySelector('#' + p + '-inspector');
    el.date      = container.querySelector('#' + p + '-date');
    el.cards  = {};
    el.inputs = {};
    el.wears  = {};
    el.stats  = {};

    LOCATIONS.forEach(function(loc) {
      el.cards[loc.id]  = container.querySelector('#' + p + '-card-' + loc.id);
      el.inputs[loc.id] = container.querySelector('#' + p + '-inp-'  + loc.id);
      el.wears[loc.id]  = container.querySelector('#' + p + '-wear-' + loc.id);
      el.stats[loc.id]  = container.querySelector('#' + p + '-stat-' + loc.id);
    });

    // Build results table
    var tbl = document.createElement('table');
    tbl.className = 'inspection-table';
    var colgroup = document.createElement('colgroup');
    [
      { cls: 'col-location',    pct: '35%' },
      { cls: 'col-measurement', pct: '22%' },
      { cls: 'col-wear',        pct: '18%' },
      { cls: 'col-status',      pct: '25%' }
    ].forEach(function(c) {
      var col = document.createElement('col');
      col.className = c.cls;
      col.style.width = c.pct;
      colgroup.appendChild(col);
    });
    tbl.appendChild(colgroup);
    var thead = tbl.createTHead();
    var hr = thead.insertRow();
    ['Location', 'Measurement', 'Wear', 'Status'].forEach(function(h) {
      var th = document.createElement('th');
      th.textContent = h;
      hr.appendChild(th);
    });
    tbody = tbl.createTBody();
    el.tableDiv.appendChild(tbl);

    // Default to today only if no draft date; restore field values from draft
    var today = new Date().toISOString().slice(0, 10);
    if (!state.date) state.date = today;
    el.date.value = state.date;
    el.inspector.value = state.inspector;
    LOCATIONS.forEach(function(loc) {
      if (state.measurements[loc.id]) el.inputs[loc.id].value = state.measurements[loc.id];
    });

    // Input listeners
    LOCATIONS.forEach(function(loc) {
      el.inputs[loc.id].addEventListener('input', function(e) {
        state.measurements[loc.id] = e.target.value;
        update();
        persistDraft();
      });
    });

    el.inspector.addEventListener('input', function(e) { state.inspector = e.target.value; persistDraft(); });
    el.date.addEventListener('input', function(e) { state.date = e.target.value; persistDraft(); });

    container.querySelector('#' + p + '-save').addEventListener('click', save);
    container.querySelector('#' + p + '-reset').addEventListener('click', reset);
    container.querySelector('#' + p + '-print').addEventListener('click', function() { window.print(); });
    container.querySelector('#' + p + '-save-combined').addEventListener('click', function() { saveCombinedReport(config.groupKey); });

    el.svgRefs = renderFaceRing(container.querySelector('#' + p + '-svg'), LOCATIONS);
    update();
  }

  function persistDraft() {
    saveDraftData(config.storageKey, { inspector: state.inspector, date: state.date, measurements: state.measurements });
  }

  // ── Update (runs on every input change) ───────────────────────────────────

  function update() {
    var results = LOCATIONS.map(function(loc) {
      var v = validateLocal(state.measurements[loc.id]);
      if (!v.valid || v.number === null) {
        return { id: loc.id, label: loc.label, measurement: null, wear: null, status: null };
      }
      var wear = calcWearLocal(v.number);
      return { id: loc.id, label: loc.label, measurement: v.number, wear: wear, status: getStatus(wear) };
    });

    // Cards
    results.forEach(function(r) {
      el.wears[r.id].textContent = (r.wear !== null) ? fmt4(r.wear) + '"' : '\u2014';
      if (r.status) {
        el.stats[r.id].textContent = r.status.label;
        el.cards[r.id].style.setProperty('--card-accent', r.status.color);
      } else {
        el.stats[r.id].textContent = '\u2014';
        el.cards[r.id].style.setProperty('--card-accent', 'var(--color-border)');
      }
    });

    // Table rows
    results.forEach(function(r) {
      var row = tbody.querySelector('tr[data-key="' + r.id + '"]');
      if (!row) { row = tbody.insertRow(); row.dataset.key = r.id; }
      row.innerHTML = '';
      [
        r.label,
        (r.measurement !== null) ? fmt4(r.measurement) + '"' : '\u2014',
        (r.wear        !== null) ? fmt4(r.wear) + '"'        : '\u2014',
        (r.status)               ? r.status.label            : '\u2014'
      ].forEach(function(text) {
        row.insertCell().textContent = text;
      });
      row.className = (r.status && r.status.key !== 'normal') ? 's-' + r.status.key : '';
    });

    // Banner
    var overall = getOverallStatus(results);
    el.banner.textContent = overall.label;
    el.banner.className   = 'status-banner s-' + overall.key;

    // SVG dots and readouts
    var colorMap = {}, readoutMap = {};
    results.forEach(function(r) {
      colorMap[r.id]   = r.status ? r.status.color : '#FFFFFF';
      readoutMap[r.id] = r.measurement !== null ? r.measurement.toFixed(4) : '';
    });
    updateSVGColors(el.svgRefs.indicators, colorMap);
    updateSVGReadouts(el.svgRefs.readouts, readoutMap);
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  function save() {
    var id = storeSave(config.storageKey, {
      inspector: state.inspector,
      date: state.date,
      measurements: Object.assign({}, state.measurements)
    });
    if (id) showToast('Saving PDF…', 'success');
    else    showToast('Save failed — storage may be unavailable', 'error');
    savePDF(config.title, config.groupKey, state.date);
  }

  function reset() {
    state.measurements = { tb: '', lr: '', tlbr: '', trbl: '' };
    clearDraft(config.storageKey);
    LOCATIONS.forEach(function(loc) {
      el.inputs[loc.id].value = '';
    });
    update();
  }

  return { init: init, config: config, type: 'faceRing' };
}


// =============================================================================
// CENTERING RING MODULE FACTORY
// Ø365±0.2mm bore — 2 measurement axes: Top/Bottom and Left/Right
// SVG: simplified ring with 2 axes and indicator dots
// =============================================================================

var CENTERING_RING_NOMINAL = 11.8189;

var CENTERING_LIMITS = {
  yellow: 0.0313,
  orange: 0.0625,
  red:    0.1250
};

var CENTERING_LOCATIONS = [
  { id: 'tb', label: 'Top Bottom', angle: 90 },
  { id: 'lr', label: 'Left Right', angle: 0  }
];

function calcCenteringWear(measurement) {
  return Math.round((measurement - CENTERING_RING_NOMINAL) * 10000) / 10000;
}

function getCenteringStatus(wear) {
  if (wear >= CENTERING_LIMITS.red)    return { key: 'red',    label: 'Replace Part Now', color: '#C0392B' };
  if (wear >= CENTERING_LIMITS.orange) return { key: 'orange', label: 'Have Parts Ready', color: '#E67E22' };
  if (wear >= CENTERING_LIMITS.yellow) return { key: 'yellow', label: 'Order Parts',      color: '#F1C40F' };
  return                                      { key: 'normal', label: 'Normal',           color: '#FFFFFF' };
}

function validateCenteringMeasurement(val) {
  if (val === '' || val === null || val === undefined) return { valid: false, number: null };
  var n = parseFloat(val);
  if (isNaN(n)) return { valid: false };
  if (n < CENTERING_RING_NOMINAL - 0.5 || n > CENTERING_RING_NOMINAL + 0.5) return { valid: false };
  return { valid: true, number: n };
}

function renderCenteringRing(container) {
  var indicators = {};
  var readouts   = {};
  container.innerHTML = '';

  var svg = svgEl('svg', { viewBox: '0 0 400 400', class: 'face-ring-svg' });

  // Outer ring
  svg.appendChild(svgEl('circle', { cx: CX, cy: CY, r: 148, fill: 'none', stroke: '#4A5568', 'stroke-width': 3 }));
  // Inner bore
  svg.appendChild(svgEl('circle', { cx: CX, cy: CY, r: 80,  fill: 'none', stroke: '#4A5568', 'stroke-width': 2 }));
  // Hub
  svg.appendChild(svgEl('circle', { cx: CX, cy: CY, r: 22,  fill: '#1A2535', stroke: '#4A5568', 'stroke-width': 2 }));
  svg.appendChild(svgEl('text', { x: CX, y: CY - 4, 'text-anchor': 'middle', fill: '#7F8C8D', 'font-size': 9, 'font-family': 'monospace' }, 'CTR'));
  svg.appendChild(svgEl('text', { x: CX, y: CY + 8, 'text-anchor': 'middle', fill: '#7F8C8D', 'font-size': 9, 'font-family': 'monospace' }, 'RING'));

  // 6 bolt holes equally spaced (as shown in drawing)
  for (var b = 0; b < 6; b++) {
    var ba = (b * 60 - 90) * Math.PI / 180;
    svg.appendChild(svgEl('circle', {
      cx: CX + Math.cos(ba) * 114,
      cy: CY + Math.sin(ba) * 114,
      r: 8, fill: '#1A2535', stroke: '#4A5568', 'stroke-width': 1.5
    }));
  }

  CENTERING_LOCATIONS.forEach(function(loc) {
    var rad  = (loc.angle * Math.PI) / 180;
    var cosA = Math.cos(rad);
    var sinA = Math.sin(rad);

    // Dashed axis
    svg.appendChild(svgEl('line', {
      x1: CX + cosA * 148, y1: CY - sinA * 148,
      x2: CX - cosA * 148, y2: CY + sinA * 148,
      stroke: '#2E3F55', 'stroke-width': 1, 'stroke-dasharray': '4 4'
    }));

    // End labels
    var LO = 148 + 22;
    var words = loc.label.split(' ');
    svg.appendChild(svgEl('text', {
      x: CX + cosA * LO, y: CY - sinA * LO,
      'text-anchor': 'middle', 'dominant-baseline': 'middle',
      fill: '#95A5A6', 'font-size': 11, 'font-weight': 'bold', 'font-family': 'monospace'
    }, words[0][0]));
    svg.appendChild(svgEl('text', {
      x: CX - cosA * LO, y: CY + sinA * LO,
      'text-anchor': 'middle', 'dominant-baseline': 'middle',
      fill: '#95A5A6', 'font-size': 11, 'font-weight': 'bold', 'font-family': 'monospace'
    }, words[1][0]));

    // Indicator dot
    var dot = svgEl('circle', {
      cx: CX + cosA * 148, cy: CY - sinA * 148,
      r: 10, fill: '#FFFFFF', stroke: '#2C3E50', 'stroke-width': 2
    });
    svg.appendChild(dot);
    indicators[loc.id] = dot;

    // Readout
    var RO = 148 - 20;
    var anchor = cosA > 0.15 ? 'end' : (cosA < -0.15 ? 'start' : 'middle');
    var readout = svgEl('text', {
      x: CX + cosA * RO, y: CY - sinA * RO,
      'text-anchor': anchor, 'dominant-baseline': 'middle',
      fill: 'transparent', 'font-size': 14, 'font-family': 'monospace'
    }, '');
    svg.appendChild(readout);
    readouts[loc.id] = readout;
  });

  container.appendChild(svg);
  return { indicators: indicators, readouts: readouts };
}

function updateCRColors(indicators, colorMap) {
  Object.keys(colorMap).forEach(function(id) {
    if (indicators[id]) indicators[id].setAttribute('fill', colorMap[id]);
  });
}

function updateCRReadouts(readouts, valueMap) {
  Object.keys(valueMap).forEach(function(id) {
    if (readouts[id]) {
      var val = valueMap[id];
      readouts[id].textContent = val || '';
      readouts[id].setAttribute('fill', val ? '#E8EDF2' : 'transparent');
    }
  });
}

function createCenteringRingModule(config) {
  var p = config.domPrefix || config.storageKey;
  var NOM_CR = config.nominal || CENTERING_RING_NOMINAL;

  var state = {
    inspector: '',
    date: '',
    measurements: { tb: '', lr: '' }
  };

  var el = {};
  var tbody;

  function init(container) {
    var draft = loadDraft(config.storageKey);
    state.measurements = (draft && draft.measurements) ? draft.measurements : { tb: '', lr: '' };
    state.inspector = (draft && draft.inspector) || '';
    state.date = (draft && draft.date) || '';

    var cardsHTML = CENTERING_LOCATIONS.map(function(loc) {
      return [
        '<div class="measurement-card" id="' + p + '-card-' + loc.id + '">',
        '  <div class="card-label">' + loc.label + '</div>',
        '  <input id="' + p + '-inp-' + loc.id + '" type="number" step="0.0001"',
        '    placeholder="' + NOM_CR.toFixed(4) + '" class="card-input" />',
        '  <div class="card-wear" id="' + p + '-wear-' + loc.id + '">\u2014</div>',
        '  <div class="card-status" id="' + p + '-stat-' + loc.id + '">\u2014</div>',
        '</div>'
      ].join('');
    }).join('');

    container.innerHTML = [
      '<div class="module-header">',
      '  <h2 class="module-title">' + config.title + '</h2>',
      '  <div class="module-meta">',
      '    <label class="meta-field"><span>Inspector</span>',
      '      <input id="' + p + '-inspector" type="text" placeholder="Name" class="meta-input" /></label>',
      '    <label class="meta-field"><span>Date</span>',
      '      <input id="' + p + '-date" type="date" class="meta-input" /></label>',
      '  </div>',
      '</div>',
      '<div class="module-body">',
      '  <div class="ring-panel">',
      '    <div class="panel-title">Centering Ring</div>',
      '    <div id="' + p + '-svg" class="svg-container"></div>',
      '    <p class="ring-caption">Nominal bore: ' + NOM_CR.toFixed(4) + '&Prime;</p>',
      '  </div>',
      '  <div class="data-panel">',
      '    <div id="' + p + '-banner" class="status-banner s-normal">\u2014</div>',
      '    <div class="measurements-grid">' + cardsHTML + '</div>',
      '  </div>',
      '</div>',
      '<div class="table-section">',
      '  <div class="panel-title">Inspection Results</div>',
      '  <div id="' + p + '-table"></div>',
      '</div>',
      '<div class="action-bar">',
      '  <button id="' + p + '-save"  class="btn btn-primary">Save Inspection</button>',
      '  <button id="' + p + '-reset" class="btn btn-ghost">Reset</button>',
      '  <button id="' + p + '-print" class="btn btn-ghost">Print Report</button>',
      '  <button id="' + p + '-save-combined" class="btn btn-primary">Save Combined Report</button>',
      '</div>'
    ].join('');

    el.banner    = container.querySelector('#' + p + '-banner');
    el.tableDiv  = container.querySelector('#' + p + '-table');
    el.inspector = container.querySelector('#' + p + '-inspector');
    el.date      = container.querySelector('#' + p + '-date');
    el.cards = {}; el.inputs = {}; el.wears = {}; el.stats = {};

    CENTERING_LOCATIONS.forEach(function(loc) {
      el.cards[loc.id]  = container.querySelector('#' + p + '-card-' + loc.id);
      el.inputs[loc.id] = container.querySelector('#' + p + '-inp-'  + loc.id);
      el.wears[loc.id]  = container.querySelector('#' + p + '-wear-' + loc.id);
      el.stats[loc.id]  = container.querySelector('#' + p + '-stat-' + loc.id);
    });

    var tbl = document.createElement('table');
    tbl.className = 'inspection-table';
    var cg = document.createElement('colgroup');
    [['col-location','35%'],['col-measurement','22%'],['col-wear','18%'],['col-status','25%']].forEach(function(c) {
      var col = document.createElement('col');
      col.className = c[0]; col.style.width = c[1]; cg.appendChild(col);
    });
    tbl.appendChild(cg);
    var hr = tbl.createTHead().insertRow();
    ['Location','Measurement','Wear','Status'].forEach(function(h) {
      var th = document.createElement('th'); th.textContent = h; hr.appendChild(th);
    });
    tbody = tbl.createTBody();
    el.tableDiv.appendChild(tbl);

    var today = new Date().toISOString().slice(0,10);
    if (!state.date) state.date = today;
    el.date.value = state.date;
    el.inspector.value = state.inspector;
    CENTERING_LOCATIONS.forEach(function(loc) {
      if (state.measurements[loc.id]) el.inputs[loc.id].value = state.measurements[loc.id];
    });

    CENTERING_LOCATIONS.forEach(function(loc) {
      el.inputs[loc.id].addEventListener('input', function(e) {
        state.measurements[loc.id] = e.target.value;
        update();
        persistDraft();
      });
    });
    el.inspector.addEventListener('input', function(e) { state.inspector = e.target.value; persistDraft(); });
    el.date.addEventListener('input', function(e) { state.date = e.target.value; persistDraft(); });
    container.querySelector('#' + p + '-save').addEventListener('click', save);
    container.querySelector('#' + p + '-reset').addEventListener('click', reset);
    container.querySelector('#' + p + '-print').addEventListener('click', function() { window.print(); });
    container.querySelector('#' + p + '-save-combined').addEventListener('click', function() { saveCombinedReport(config.groupKey); });

    el.svgRefs = renderCenteringRing(container.querySelector('#' + p + '-svg'));
    update();
  }

  function persistDraft() {
    saveDraftData(config.storageKey, { inspector: state.inspector, date: state.date, measurements: state.measurements });
  }

  function update() {
    var results = CENTERING_LOCATIONS.map(function(loc) {
      var v = (function(val) {
        if (val === '' || val === null || val === undefined) return { valid: false, number: null };
        var n = parseFloat(val); if (isNaN(n) || n < NOM_CR - 0.5 || n > NOM_CR + 0.5) return { valid: false };
        return { valid: true, number: n };
      })(state.measurements[loc.id]);
      if (!v.valid || v.number === null) return { id: loc.id, label: loc.label, measurement: null, wear: null, status: null };
      var wear = Math.round((v.number - NOM_CR) * 10000) / 10000;
      return { id: loc.id, label: loc.label, measurement: v.number, wear: wear, status: getCenteringStatus(wear) };
    });

    results.forEach(function(r) {
      el.wears[r.id].textContent = r.wear !== null ? fmt4(r.wear) + '"' : '\u2014';
      if (r.status) {
        el.stats[r.id].textContent = r.status.label;
        el.cards[r.id].style.setProperty('--card-accent', r.status.color);
      } else {
        el.stats[r.id].textContent = '\u2014';
        el.cards[r.id].style.setProperty('--card-accent', 'var(--color-border)');
      }
    });

    results.forEach(function(r) {
      var row = tbody.querySelector('tr[data-key="' + r.id + '"]');
      if (!row) { row = tbody.insertRow(); row.dataset.key = r.id; }
      row.innerHTML = '';
      [r.label,
       r.measurement !== null ? fmt4(r.measurement) + '"' : '\u2014',
       r.wear !== null ? fmt4(r.wear) + '"' : '\u2014',
       r.status ? r.status.label : '\u2014'
      ].forEach(function(t) { row.insertCell().textContent = t; });
      row.className = r.status && r.status.key !== 'normal' ? 's-' + r.status.key : '';
    });

    var valid = results.filter(function(r) { return r.wear !== null; });
    var overall = valid.length
      ? getCenteringStatus(Math.max.apply(null, valid.map(function(r) { return r.wear; })))
      : { key: 'normal', label: '\u2014' };
    el.banner.textContent = overall.label;
    el.banner.className = 'status-banner s-' + overall.key;

    var colorMap = {}, readoutMap = {};
    results.forEach(function(r) {
      colorMap[r.id]   = r.status ? r.status.color : '#FFFFFF';
      readoutMap[r.id] = r.measurement !== null ? r.measurement.toFixed(4) : '';
    });
    updateCRColors(el.svgRefs.indicators, colorMap);
    updateCRReadouts(el.svgRefs.readouts, readoutMap);
  }

  function save() {
    var id = storeSave(config.storageKey, { inspector: state.inspector, date: state.date, measurements: Object.assign({}, state.measurements) });
    if (id) showToast('Saving PDF…', 'success');
    else    showToast('Save failed', 'error');
    savePDF(config.title, config.groupKey, state.date);
  }

  function reset() {
    state.measurements = { tb: '', lr: '' };
    clearDraft(config.storageKey);
    CENTERING_LOCATIONS.forEach(function(loc) { el.inputs[loc.id].value = ''; });
    update();
  }

  return { init: init, config: config, type: 'centeringRing' };
}

// =============================================================================
// SLIPPER / WEAR LINER MODULE FACTORY
// Rectangular pad — 6 bolt locations in a 2-column × 3-row grid
// Columns: Drive Side (DS) / Operator Side (OS) — rows: Front / Center / Back
// Measurements taken toward the inside at each bolt
// No nominal — measurements are recorded as absolute thickness readings
// Status thresholds are based on remaining thickness (lower = more worn)
// =============================================================================

// Slipper nominal thickness (new): 60mm = 2.3622 inches
// Replace threshold: worn to 55mm = 2.1654 inches  (wear of 0.1968")
// Order parts at:   57mm = 2.2441 inches  (wear of 0.1181")
// Have parts ready: 56mm = 2.2047 inches  (wear of 0.1575")
// NOTE: for slippers wear = NOMINAL - MEASUREMENT (it gets thinner, not bigger)

var SLIPPER_NOMINAL = 17.3393;

var SLIPPER_LIMITS = {
  yellow: 0.0246,
  orange: 0.0492,
  red:    0.0984
};

var SLIPPER_LOCATIONS = [
  { id: 'ft', label: 'Front Top',    col: 0, row: 0 },
  { id: 'ct', label: 'Center Top',   col: 1, row: 0 },
  { id: 'bt', label: 'Back Top',     col: 2, row: 0 },
  { id: 'fb', label: 'Front Bottom', col: 0, row: 1 },
  { id: 'cb', label: 'Center Bottom',col: 1, row: 1 },
  { id: 'bb', label: 'Back Bottom',  col: 2, row: 1 }
];

function calcSlipperWear(measurement) {
  return Math.round((measurement - SLIPPER_NOMINAL) * 10000) / 10000;
}

function getSlipperStatus(wear) {
  if (wear >= SLIPPER_LIMITS.red)    return { key: 'red',    label: 'Replace Part Now', color: '#C0392B' };
  if (wear >= SLIPPER_LIMITS.orange) return { key: 'orange', label: 'Have Parts Ready', color: '#E67E22' };
  if (wear >= SLIPPER_LIMITS.yellow) return { key: 'yellow', label: 'Order Parts',      color: '#F1C40F' };
  return                                    { key: 'normal', label: 'Normal',           color: '#FFFFFF' };
}

function validateSlipperMeasurement(val) {
  if (val === '' || val === null || val === undefined) return { valid: false, number: null };
  var n = parseFloat(val);
  if (isNaN(n)) return { valid: false };
  if (n < SLIPPER_NOMINAL - 0.5 || n > SLIPPER_NOMINAL + 0.5) return { valid: false };
  return { valid: true, number: n };
}

function renderSlipperSVG(container) {
  var indicators = {};
  var readouts   = {};
  container.innerHTML = '';

  // True isometric-style brick corner view:
  //
  //         fTL ──────────────── rTL
  //        /|                   /|
  //       / |   (top face)     / |
  //     fTR ──────────────── rTR  |   <- top face
  //      |  |                 |   |
  //      |  fBL               |  rBL
  //      | /   (front face)   | /     <- right face has the bolts
  //     fBR ──────────────── rBR
  //
  // Front face  = fTL, fTR, fBR, fBL  (narrow left face)
  // Top face    = fTL, rTL, rTR, fTR  (recedes upper-right)
  // Right face  = fTR, rTR, rBR, fBR  (wide, holds 6 bolts)

  var VW = 600, VH = 370;
  var svg = svgEl('svg', { viewBox: '0 0 ' + VW + ' ' + VH, class: 'face-ring-svg slipper-svg' });

  // Slab dimensions in SVG units
  var FW  = 42;    // front face width  (narrow — short end of slab)
  var FH  = 210;   // front face height (tall)
  var RW  = 320;   // right face width  (long dimension of slab)
  // recession angle: going right and slightly up
  var SX  = RW;    // x offset to recession point
  var SY  = -70;   // y offset to recession point (negative = up)

  // Anchor: front face bottom-left corner
  var AX = 95, AY = 300;

  // Front face corners
  var fBL = { x: AX,        y: AY       };
  var fBR = { x: AX + FW,   y: AY       };
  var fTR = { x: AX + FW,   y: AY - FH  };
  var fTL = { x: AX,        y: AY - FH  };

  // Right face corners (recession from front-right edge)
  var rBR = { x: fBR.x + SX, y: fBR.y + SY };
  var rTR = { x: fTR.x + SX, y: fTR.y + SY };
  var rTL = fTR;   // shared with front face top-right
  var rBL = fBR;   // shared with front face bottom-right

  // Top face corners
  var tFL = fTL;
  var tFR = fTR;
  var tBR = rTR;
  var tBL = { x: fTL.x + SX, y: fTL.y + SY };

  function pts(arr) {
    return arr.map(function(p) { return p.x.toFixed(1) + ',' + p.y.toFixed(1); }).join(' ');
  }

  // Draw back-to-front

  // Top face (darkest — recedes away from viewer)
  svg.appendChild(svgEl('polygon', {
    points: pts([tFL, tFR, tBR, tBL]),
    fill: '#0F1A28', stroke: '#3A4F65', 'stroke-width': 1.5
  }));

  // Front face (medium — narrow left face)
  svg.appendChild(svgEl('polygon', {
    points: pts([fBL, fBR, fTR, fTL]),
    fill: '#162030', stroke: '#4A5568', 'stroke-width': 2
  }));

  // Right face (lightest — faces viewer, holds bolts)
  svg.appendChild(svgEl('polygon', {
    points: pts([rBL, rBR, rTR, rTL]),
    fill: '#1E2E45', stroke: '#4A5568', 'stroke-width': 2
  }));

  // Bilinear interpolation across the right face
  // u = 0..1  bottom → top      (maps to rows: Front/Center/Back)
  // v = 0..1  left → right      (maps to cols: Top/Bottom)
  function facePoint(u, v) {
    var left  = { x: rBL.x + u * (rTL.x - rBL.x), y: rBL.y + u * (rTL.y - rBL.y) };
    var right = { x: rBR.x + u * (rTR.x - rBR.x), y: rBR.y + u * (rTR.y - rBR.y) };
    return {
      x: left.x + v * (right.x - left.x),
      y: left.y + v * (right.y - left.y)
    };
  }

  // Dashed row dividers (split Front/Center/Back — horizontal on the right face)
  [1/3, 2/3].forEach(function(u) {
    var p0 = facePoint(u, 0.02), p1 = facePoint(u, 0.98);
    svg.appendChild(svgEl('line', {
      x1: p0.x.toFixed(1), y1: p0.y.toFixed(1),
      x2: p1.x.toFixed(1), y2: p1.y.toFixed(1),
      stroke: '#2E3F55', 'stroke-width': 1, 'stroke-dasharray': '6 3'
    }));
  });

  // Dashed row divider (split Top/Bottom — 1 horizontal line at u=0.5)
  var r0 = facePoint(0.5, 0.02), r1 = facePoint(0.5, 0.98);
  svg.appendChild(svgEl('line', {
    x1: r0.x.toFixed(1), y1: r0.y.toFixed(1),
    x2: r1.x.toFixed(1), y2: r1.y.toFixed(1),
    stroke: '#2E3F55', 'stroke-width': 1, 'stroke-dasharray': '6 3'
  }));

  // Dashed column dividers (split Front/Center/Back — 2 vertical lines at v=1/3, 2/3)
  [1/3, 2/3].forEach(function(v) {
    var p0 = facePoint(0.02, v), p1 = facePoint(0.98, v);
    svg.appendChild(svgEl('line', {
      x1: p0.x.toFixed(1), y1: p0.y.toFixed(1),
      x2: p1.x.toFixed(1), y2: p1.y.toFixed(1),
      stroke: '#2E3F55', 'stroke-width': 1, 'stroke-dasharray': '6 3'
    }));
  });

  // Row labels: TOP / BOTTOM — LEFT side of right face
  // u=0 is top of face, u=1 is bottom — so TOP is i=0 (low u), BOTTOM is i=1 (high u)
  // But visually the face goes bottom-left to upper-right, so u=0 = bottom of screen
  // Swap to ['BOTTOM','TOP'] so the label that appears higher on screen reads TOP
  ['BOTTOM', 'TOP'].forEach(function(label, i) {
    var p = facePoint((i * 2 + 1) / 4, 0);
    svg.appendChild(svgEl('text', {
      x: (p.x - 20).toFixed(1), y: p.y.toFixed(1),
      'text-anchor': 'end', 'dominant-baseline': 'middle',
      fill: '#7F8C8D', 'font-size': 13, 'font-family': 'monospace', 'font-weight': 'bold'
    }, label));
  });

  // Column labels: FRONT / CENTER / BACK — above the right face top edge (along v axis)
  ['FRONT', 'CENTER', 'BACK'].forEach(function(label, j) {
    var p = facePoint(1, (j * 2 + 1) / 6);
    svg.appendChild(svgEl('text', {
      x: p.x.toFixed(1), y: (p.y - 22).toFixed(1),
      'text-anchor': 'middle', 'dominant-baseline': 'middle',
      fill: '#7F8C8D', 'font-size': 13, 'font-family': 'monospace', 'font-weight': 'bold'
    }, label));
  });

  // Bolt holes on the right face
  // loc.col = 0(Front)/1(Center)/2(Back) → v axis (left → right)
  // loc.row = 0(Top)  /1(Bottom)         → u axis (top → bottom)
  SLIPPER_LOCATIONS.forEach(function(loc) {
    var u = (loc.row * 2 + 1) / 4;
    var v = (loc.col * 2 + 1) / 6;
    var pt = facePoint(u, v);

    // Bolt hole — circle (right face is close to vertical so circles work)
    svg.appendChild(svgEl('circle', {
      cx: pt.x.toFixed(1), cy: pt.y.toFixed(1), r: 16,
      fill: '#0A1220', stroke: '#3A4F65', 'stroke-width': 1.5
    }));
    svg.appendChild(svgEl('circle', {
      cx: pt.x.toFixed(1), cy: pt.y.toFixed(1), r: 8,
      fill: '#162030', stroke: '#2E3F55', 'stroke-width': 1.5
    }));
    svg.appendChild(svgEl('circle', {
      cx: pt.x.toFixed(1), cy: pt.y.toFixed(1), r: 3,
      fill: '#0A1220', stroke: 'none'
    }));

    // Status indicator ring
    var dot = svgEl('circle', {
      cx: pt.x.toFixed(1), cy: pt.y.toFixed(1), r: 16,
      fill: 'none', stroke: '#FFFFFF', 'stroke-width': 2.5
    });
    svg.appendChild(dot);
    indicators[loc.id] = dot;

    // Readout below bolt
    var readout = svgEl('text', {
      x: pt.x.toFixed(1), y: (pt.y + 26).toFixed(1),
      'text-anchor': 'middle', 'dominant-baseline': 'middle',
      fill: 'transparent', 'font-size': 13, 'font-family': 'monospace'
    }, '');
    svg.appendChild(readout);
    readouts[loc.id] = readout;
  });

  // Label on the front face
  svg.appendChild(svgEl('text', {
    x: ((fBL.x + fTR.x) / 2).toFixed(1),
    y: ((fBL.y + fTR.y) / 2).toFixed(1),
    'text-anchor': 'middle', 'dominant-baseline': 'middle',
    fill: '#2A3A50', 'font-size': 8, 'font-family': 'monospace', 'font-weight': 'bold',
    transform: 'rotate(-90 ' + ((fBL.x + fTR.x) / 2).toFixed(1) + ' ' + ((fBL.y + fTR.y) / 2).toFixed(1) + ')'
  }, 'SLIPPER'));

  container.appendChild(svg);
  return { indicators: indicators, readouts: readouts };
}

function updateSlipperColors(indicators, colorMap) {
  Object.keys(colorMap).forEach(function(id) {
    if (indicators[id]) indicators[id].setAttribute('stroke', colorMap[id]);
  });
}

function updateSlipperReadouts(readouts, valueMap) {
  Object.keys(valueMap).forEach(function(id) {
    if (readouts[id]) {
      var val = valueMap[id];
      readouts[id].textContent = val || '';
      readouts[id].setAttribute('fill', val ? '#E8EDF2' : 'transparent');
    }
  });
}

function createSlipperModule(config) {
  var p = config.domPrefix || config.storageKey;
  var NOM_SL = config.nominal || SLIPPER_NOMINAL;

  var emptyMeasurements = function() {
    var m = {};
    SLIPPER_LOCATIONS.forEach(function(loc) { m[loc.id] = ''; });
    return m;
  };

  var state = { inspector: '', date: '', measurements: emptyMeasurements() };
  var el = {};
  var tbody;

  function init(container) {
    var draft = loadDraft(config.storageKey);
    state.measurements = (draft && draft.measurements) ? draft.measurements : emptyMeasurements();
    state.inspector = (draft && draft.inspector) || '';
    state.date = (draft && draft.date) || '';

    // Cards in a 2-col grid matching the slipper layout
    var cardsHTML = SLIPPER_LOCATIONS.map(function(loc) {
      return [
        '<div class="measurement-card" id="' + p + '-card-' + loc.id + '">',
        '  <div class="card-label">' + loc.label + '</div>',
        '  <input id="' + p + '-inp-' + loc.id + '" type="number" step="0.0001"',
        '    placeholder="' + NOM_SL.toFixed(4) + '" class="card-input" />',
        '  <div class="card-wear" id="' + p + '-wear-' + loc.id + '">\u2014</div>',
        '  <div class="card-status" id="' + p + '-stat-' + loc.id + '">\u2014</div>',
        '</div>'
      ].join('');
    }).join('');

    container.innerHTML = [
      '<div class="module-header">',
      '  <h2 class="module-title">' + config.title + '</h2>',
      '  <div class="module-meta">',
      '    <label class="meta-field"><span>Inspector</span>',
      '      <input id="' + p + '-inspector" type="text" placeholder="Name" class="meta-input" /></label>',
      '    <label class="meta-field"><span>Date</span>',
      '      <input id="' + p + '-date" type="date" class="meta-input" /></label>',
      '  </div>',
      '</div>',
      '<div class="module-body slipper-module">',
      '  <div class="ring-panel">',
      '    <div class="panel-title">Slipper / Wear Liner</div>',
      '    <div id="' + p + '-svg" class="svg-container" style="aspect-ratio:1.556"></div>',
      '    <p class="ring-caption">Nominal gap: ' + NOM_SL.toFixed(4) + '&Prime;</p>',
      '  </div>',
      '  <div class="data-panel">',
      '    <div id="' + p + '-banner" class="status-banner s-normal">\u2014</div>',
      '    <div class="measurements-grid slipper-grid">' + cardsHTML + '</div>',
      '  </div>',
      '</div>',
      '<div class="table-section">',
      '  <div class="panel-title">Inspection Results</div>',
      '  <div id="' + p + '-table"></div>',
      '</div>',
      '<div class="action-bar">',
      '  <button id="' + p + '-save"  class="btn btn-primary">Save Inspection</button>',
      '  <button id="' + p + '-reset" class="btn btn-ghost">Reset</button>',
      '  <button id="' + p + '-print" class="btn btn-ghost">Print Report</button>',
      '  <button id="' + p + '-save-combined" class="btn btn-primary">Save Combined Report</button>',
      '</div>'
    ].join('');

    el.banner    = container.querySelector('#' + p + '-banner');
    el.tableDiv  = container.querySelector('#' + p + '-table');
    el.inspector = container.querySelector('#' + p + '-inspector');
    el.date      = container.querySelector('#' + p + '-date');
    el.cards = {}; el.inputs = {}; el.wears = {}; el.stats = {};

    SLIPPER_LOCATIONS.forEach(function(loc) {
      el.cards[loc.id]  = container.querySelector('#' + p + '-card-' + loc.id);
      el.inputs[loc.id] = container.querySelector('#' + p + '-inp-'  + loc.id);
      el.wears[loc.id]  = container.querySelector('#' + p + '-wear-' + loc.id);
      el.stats[loc.id]  = container.querySelector('#' + p + '-stat-' + loc.id);
    });

    var tbl = document.createElement('table');
    tbl.className = 'inspection-table';
    var cg = document.createElement('colgroup');
    [['col-location','35%'],['col-measurement','22%'],['col-wear','18%'],['col-status','25%']].forEach(function(c) {
      var col = document.createElement('col');
      col.className = c[0]; col.style.width = c[1]; cg.appendChild(col);
    });
    tbl.appendChild(cg);
    var hr = tbl.createTHead().insertRow();
    ['Location','Measurement','Wear','Status'].forEach(function(h) {
      var th = document.createElement('th'); th.textContent = h; hr.appendChild(th);
    });
    tbody = tbl.createTBody();
    el.tableDiv.appendChild(tbl);

    var today = new Date().toISOString().slice(0,10);
    if (!state.date) state.date = today;
    el.date.value = state.date;
    el.inspector.value = state.inspector;
    SLIPPER_LOCATIONS.forEach(function(loc) {
      if (state.measurements[loc.id]) el.inputs[loc.id].value = state.measurements[loc.id];
    });

    SLIPPER_LOCATIONS.forEach(function(loc) {
      el.inputs[loc.id].addEventListener('input', function(e) {
        state.measurements[loc.id] = e.target.value;
        update();
        persistDraft();
      });
    });
    el.inspector.addEventListener('input', function(e) { state.inspector = e.target.value; persistDraft(); });
    el.date.addEventListener('input', function(e) { state.date = e.target.value; persistDraft(); });
    container.querySelector('#' + p + '-save').addEventListener('click', save);
    container.querySelector('#' + p + '-reset').addEventListener('click', reset);
    container.querySelector('#' + p + '-print').addEventListener('click', function() { window.print(); });
    container.querySelector('#' + p + '-save-combined').addEventListener('click', function() { saveCombinedReport(config.groupKey); });

    el.svgRefs = renderSlipperSVG(container.querySelector('#' + p + '-svg'));
    update();
  }

  function persistDraft() {
    saveDraftData(config.storageKey, { inspector: state.inspector, date: state.date, measurements: state.measurements });
  }

  function update() {
    var results = SLIPPER_LOCATIONS.map(function(loc) {
      var v = (function(val) {
        if (val === '' || val === null || val === undefined) return { valid: false, number: null };
        var n = parseFloat(val); if (isNaN(n) || n < NOM_SL - 0.5 || n > NOM_SL + 0.5) return { valid: false };
        return { valid: true, number: n };
      })(state.measurements[loc.id]);
      if (!v.valid || v.number === null) return { id: loc.id, label: loc.label, measurement: null, wear: null, status: null };
      var wear = Math.round((v.number - NOM_SL) * 10000) / 10000;
      return { id: loc.id, label: loc.label, measurement: v.number, wear: wear, status: getSlipperStatus(wear) };
    });

    results.forEach(function(r) {
      el.wears[r.id].textContent = r.wear !== null ? fmt4(r.wear) + '"' : '\u2014';
      if (r.status) {
        el.stats[r.id].textContent = r.status.label;
        el.cards[r.id].style.setProperty('--card-accent', r.status.color);
      } else {
        el.stats[r.id].textContent = '\u2014';
        el.cards[r.id].style.setProperty('--card-accent', 'var(--color-border)');
      }
    });

    results.forEach(function(r) {
      var row = tbody.querySelector('tr[data-key="' + r.id + '"]');
      if (!row) { row = tbody.insertRow(); row.dataset.key = r.id; }
      row.innerHTML = '';
      [r.label,
       r.measurement !== null ? fmt4(r.measurement) + '"' : '\u2014',
       r.wear !== null ? fmt4(r.wear) + '"' : '\u2014',
       r.status ? r.status.label : '\u2014'
      ].forEach(function(t) { row.insertCell().textContent = t; });
      row.className = r.status && r.status.key !== 'normal' ? 's-' + r.status.key : '';
    });

    var valid = results.filter(function(r) { return r.wear !== null; });
    var overall = valid.length
      ? getSlipperStatus(Math.max.apply(null, valid.map(function(r) { return r.wear; })))
      : { key: 'normal', label: '\u2014' };
    el.banner.textContent = overall.label;
    el.banner.className = 'status-banner s-' + overall.key;

    var colorMap = {}, readoutMap = {};
    results.forEach(function(r) {
      colorMap[r.id]   = r.status ? r.status.color : '#FFFFFF';
      readoutMap[r.id] = r.measurement !== null ? r.measurement.toFixed(4) : '';
    });
    updateSlipperColors(el.svgRefs.indicators, colorMap);
    updateSlipperReadouts(el.svgRefs.readouts, readoutMap);
  }

  function save() {
    var id = storeSave(config.storageKey, { inspector: state.inspector, date: state.date, measurements: Object.assign({}, state.measurements) });
    if (id) showToast('Saving PDF…', 'success');
    else    showToast('Save failed', 'error');
    savePDF(config.title, config.groupKey, state.date);
  }

  function reset() {
    state.measurements = emptyMeasurements();
    clearDraft(config.storageKey);
    SLIPPER_LOCATIONS.forEach(function(loc) { el.inputs[loc.id].value = ''; });
    update();
  }

  return { init: init, config: config, type: 'slipper' };
}

// =============================================================================
// SLIDING SHOE MODULE FACTORY
// 4 sections: Top East, Top West, Bottom East, Bottom West
// Each section: 4 rows (3-2-2-3 points), arc layout
// Status = sum of each row's max value
// Thresholds on sum: yellow >= 0.050, orange >= 0.100, red >= 0.200
// =============================================================================

var SS_LIMITS = { yellow: 0.050, orange: 0.100, red: 0.200 };

var SS_SECTIONS = [
  { id: 'te', label: 'Top East'    },
  { id: 'tw', label: 'Top West'    },
  { id: 'be', label: 'Bottom East' },
  { id: 'bw', label: 'Bottom West' }
];

var SS_ROW_COUNTS = [3, 2, 2, 3];
var SS_ROW_LABELS = ['Arc Top', 'Mid Upper', 'Mid Lower', 'Arc Bottom'];

function getSSStatus(sum) {
  if (sum >= SS_LIMITS.red)    return { key: 'red',    label: 'Replace Part Now', color: '#C0392B' };
  if (sum >= SS_LIMITS.orange) return { key: 'orange', label: 'Have Parts Ready', color: '#E67E22' };
  if (sum >= SS_LIMITS.yellow) return { key: 'yellow', label: 'Order Parts',      color: '#F1C40F' };
  return                              { key: 'normal', label: 'Normal',           color: '#FFFFFF' };
}

function validateSSMeasurement(val) {
  if (val === '' || val === null || val === undefined) return { valid: false, number: null };
  var n = parseFloat(val);
  if (isNaN(n) || n < 0 || n > 2) return { valid: false };
  return { valid: true, number: n };
}

function ssEmptyMeasurements() {
  var m = {};
  SS_SECTIONS.forEach(function(sec) {
    m[sec.id] = {};
    SS_ROW_COUNTS.forEach(function(count, ri) {
      m[sec.id]['r' + ri] = [];
      for (var i = 0; i < count; i++) m[sec.id]['r' + ri].push('');
    });
  });
  return m;
}

function computeSSResults(measurements) {
  return SS_SECTIONS.map(function(sec) {
    var rowMaxes = SS_ROW_COUNTS.map(function(count, ri) {
      var vals = measurements[sec.id]['r' + ri]
        .map(function(v) { return validateSSMeasurement(v); })
        .filter(function(v) { return v.valid && v.number !== null; })
        .map(function(v) { return v.number; });
      return vals.length ? Math.max.apply(null, vals) : null;
    });
    var validMaxes = rowMaxes.filter(function(v) { return v !== null; });
    var sum = validMaxes.length === SS_ROW_COUNTS.length
      ? Math.round(validMaxes.reduce(function(a, b) { return a + b; }, 0) * 10000) / 10000
      : null;
    return { id: sec.id, label: sec.label, rowMaxes: rowMaxes, sum: sum, status: sum !== null ? getSSStatus(sum) : null };
  });
}

function renderSSSectionSVG(container, sectionId, measurements, onInput) {
  container.innerHTML = '';
  var VW = 200, VH = 220, cx = 100, cy = 110, arcR = 72;
  var svg = svgEl('svg', { viewBox: '0 0 ' + VW + ' ' + VH, width: '100%', height: '100%' });

  function arcPath(startDeg, endDeg, r) {
    var s = startDeg * Math.PI / 180, e = endDeg * Math.PI / 180;
    return 'M ' + (cx + r * Math.cos(s)).toFixed(1) + ' ' + (cy + r * Math.sin(s)).toFixed(1) +
           ' A ' + r + ' ' + r + ' 0 0 1 ' + (cx + r * Math.cos(e)).toFixed(1) + ' ' + (cy + r * Math.sin(e)).toFixed(1);
  }

  svg.appendChild(svgEl('path', { d: arcPath(210, 330, arcR), fill: 'none', stroke: '#C0392B', 'stroke-width': 2.5, 'stroke-linecap': 'round' }));
  svg.appendChild(svgEl('path', { d: arcPath(30, 150, arcR),  fill: 'none', stroke: '#C0392B', 'stroke-width': 2.5, 'stroke-linecap': 'round' }));

  var pts = [
    [
      { x: cx + arcR * Math.cos(210 * Math.PI/180), y: cy + arcR * Math.sin(210 * Math.PI/180) },
      { x: cx + arcR * Math.cos(270 * Math.PI/180), y: cy + arcR * Math.sin(270 * Math.PI/180) },
      { x: cx + arcR * Math.cos(330 * Math.PI/180), y: cy + arcR * Math.sin(330 * Math.PI/180) }
    ],
    [ { x: cx - 28, y: cy - 18 }, { x: cx + 28, y: cy - 18 } ],
    [ { x: cx - 28, y: cy + 18 }, { x: cx + 28, y: cy + 18 } ],
    [
      { x: cx + arcR * Math.cos(30  * Math.PI/180), y: cy + arcR * Math.sin(30  * Math.PI/180) },
      { x: cx + arcR * Math.cos(90  * Math.PI/180), y: cy + arcR * Math.sin(90  * Math.PI/180) },
      { x: cx + arcR * Math.cos(150 * Math.PI/180), y: cy + arcR * Math.sin(150 * Math.PI/180) }
    ]
  ];

  pts.forEach(function(rowPts, ri) {
    rowPts.forEach(function(pt, pi) {
      var fo = document.createElementNS(SVG_NS, 'foreignObject');
      fo.setAttribute('x', (pt.x - 22).toFixed(1));
      fo.setAttribute('y', (pt.y - 11).toFixed(1));
      fo.setAttribute('width', 44);
      fo.setAttribute('height', 22);
      var inp = document.createElement('input');
      inp.type = 'number';
      inp.step = '0.001';
      inp.className = 'ss-point-input';
      inp.value = measurements[sectionId]['r' + ri][pi] || '';
      inp.addEventListener('input', function(e) { onInput(ri, pi, e.target.value); });
      fo.appendChild(inp);
      svg.appendChild(fo);
    });
  });

  container.appendChild(svg);
}

function createSlidingShoeModule(config) {
  var p = config.domPrefix || config.storageKey;
  var state = { inspector: '', date: '', measurements: ssEmptyMeasurements() };
  var el = {};
  var tbody;
  var containerRef;

  function init(container) {
    containerRef = container;
    var draft = loadDraft(config.storageKey);
    state.measurements = (draft && draft.measurements) ? draft.measurements : ssEmptyMeasurements();
    state.inspector = (draft && draft.inspector) || '';
    state.date = (draft && draft.date) || '';

    var sectionsHTML = SS_SECTIONS.map(function(sec) {
      return [
        '<div class="ss-section-card" id="' + p + '-sec-' + sec.id + '">',
        '  <div class="ss-section-title">' + sec.label + '</div>',
        '  <div class="ss-section-body">',
        '    <div class="ss-svg-wrap" id="' + p + '-svg-' + sec.id + '"></div>',
        '    <div class="ss-row-summary">',
        SS_ROW_LABELS.map(function(lbl, ri) {
          return '<div class="ss-row-line"><span class="ss-row-lbl">' + lbl + '</span>' +
                 '<span class="ss-row-max" id="' + p + '-max-' + sec.id + '-' + ri + '">—</span></div>';
        }).join(''),
        '    </div>',
        '  </div>',
        '  <div class="ss-section-footer">',
        '    <span class="ss-sum-label">Row Max Sum:</span>',
        '    <span class="ss-sum-val" id="' + p + '-sum-' + sec.id + '">—</span>',
        '    <span class="ss-status-lbl" id="' + p + '-sts-' + sec.id + '">—</span>',
        '  </div>',
        '</div>'
      ].join('');
    }).join('');

    container.innerHTML = [
      '<div class="module-header">',
      '  <h2 class="module-title">' + config.title + '</h2>',
      '  <div class="module-meta">',
      '    <label class="meta-field"><span>Inspector</span>',
      '      <input id="' + p + '-inspector" type="text" placeholder="Name" class="meta-input" /></label>',
      '    <label class="meta-field"><span>Date</span>',
      '      <input id="' + p + '-date" type="date" class="meta-input" /></label>',
      '  </div>',
      '</div>',
      '<div id="' + p + '-banner" class="status-banner s-normal">—</div>',
      '<div class="ss-grid">' + sectionsHTML + '</div>',
      '<div class="table-section">',
      '  <div class="panel-title">Inspection Results</div>',
      '  <div id="' + p + '-table"></div>',
      '</div>',
      '<div class="action-bar">',
      '  <button id="' + p + '-save"  class="btn btn-primary">Save Inspection</button>',
      '  <button id="' + p + '-reset" class="btn btn-ghost">Reset</button>',
      '  <button id="' + p + '-print" class="btn btn-ghost">Print Report</button>',
      '  <button id="' + p + '-save-combined" class="btn btn-primary">Save Combined Report</button>',
      '</div>'
    ].join('');

    el.banner    = container.querySelector('#' + p + '-banner');
    el.tableDiv  = container.querySelector('#' + p + '-table');
    el.inspector = container.querySelector('#' + p + '-inspector');
    el.date      = container.querySelector('#' + p + '-date');

    // Cache section refs scoped to THIS container, rather than looking them
    // up globally by id — two mounted instances (e.g. the live tab plus a
    // throwaway combined-report copy) share the same id prefix, so a global
    // document.getElementById lookup could grab the wrong instance's DOM.
    el.card = {}; el.sum = {}; el.sts = {}; el.rowMax = {};
    SS_SECTIONS.forEach(function(sec) {
      el.card[sec.id] = container.querySelector('#' + p + '-sec-' + sec.id);
      el.sum[sec.id]  = container.querySelector('#' + p + '-sum-' + sec.id);
      el.sts[sec.id]  = container.querySelector('#' + p + '-sts-' + sec.id);
      el.rowMax[sec.id] = SS_ROW_LABELS.map(function(_, ri) {
        return container.querySelector('#' + p + '-max-' + sec.id + '-' + ri);
      });
    });

    var tbl = document.createElement('table');
    tbl.className = 'inspection-table';
    var cg = document.createElement('colgroup');
    [['col-location','22%'],['','13%'],['','13%'],['','13%'],['','13%'],['','13%'],['col-status','13%']].forEach(function(cc) {
      var col = document.createElement('col');
      if (cc[0]) col.className = cc[0];
      col.style.width = cc[1];
      cg.appendChild(col);
    });
    tbl.appendChild(cg);
    var hr = tbl.createTHead().insertRow();
    ['Section', 'Arc Top', 'Mid Upper', 'Mid Lower', 'Arc Bottom', 'Sum', 'Status'].forEach(function(h) {
      var th = document.createElement('th'); th.textContent = h; hr.appendChild(th);
    });
    tbody = tbl.createTBody();
    el.tableDiv.appendChild(tbl);

    var today = new Date().toISOString().slice(0,10);
    if (!state.date) state.date = today;
    el.date.value = state.date;
    el.inspector.value = state.inspector;
    el.inspector.addEventListener('input', function(e) { state.inspector = e.target.value; persistDraft(); });
    el.date.addEventListener('input', function(e) { state.date = e.target.value; persistDraft(); });
    container.querySelector('#' + p + '-save').addEventListener('click', save);
    container.querySelector('#' + p + '-reset').addEventListener('click', reset);
    container.querySelector('#' + p + '-print').addEventListener('click', function() { window.print(); });
    container.querySelector('#' + p + '-save-combined').addEventListener('click', function() { saveCombinedReport(config.groupKey); });

    SS_SECTIONS.forEach(function(sec) {
      var wrap = container.querySelector('#' + p + '-svg-' + sec.id);
      renderSSSectionSVG(wrap, sec.id, state.measurements, function(ri, pi, val) {
        state.measurements[sec.id]['r' + ri][pi] = val;
        update();
        persistDraft();
      });
    });

    update();
  }

  function persistDraft() {
    saveDraftData(config.storageKey, { inspector: state.inspector, date: state.date, measurements: state.measurements });
  }

  function update() {
    var results = computeSSResults(state.measurements);

    results.forEach(function(r) {
      r.rowMaxes.forEach(function(mx, ri) {
        var maxEl = el.rowMax[r.id][ri];
        if (maxEl) maxEl.textContent = mx !== null ? mx.toFixed(3) + '"' : '—';
      });
      var sumEl = el.sum[r.id];
      var stsEl = el.sts[r.id];
      var card  = el.card[r.id];
      if (sumEl) sumEl.textContent = r.sum !== null ? r.sum.toFixed(3) + '"' : '—';
      if (stsEl) { stsEl.textContent = r.status ? r.status.label : '—'; stsEl.style.color = r.status ? r.status.color : ''; }
      if (card)  card.style.borderColor = r.status && r.status.key !== 'normal' ? r.status.color : '';
    });

    var valid = results.filter(function(r) { return r.sum !== null; });
    var overall = valid.length ? getSSStatus(Math.max.apply(null, valid.map(function(r) { return r.sum; }))) : { key: 'normal', label: '—' };
    el.banner.textContent = overall.label;
    el.banner.className = 'status-banner s-' + overall.key;

    results.forEach(function(r) {
      var row = tbody.querySelector('tr[data-key="' + r.id + '"]');
      if (!row) { row = tbody.insertRow(); row.dataset.key = r.id; }
      row.innerHTML = '';
      var cells = [r.label].concat(r.rowMaxes.map(function(mx) { return mx !== null ? mx.toFixed(3) + '"' : '—'; }));
      cells.push(r.sum !== null ? r.sum.toFixed(3) + '"' : '—');
      cells.push(r.status ? r.status.label : '—');
      cells.forEach(function(t) { row.insertCell().textContent = t; });
      row.className = r.status && r.status.key !== 'normal' ? 's-' + r.status.key : '';
    });
  }

  function save() {
    var id = storeSave(config.storageKey, { inspector: state.inspector, date: state.date, measurements: JSON.parse(JSON.stringify(state.measurements)) });
    if (id) showToast('Saving PDF…', 'success');
    else    showToast('Save failed', 'error');
    savePDF(config.title, config.groupKey, state.date);
  }

  function reset() {
    state.measurements = ssEmptyMeasurements();
    clearDraft(config.storageKey);
    SS_SECTIONS.forEach(function(sec) {
      var wrap = containerRef.querySelector('#' + p + '-svg-' + sec.id);
      if (wrap) renderSSSectionSVG(wrap, sec.id, state.measurements, function(ri, pi, val) {
        state.measurements[sec.id]['r' + ri][pi] = val;
        update();
        persistDraft();
      });
    });
    update();
  }

  return { init: init, config: config, type: 'slidingShoe' };
}

// =============================================================================
// MODULE REGISTRY & BOOTSTRAP
// =============================================================================

// Each entry defines a parent group and its sub-tabs.
// Adding a new sub-module = add one entry to the tabs array.
var ROUGHER_FR_NOMINAL  = 27.8051;
var ROUGHER_CR_NOMINAL  = 13.2953;
var ROUGHER_SL_NOMINAL  = 20.0953;

var NAV_GROUPS = [
  // ── Rougher Mill ──────────────────────────────────────────────────────────
  {
    label: 'Rougher Bottom Wobbler',
    key: 'rougher_bottom',
    tabs: [
      { id: 'rougher-bottom-face-ring',     label: 'Face Ring',     module: createFaceRingModule({     storageKey: 'rougher_bottom_face_ring', groupKey: 'rougher_bottom',     title: 'Rougher Bottom Wobbler — Face Ring Inspection',     nominal: ROUGHER_FR_NOMINAL }) },
      { id: 'rougher-bottom-centering-ring',label: 'Centering Ring',module: createCenteringRingModule({ storageKey: 'rougher_bottom_centering_ring', groupKey: 'rougher_bottom',title: 'Rougher Bottom Wobbler — Centering Ring Inspection',nominal: ROUGHER_CR_NOMINAL }) },
      { id: 'rougher-bottom-slipper',       label: 'Slipper',       module: createSlipperModule({       storageKey: 'rougher_bottom_slipper', groupKey: 'rougher_bottom',       title: 'Rougher Bottom Wobbler — Slipper Inspection',       nominal: ROUGHER_SL_NOMINAL }) },
      { id: 'rougher-bottom-sliding-shoe',  label: 'Sliding Shoe',  module: createSlidingShoeModule({   storageKey: 'rougher_bottom_sliding_shoe', groupKey: 'rougher_bottom',  title: 'Rougher Bottom Wobbler — Sliding Shoe Inspection' }) }
    ]
  },
  {
    label: 'Rougher Top Wobbler',
    key: 'rougher_top',
    tabs: [
      { id: 'rougher-top-face-ring',        label: 'Face Ring',     module: createFaceRingModule({     storageKey: 'rougher_top_face_ring', groupKey: 'rougher_top',        title: 'Rougher Top Wobbler — Face Ring Inspection',        nominal: ROUGHER_FR_NOMINAL }) },
      { id: 'rougher-top-centering-ring',   label: 'Centering Ring',module: createCenteringRingModule({ storageKey: 'rougher_top_centering_ring', groupKey: 'rougher_top',   title: 'Rougher Top Wobbler — Centering Ring Inspection',   nominal: ROUGHER_CR_NOMINAL }) },
      { id: 'rougher-top-slipper',          label: 'Slipper',       module: createSlipperModule({       storageKey: 'rougher_top_slipper', groupKey: 'rougher_top',          title: 'Rougher Top Wobbler — Slipper Inspection',          nominal: ROUGHER_SL_NOMINAL }) },
      { id: 'rougher-top-sliding-shoe',     label: 'Sliding Shoe',  module: createSlidingShoeModule({   storageKey: 'rougher_top_sliding_shoe', groupKey: 'rougher_top',     title: 'Rougher Top Wobbler — Sliding Shoe Inspection' }) }
    ]
  },
  // ── Steckel Mill ──────────────────────────────────────────────────────────
  {
    label: 'Bottom Wobbler',
    key: 'steckel_bottom',
    tabs: [
      {
        id:     'bottom-face-ring',
        label:  'Face Ring',
        module: createFaceRingModule({
          storageKey: 'bottom_face_ring', groupKey: 'steckel_bottom',
          title:      'Bottom Wobbler \u2014 Face Ring Inspection',
          nominal:    NEW_RING
        })
      },
      {
        id:     'bottom-centering-ring',
        label:  'Centering Ring',
        module: createCenteringRingModule({
          storageKey: 'bottom_centering_ring', groupKey: 'steckel_bottom',
          title:      'Bottom Wobbler \u2014 Centering Ring Inspection',
          nominal:    CENTERING_RING_NOMINAL
        })
      },
      {
        id:     'bottom-slipper',
        label:  'Slipper',
        module: createSlipperModule({
          storageKey: 'bottom_slipper', groupKey: 'steckel_bottom',
          title:      'Bottom Wobbler \u2014 Slipper / Wear Liner Inspection',
          nominal:    SLIPPER_NOMINAL
        })
      },
      {
        id:     'bottom-sliding-shoe',
        label:  'Sliding Shoe',
        module: createSlidingShoeModule({
          storageKey: 'bottom_sliding_shoe', groupKey: 'steckel_bottom',
          title:      'Bottom Wobbler \u2014 Sliding Shoe Inspection'
        })
      }
    ]
  },
  {
    label: 'Top Wobbler',
    key: 'steckel_top',
    tabs: [
      {
        id:     'top-face-ring',
        label:  'Face Ring',
        module: createFaceRingModule({
          storageKey: 'top_face_ring', groupKey: 'steckel_top',
          title:      'Top Wobbler \u2014 Face Ring Inspection',
          nominal:    NEW_RING
        })
      },
      {
        id:     'top-centering-ring',
        label:  'Centering Ring',
        module: createCenteringRingModule({
          storageKey: 'top_centering_ring', groupKey: 'steckel_top',
          title:      'Top Wobbler \u2014 Centering Ring Inspection',
          nominal:    CENTERING_RING_NOMINAL
        })
      },
      {
        id:     'top-slipper',
        label:  'Slipper',
        module: createSlipperModule({
          storageKey: 'top_slipper', groupKey: 'steckel_top',
          title:      'Top Wobbler \u2014 Slipper / Wear Liner Inspection',
          nominal:    SLIPPER_NOMINAL
        })
      },
      {
        id:     'top-sliding-shoe',
        label:  'Sliding Shoe',
        module: createSlidingShoeModule({
          storageKey: 'top_sliding_shoe', groupKey: 'steckel_top',
          title:      'Top Wobbler \u2014 Sliding Shoe Inspection'
        })
      }
    ]
  }
];

// Flat lookup: id -> tab
var TAB_MAP = {};
NAV_GROUPS.forEach(function(group) {
  group.tabs.forEach(function(tab) {
    TAB_MAP[tab.id] = tab;
  });
});

function activateTab(id) {
  var tab = TAB_MAP[id];
  if (!tab) return;

  document.querySelectorAll('.sub-tab-btn').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.tabId === id);
  });

  var container = document.getElementById('module-container');
  container.innerHTML = '';
  var wrapper = document.createElement('div');
  wrapper.className = 'module-wrapper';
  container.appendChild(wrapper);
  tab.module.init(wrapper);
}

document.addEventListener('DOMContentLoaded', function() {
  var nav = document.getElementById('module-nav');
  var firstTabId = null;

  NAV_GROUPS.forEach(function(group) {
    var groupLabel = document.createElement('div');
    groupLabel.className = 'nav-group-label';

    var textNode = document.createTextNode(getNavGroupLabel(group.key) + ' ');
    var lockBtn  = document.createElement('button');
    lockBtn.className = 'mill-lock-btn';
    lockBtn.title = 'Change mill number';
    lockBtn.textContent = '⚿';
    lockBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      openMillModal(group.key, textNode);
    });
    groupLabel.appendChild(textNode);
    groupLabel.appendChild(lockBtn);
    nav.appendChild(groupLabel);

    group.tabs.forEach(function(tab) {
      var btn = document.createElement('button');
      btn.className = 'sub-tab-btn';
      btn.dataset.tabId = tab.id;
      btn.textContent = tab.label;
      btn.addEventListener('click', function() { activateTab(tab.id); });
      nav.appendChild(btn);
      if (!firstTabId) firstTabId = tab.id;
    });
  });

  if (firstTabId) activateTab(firstTabId);
});
// PLACEHOLDER
