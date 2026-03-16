/**
 * Serial Search — serialsearch.js
 *
 * Strategy:
 *  1. Find the Items section of the ticket form (rendered via AJAX by GLPI).
 *  2. Hide the native itemtype + items_id selects and their labels.
 *  3. Inject our own search bar in their place.
 *  4. On result selection, drive GLPI's native Select2 pickers so the ticket
 *     is saved with the correct item attached.
 */
console.log('[SS] plugin file loaded');
(function () {
    'use strict';

    const GLPI_ROOT = (typeof CFG_GLPI !== 'undefined' && CFG_GLPI.root_doc !== undefined) ? CFG_GLPI.root_doc : '';
    const AJAX_URL = GLPI_ROOT + '/plugins/serialsearch/ajax/search.php';
    // // Derive AJAX URL from this script's own src
    // const AJAX_URL = (function () {
    //     const s = document.querySelector('script[src*="serialsearch"]');
    //     if (s) {
    //         return s.src.replace(/\/public\/js\/serialsearch\.js.*$/, '/ajax/search.php');
    //     }
    //     // Fallback — adjust if GLPI is installed at a different path
    //     return '/plugins/serialsearch/ajax/search.php';
    // })();

    let injected = false;
    let debounce  = null;

    // ── Selectors for GLPI's native item picker ─────────────────────────────
    // GLPI 10/11 ticket form has:
    //   select[name="itemtype"]  — asset type (Computer, Phone, …)
    //   select[name="items_id"]  — asset instance (driven by Select2 + AJAX)
    // Both live inside a <div id="item_ticket_0"> or similar.
    // We hide the whole container and insert our bar just above it.

    function findItemsContainer() {
        // GLPI 10 — the items row lives in a specific div
        const byId = document.getElementById('item_ticket_0');
        if (byId) return byId;

        // GLPI 11 — may use a different wrapper
        const byClass = document.querySelector('.item_ticket');
        if (byClass) return byClass;

        // Fallback: find the itemtype select and return its closest block element
        const sel = document.querySelector('select[name="itemtype"]');
        if (sel) return sel.closest('tr') || sel.closest('div') || sel.parentNode;

        return null;
    }

    function injectSearchBar() {
        if (injected) return;

        const container = findItemsContainer();
        if (!container) return;

        injected = true;

        // Hide the native picker — we'll drive it programmatically on selection
        container.style.display = 'none';

        // Build our search bar and insert it just before the hidden native block
        const wrapper = document.createElement('div');
        wrapper.id = 'ss-wrapper';
        wrapper.innerHTML = `
            <div id="ss-bar">
                <div id="ss-row">
                    <span id="ss-magnifier">⌕</span>
                    <input
                        id="ss-input"
                        type="text"
                        autocomplete="off"
                        spellcheck="false"
                        placeholder="Type a serial number to find a machine…"
                    />
                    <button id="ss-clear" type="button" title="Clear selection">✕</button>
                    <span id="ss-spinner"></span>
                </div>
                <div id="ss-dropdown"></div>
                <div id="ss-noresult">
                    No machine found for this serial.
                    <a id="ss-create" href="#" target="_blank">+ Create new asset</a>
                </div>
                <div id="ss-selected"></div>
            </div>
        `;

        container.parentNode.insertBefore(wrapper, container);
        bindEvents();
    }

    // ── Events ───────────────────────────────────────────────────────────────

    function bindEvents() {
        const input = get('ss-input');
        const clear = get('ss-clear');

        input.addEventListener('input', () => {
            const val = input.value.trim();
            toggleClear(val.length > 0);
            hideDropdown();
            clearTimeout(debounce);
            if (val.length < 2) return;
            debounce = setTimeout(() => search(val), 300);
        });

        input.addEventListener('keydown', e => {
            if (e.key === 'Escape') resetSearch();
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                focusResult(0);
            }
        });

        clear.addEventListener('click', resetSearch);

        document.addEventListener('click', e => {
            if (!get('ss-wrapper')?.contains(e.target)) hideDropdown();
        });
    }

    // ── Search ───────────────────────────────────────────────────────────────

    async function search(serial) {
        showSpinner(true);
        try {
            const res  = await fetch(
                `${AJAX_URL}?serial=${encodeURIComponent(serial)}`,
                { credentials: 'same-origin' }
            );
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const data = await res.json();
            render(data, serial);
        } catch (err) {
            console.error('[SerialSearch]', err);
            showNoResult(serial);
        } finally {
            showSpinner(false);
        }
    }

    // ── Render results ───────────────────────────────────────────────────────

    function render(items, serial) {
        const dropdown = get('ss-dropdown');
        get('ss-noresult').style.display = 'none';
        dropdown.innerHTML = '';

        if (!items || items.length === 0) {
            showNoResult(serial);
            return;
        }

        items.forEach((item, idx) => {
            const row = document.createElement('div');
            row.className = 'ss-result';
            row.tabIndex  = 0;

            const meta = [item.location, item.user].filter(Boolean).join(' · ');

            row.innerHTML = `
                <span class="ss-r-icon">${esc(item.icon)}</span>
                <span class="ss-r-body">
                    <span class="ss-r-name">${esc(item.name)}</span>
                    <span class="ss-r-serial">${highlight(item.serial, serial)}</span>
                    ${item.otherserial
                        ? `<span class="ss-r-inv">Inv: ${esc(item.otherserial)}</span>`
                        : ''}
                    ${meta ? `<span class="ss-r-meta">${esc(meta)}</span>` : ''}
                </span>
                <span class="ss-r-type">${esc(item.label)}</span>
            `;

            row.addEventListener('click',   () => select(item));
            row.addEventListener('keydown', e => {
                if (e.key === 'Enter')     { select(item); }
                if (e.key === 'ArrowDown') { e.preventDefault(); focusResult(idx + 1); }
                if (e.key === 'ArrowUp')   { e.preventDefault(); focusResult(idx - 1); }
                if (e.key === 'Escape')    { resetSearch(); }
            });

            dropdown.appendChild(row);
        });

        dropdown.style.display = 'block';
    }

    // ── Select an item ───────────────────────────────────────────────────────

    function select(item) {
        hideDropdown();
        get('ss-input').value = item.serial;
        toggleClear(true);

        // Drive GLPI's native pickers so the ticket saves the link correctly
        setNativePickers(item);

        // Show confirmation badge
        showSelected(item);
    }

    function setNativePickers(item) {
        const container = findItemsContainer();
        if (!container) return;

        const $ = window.jQuery;

        // Step 1 — set itemtype select (e.g. "Computer")
        const typeSelect = container.querySelector('select[name="itemtype"]');
        if (typeSelect) {
            typeSelect.value = item.itemtype;
            // If Select2 is present, sync it
            if ($ && $(typeSelect).data('select2')) {
                $(typeSelect).val(item.itemtype).trigger('change');
            } else {
                typeSelect.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }

        // Step 2 — wait a tick for GLPI to re-populate items_id, then set it
        setTimeout(() => {
            const itemSelect = container.querySelector('select[name="items_id"]');
            if (!itemSelect) return;

            if ($ && $(itemSelect).data('select2')) {
                // Inject the option into Select2 and trigger selection
                const opt = new Option(
                    `${item.name} (${item.serial})`,
                    item.id,
                    true,
                    true
                );
                $(itemSelect).append(opt).trigger('change');
            } else {
                // Plain select fallback
                let opt = itemSelect.querySelector(`option[value="${item.id}"]`);
                if (!opt) {
                    opt = new Option(`${item.name} (${item.serial})`, item.id, true, true);
                    itemSelect.appendChild(opt);
                }
                itemSelect.value = item.id;
                itemSelect.dispatchEvent(new Event('change', { bubbles: true }));
            }

            // Step 3 — click GLPI's "Add" button to actually link the item to the ticket
            const addBtn = container.querySelector('input[type="submit"], button[name="add_item"]')
                        || container.querySelector('.btn[name="add_item"]');
            if (addBtn) addBtn.click();

        }, 300);
    }

    function showSelected(item) {
        const el = get('ss-selected');
        el.innerHTML = `
            <span class="ss-sel-icon">${esc(item.icon)}</span>
            <span class="ss-sel-name">${esc(item.name)}</span>
            <code class="ss-sel-serial">${esc(item.serial)}</code>
            <span class="ss-sel-type">${esc(item.label)}</span>
        `;
        el.style.display = 'flex';
    }

    function showNoResult(serial) {
        const el = get('ss-noresult');
        get('ss-create').href = `/glpi/front/computer.form.php?serial=${encodeURIComponent(serial)}`;
        el.style.display = 'flex';
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    function hideDropdown() {
        const d = get('ss-dropdown');
        if (d) d.style.display = 'none';
        const n = get('ss-noresult');
        if (n) n.style.display = 'none';
    }

    function resetSearch() {
        get('ss-input').value    = '';
        get('ss-selected').style.display = 'none';
        toggleClear(false);
        hideDropdown();
    }

    function toggleClear(show) {
        const btn = get('ss-clear');
        if (btn) btn.style.display = show ? 'flex' : 'none';
    }

    function showSpinner(on) {
        const s = get('ss-spinner');
        if (s) s.style.display = on ? 'inline-block' : 'none';
    }

    function focusResult(idx) {
        const rows = [...document.querySelectorAll('.ss-result')];
        if (!rows.length) return;
        rows[Math.max(0, Math.min(idx, rows.length - 1))]?.focus();
    }

    function highlight(text, query) {
        const safe = esc(text);
        const re   = new RegExp(`(${reEscape(query)})`, 'gi');
        return safe.replace(re, '<mark>$1</mark>');
    }

    function esc(v) {
        return String(v ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function reEscape(s) {
        return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function get(id) {
        return document.getElementById(id);
    }

    // ── Observer — wait for GLPI's AJAX-rendered form ────────────────────────

    const observer = new MutationObserver(() => {
        if (!injected && findItemsContainer()) injectSearchBar();
    });

    observer.observe(document.body, { childList: true, subtree: true });

    if (document.readyState !== 'loading') {
        if (!injected && findItemsContainer()) injectSearchBar();
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            if (!injected && findItemsContainer()) injectSearchBar();
        });
    }

})();
