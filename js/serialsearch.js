(function () {
  'use strict';

  // ── Change this if your GLPI is at a different path ──
  const PLUGIN_ROOT = '/glpi/plugins/serialsearch';
  const AJAX_URL    = PLUGIN_ROOT + '/ajax/search.php';

  let injected = false;
  let debounceTimer = null;

  // Broaden the net — try every known GLPI asset picker selector
  function findInsertionPoint() {
    const selectors = [
      '.item_ticket',
      '[data-field="items_id"]',
      'select[name="items_id"]',
      'select[name="itemtype"]',
      '#item_ticket_0',
      '.tab_cadre_fixe .item_link',
      'td.left select',
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        console.log('[SerialSearch] Found anchor via selector:', sel, el);
        return el.closest('tr') || el.closest('div') || el.parentNode;
      }
    }

    console.warn('[SerialSearch] No anchor found. Current selectors tried:', selectors);
    console.log('[SerialSearch] All selects on page:',
      [...document.querySelectorAll('select')].map(s => s.name || s.id || s.className)
    );
    return null;
  }

  function injectSearchBar() {
    if (injected) return;
    const anchor = findInsertionPoint();
    if (!anchor) return;

    injected = true;
    console.log('[SerialSearch] Injecting search bar into', anchor);

    const container = document.createElement('div');
    container.id = 'ss-container';
    container.innerHTML = `
      <div id="ss-bar">
        <div id="ss-input-wrap">
          <span id="ss-icon">⌕</span>
          <input id="ss-input" type="text" autocomplete="off"
                 placeholder="Search by serial number…" />
          <select id="ss-type-filter">
            <option value="all">All types</option>
            <option value="computers">💻 Computers</option>
            <option value="phones">📱 Phones</option>
            <option value="printers">🖨️ Printers</option>
            <option value="monitors">🖥️ Monitors</option>
          </select>
          <span id="ss-spinner" class="ss-hidden">⟳</span>
          <button id="ss-clear" class="ss-hidden" type="button">✕</button>
        </div>
        <div id="ss-dropdown" class="ss-hidden"></div>
        <div id="ss-no-result" class="ss-hidden">
          <span>No machine found.</span>
          <a id="ss-create-link" href="#" target="_blank">+ Create new asset</a>
        </div>
      </div>
    `;

    // Insert BEFORE the anchor
    anchor.parentNode.insertBefore(container, anchor);
    bindEvents();
  }

  function bindEvents() {
    const input  = document.getElementById('ss-input');
    const filter = document.getElementById('ss-type-filter');
    const clear  = document.getElementById('ss-clear');

    input.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      const val = input.value.trim();
      clear.classList.toggle('ss-hidden', val.length === 0);
      if (val.length < 2) { hideDropdown(); return; }
      debounceTimer = setTimeout(() => doSearch(val), 280);
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') clearSearch();
      if (e.key === 'ArrowDown') {
        const first = document.querySelector('.ss-result');
        first?.focus();
        e.preventDefault();
      }
    });

    filter.addEventListener('change', () => {
      const val = input.value.trim();
      if (val.length >= 2) doSearch(val);
    });

    clear.addEventListener('click', clearSearch);

    document.addEventListener('click', (e) => {
      if (!document.getElementById('ss-container')?.contains(e.target)) {
        hideDropdown();
      }
    });
  }

  async function doSearch(serial) {
    const type    = document.getElementById('ss-type-filter').value;
    const spinner = document.getElementById('ss-spinner');
    spinner.classList.remove('ss-hidden');
    hideDropdown();

    try {
      const res  = await fetch(`${AJAX_URL}?serial=${encodeURIComponent(serial)}&type=${encodeURIComponent(type)}`, {
        credentials: 'same-origin'
      });
      const data = await res.json();
      console.log('[SerialSearch] Results:', data);
      renderResults(data, serial);
    } catch (err) {
      console.error('[SerialSearch] Fetch error:', err);
      showNoResult(serial);
    } finally {
      spinner.classList.add('ss-hidden');
    }
  }

  function renderResults(items, serial) {
    const dropdown = document.getElementById('ss-dropdown');
    const noResult = document.getElementById('ss-no-result');

    dropdown.innerHTML = '';

    if (!items || items.length === 0) {
      noResult.classList.remove('ss-hidden');
      document.getElementById('ss-create-link').href =
        `/glpi/front/computer.form.php?serial=${encodeURIComponent(serial)}`;
      return;
    }

    noResult.classList.add('ss-hidden');

    items.forEach((item, idx) => {
      const div = document.createElement('div');
      div.className = 'ss-result';
      div.tabIndex = 0;

      const meta = [item.location, item.user].filter(Boolean).join(' · ');
      div.innerHTML = `
        <span class="ss-result-icon">${item.icon}</span>
        <span class="ss-result-body">
          <span class="ss-result-name">${esc(item.name)}</span>
          <span class="ss-result-serial">${highlight(item.serial, serial)}</span>
          ${meta ? `<span class="ss-result-meta">${esc(meta)}</span>` : ''}
        </span>
        <span class="ss-result-type">${item.typeLabel}</span>
        <a class="ss-result-edit" href="${item.editUrl}" target="_blank">↗</a>
      `;

      div.addEventListener('click', (e) => {
        if (e.target.classList.contains('ss-result-edit')) return;
        selectItem(item);
      });

      div.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') selectItem(item);
        if (e.key === 'ArrowDown') { focusResult(idx + 1); e.preventDefault(); }
        if (e.key === 'ArrowUp')   { focusResult(idx - 1); e.preventDefault(); }
      });

      dropdown.appendChild(div);
    });

    dropdown.classList.remove('ss-hidden');
  }

  function selectItem(item) {
    console.log('[SerialSearch] Selected item:', item);

    // Try native select
    const sel = document.querySelector('select[name="items_id"]');
    if (sel) {
      let opt = sel.querySelector(`option[value="${item.id}"]`);
      if (!opt) {
        opt = new Option(`${item.name} (${item.serial})`, item.id, true, true);
        sel.appendChild(opt);
      }
      sel.value = item.id;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // Try Select2
    try {
      const $ = window.jQuery;
      if ($ && $.fn.select2) {
        const $sel = $('select[name="items_id"]');
        if ($sel.length) {
          if (!$sel.find(`option[value="${item.id}"]`).length) {
            $sel.append(new Option(`${item.name} (${item.serial})`, item.id, true, true));
          }
          $sel.val(item.id).trigger('change');
          console.log('[SerialSearch] Set via Select2');
        }
      }
    } catch (e) { /* no jQuery */ }

    document.getElementById('ss-input').value = item.serial;
    document.getElementById('ss-clear').classList.remove('ss-hidden');
    hideDropdown();
    showBadge(item);
  }

  function showBadge(item) {
    let badge = document.getElementById('ss-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'ss-badge';
      document.getElementById('ss-bar').appendChild(badge);
    }
    badge.innerHTML = `
      ${item.icon}
      <strong>${esc(item.name)}</strong>
      <code>${esc(item.serial)}</code>
      <a href="${item.editUrl}" target="_blank">View ↗</a>
    `;
    badge.classList.remove('ss-hidden');
  }

  function showNoResult(serial) {
    const el = document.getElementById('ss-no-result');
    document.getElementById('ss-create-link').href =
      `/glpi/front/computer.form.php?serial=${encodeURIComponent(serial)}`;
    el.classList.remove('ss-hidden');
  }

  function hideDropdown() {
    document.getElementById('ss-dropdown')?.classList.add('ss-hidden');
    document.getElementById('ss-no-result')?.classList.add('ss-hidden');
  }

  function clearSearch() {
    document.getElementById('ss-input').value = '';
    document.getElementById('ss-clear').classList.add('ss-hidden');
    document.getElementById('ss-badge')?.classList.add('ss-hidden');
    hideDropdown();
  }

  function focusResult(idx) {
    const results = [...document.querySelectorAll('.ss-result')];
    results[Math.max(0, Math.min(idx, results.length - 1))]?.focus();
  }

  function highlight(text, query) {
    const e = esc(text);
    const re = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return e.replace(re, '<mark>$1</mark>');
  }

  function esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Watch for GLPI's AJAX-rendered form elements ──
  const observer = new MutationObserver(() => {
    if (!injected && findInsertionPoint()) injectSearchBar();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  if (document.readyState !== 'loading') {
    if (!injected && findInsertionPoint()) injectSearchBar();
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      if (!injected && findInsertionPoint()) injectSearchBar();
    });
  }

})();