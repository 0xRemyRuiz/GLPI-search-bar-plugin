/**
 * Serial Search Plugin — serialsearch.js
 * Injects a serial number quick-search bar into GLPI ticket forms.
 */

(function () {
  'use strict';

  const PLUGIN_ROOT = (() => {
    // Derive the plugin web root from this script's own src attribute
    const scripts = document.querySelectorAll('script[src*="serialsearch"]');
    for (const s of scripts) {
      const m = s.src.match(/(.*\/plugins\/serialsearch)/);
      if (m) return m[1];
    }
    return '/glpi/plugins/serialsearch';
  })();

  const AJAX_URL = PLUGIN_ROOT + '/ajax/search.php';

  let debounceTimer = null;
  let injected = false;

  // ─── DOM Injection ───────────────────────────────────────────────────────────

  function findItemTypeSelect() {
    // GLPI uses a two-step picker: first pick the item type, then the item
    return (
      document.querySelector('select[name="itemtype"]') ||
      document.querySelector('select[name="items_id_1"]') ||
      null
    );
  }

  function findItemIdSelect() {
    return (
      document.querySelector('select[name="items_id"]') ||
      document.querySelector('select[name="items_id_1"]') ||
      null
    );
  }

  function findInsertionPoint() {
    // Look for the asset/item section of a ticket form
    const candidates = [
      document.querySelector('.item_ticket'),
      document.querySelector('[data-field="items_id"]'),
      findItemIdSelect()?.closest('tr') || findItemIdSelect()?.closest('.form-group'),
    ];
    return candidates.find(Boolean) || null;
  }

  function injectSearchBar() {
    if (injected) return;
    const anchor = findInsertionPoint();
    if (!anchor) return;

    injected = true;

    const container = document.createElement('div');
    container.id = 'ss-container';
    container.innerHTML = `
      <div id="ss-bar">
        <div id="ss-input-wrap">
          <span id="ss-icon">⌕</span>
          <input
            id="ss-input"
            type="text"
            autocomplete="off"
            placeholder="Quick search by serial number…"
            aria-label="Search by serial number"
          />
          <select id="ss-type-filter" title="Asset type filter">
            <option value="all">All types</option>
            <option value="computers">💻 Computers</option>
            <option value="phones">📱 Phones</option>
            <option value="printers">🖨️ Printers</option>
            <option value="monitors">🖥️ Monitors</option>
          </select>
          <span id="ss-spinner" class="ss-hidden">⟳</span>
          <button id="ss-clear" class="ss-hidden" title="Clear">✕</button>
        </div>
        <div id="ss-dropdown" class="ss-hidden" role="listbox"></div>
        <div id="ss-no-result" class="ss-hidden">
          <span>No machine found for this serial.</span>
          <a id="ss-create-link" href="#" target="_blank">+ Create new asset</a>
        </div>
      </div>
    `;

    anchor.parentNode.insertBefore(container, anchor);
    bindEvents();
  }

  // ─── Events ──────────────────────────────────────────────────────────────────

  function bindEvents() {
    const input    = document.getElementById('ss-input');
    const filter   = document.getElementById('ss-type-filter');
    const clearBtn = document.getElementById('ss-clear');

    input.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      const val = input.value.trim();
      toggleClear(val.length > 0);
      if (val.length < 2) { hideDropdown(); return; }
      debounceTimer = setTimeout(() => doSearch(val), 280);
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { clearSearch(); }
      if (e.key === 'ArrowDown') { focusResult(0); e.preventDefault(); }
    });

    filter.addEventListener('change', () => {
      const val = input.value.trim();
      if (val.length >= 2) doSearch(val);
    });

    clearBtn.addEventListener('click', clearSearch);

    // Close dropdown on outside click
    document.addEventListener('click', (e) => {
      if (!document.getElementById('ss-container')?.contains(e.target)) {
        hideDropdown();
      }
    });
  }

  // ─── Search ──────────────────────────────────────────────────────────────────

  async function doSearch(serial) {
    const type    = document.getElementById('ss-type-filter').value;
    const spinner = document.getElementById('ss-spinner');
    spinner.classList.remove('ss-hidden');

    try {
      const url = `${AJAX_URL}?serial=${encodeURIComponent(serial)}&type=${encodeURIComponent(type)}`;
      const res = await fetch(url, { credentials: 'same-origin' });
      if (!res.ok) throw new Error('Network error');
      const data = await res.json();
      renderResults(data, serial);
    } catch (err) {
      console.error('[SerialSearch]', err);
      showNoResult(serial);
    } finally {
      spinner.classList.add('ss-hidden');
    }
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  function renderResults(items, serial) {
    const dropdown = document.getElementById('ss-dropdown');
    const noResult = document.getElementById('ss-no-result');

    dropdown.innerHTML = '';

    if (!items || items.length === 0) {
      hideDropdown();
      showNoResult(serial);
      return;
    }

    noResult.classList.add('ss-hidden');

    items.forEach((item, idx) => {
      const li = document.createElement('div');
      li.className = 'ss-result';
      li.setAttribute('role', 'option');
      li.setAttribute('tabindex', '0');
      li.dataset.idx = idx;

      const serialHighlighted = highlightMatch(item.serial, serial);
      const meta = [item.location, item.user].filter(Boolean).join(' · ');

      li.innerHTML = `
        <span class="ss-result-icon">${item.icon}</span>
        <span class="ss-result-body">
          <span class="ss-result-name">${escapeHtml(item.name)}</span>
          <span class="ss-result-serial">${serialHighlighted}</span>
          ${item.otherserial ? `<span class="ss-result-other">Inv: ${escapeHtml(item.otherserial)}</span>` : ''}
          ${meta ? `<span class="ss-result-meta">${escapeHtml(meta)}</span>` : ''}
        </span>
        <span class="ss-result-type">${item.typeLabel}</span>
        <a class="ss-result-edit" href="${item.editUrl}" target="_blank" title="Open asset" tabindex="-1">↗</a>
      `;

      li.addEventListener('click', (e) => {
        if (e.target.classList.contains('ss-result-edit')) return; // let link open
        selectItem(item);
      });

      li.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') selectItem(item);
        if (e.key === 'ArrowDown') { focusResult(idx + 1); e.preventDefault(); }
        if (e.key === 'ArrowUp')   { focusResult(idx - 1); e.preventDefault(); }
        if (e.key === 'Escape')    { clearSearch(); }
      });

      dropdown.appendChild(li);
    });

    dropdown.classList.remove('ss-hidden');
  }

  function selectItem(item) {
    // Try to set GLPI's native item picker
    const itemIdSelect = findItemIdSelect();
    if (itemIdSelect) {
      // If the option exists, select it
      const option = itemIdSelect.querySelector(`option[value="${item.id}"]`);
      if (option) {
        itemIdSelect.value = item.id;
        itemIdSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }

    // Also try the Select2 / ajax picker GLPI uses in v10
    // GLPI v10 uses a specific data attribute approach
    triggerGLPIItemPicker(item);

    // Visual feedback in our own input
    document.getElementById('ss-input').value = item.serial;
    toggleClear(true);
    hideDropdown();

    // Show a confirmation badge
    showSelectedBadge(item);
  }

  function triggerGLPIItemPicker(item) {
    // GLPI v10 uses select2 for the item picker in some views
    // Try to find it and set value programmatically
    try {
      const $ = window.jQuery || window.$;
      if ($ && $.fn.select2) {
        const sel = $('select[name="items_id"]');
        if (sel.length) {
          // Append option if not present
          if (!sel.find(`option[value="${item.id}"]`).length) {
            sel.append(new Option(item.name + ' (' + item.serial + ')', item.id, true, true));
          }
          sel.val(item.id).trigger('change');
        }
      }
    } catch (e) {
      // Select2 not available, native select fallback already handled
    }
  }

  function showSelectedBadge(item) {
    let badge = document.getElementById('ss-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'ss-badge';
      document.getElementById('ss-bar').appendChild(badge);
    }
    badge.innerHTML = `
      <span class="ss-badge-icon">${item.icon}</span>
      <span class="ss-badge-name">${escapeHtml(item.name)}</span>
      <span class="ss-badge-serial">${escapeHtml(item.serial)}</span>
      <a href="${item.editUrl}" target="_blank" class="ss-badge-link">View asset ↗</a>
    `;
    badge.classList.remove('ss-hidden');
  }

  function showNoResult(serial) {
    const noResult  = document.getElementById('ss-no-result');
    const createLink = document.getElementById('ss-create-link');
    // Link to create new computer pre-filled with serial
    createLink.href = `/glpi/front/computer.form.php?serial=${encodeURIComponent(serial)}`;
    noResult.classList.remove('ss-hidden');
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  function hideDropdown() {
    document.getElementById('ss-dropdown')?.classList.add('ss-hidden');
    document.getElementById('ss-no-result')?.classList.add('ss-hidden');
  }

  function clearSearch() {
    const input = document.getElementById('ss-input');
    if (input) input.value = '';
    toggleClear(false);
    hideDropdown();
    document.getElementById('ss-badge')?.classList.add('ss-hidden');
  }

  function toggleClear(show) {
    const btn = document.getElementById('ss-clear');
    if (btn) btn.classList.toggle('ss-hidden', !show);
  }

  function focusResult(idx) {
    const results = document.querySelectorAll('.ss-result');
    if (!results.length) return;
    const target = results[Math.max(0, Math.min(idx, results.length - 1))];
    target?.focus();
  }

  function highlightMatch(text, query) {
    if (!text) return '';
    const escaped = escapeHtml(text);
    const re = new RegExp(`(${escapeRegex(query)})`, 'gi');
    return escaped.replace(re, '<mark>$1</mark>');
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // ─── MutationObserver — wait for GLPI to render the form ─────────────────────

  const observer = new MutationObserver(() => {
    if (!injected && findInsertionPoint()) {
      injectSearchBar();
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // Also try immediately on DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      if (!injected && findInsertionPoint()) injectSearchBar();
    });
  } else {
    if (!injected && findInsertionPoint()) injectSearchBar();
  }

})();
