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

// Source - https://stackoverflow.com/a/18120786
// Posted by Johan Dettmar, modified by community. See post 'Timeline' for change history
// Retrieved 2026-03-18, License - CC BY-SA 4.0
if (Element.prototype.removeElem == undefined) {
    Element.prototype.removeElem = function() {
        this.parentElement.removeChild(this);
    }
}
if (NodeList.prototype.removeElem == undefined) {
    NodeList.prototype.removeElem = HTMLCollection.prototype.remove = function() {
        for(var i = this.length - 1; i >= 0; i--) {
            if(this[i] && this[i].parentElement) {
                this[i].parentElement.removeChild(this[i]);
            }
        }
    }
}

// https://glpi-developer-documentation.readthedocs.io/en/master/plugins/index.html

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
    let rand = null;

    // ── Selectors for GLPI's native item picker ─────────────────────────────
    // GLPI 10/11 ticket form has:
    //   select[name="itemtype"]  — asset type (Computer, Phone, …)
    //   select[name="items_id"]  — asset instance (driven by Select2 + AJAX)
    // Both live inside a <div id="item_ticket_0"> or similar.
    // We hide the whole container and insert our bar just above it.

    function findItemsContainer() {
        // // GLPI 10 — the items row lives in a specific div
        // const byId = document.getElementById('item_ticket_0');
        // if (byId) return byId;

        // // GLPI 11 — may use a different wrapper
        // const byClass = document.querySelector('.item_ticket');
        // if (byClass) return byClass;

        // Fallback: find the itemtype select and return its closest block element
        const sel = document.querySelector('select[name="itemtype"]');
        if (sel) {
            let el = sel.closest('tr') || sel.closest('div') || sel.parentNode;
            el = el.parentNode;
            rand = el.id.match(/[0-9]+$/)[0];
            return el;
        }

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
                        placeholder="Entrez le numéro de série..."
                    />
                    <button id="ss-clear" type="button" title="Clear selection">✕</button>
                    <span id="ss-spinner"></span>
                </div>
                <div id="ss-selector-container">
                    <div id="ss-dropdown"></div>
                    <div id="ss-noresult">
                        Pas de résultat...
                    </div>
                </div>
                <div id="ss-selected"></div>
            </div>
        `;
                        // <a id="ss-create" href="#" target="_blank">+ Create new asset</a>

        container.parentNode.insertBefore(wrapper, container);
        bindEvents();
    }

    // ── Events ───────────────────────────────────────────────────────────────

    function bindEvents() {
        const input = getById('ss-input');
        const clear = getById('ss-clear');

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
            if (!getById('ss-wrapper')?.contains(e.target)) hideDropdown();
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
        const dropdown = getById('ss-dropdown');
        getById('ss-noresult').style.display = 'none';
        dropdown.innerHTML = '';

        if (!items || items.length === 0) {
            showNoResult(serial);
            return;
        }

        items.forEach((item, idx) => {
            // TODO: filter list of each items already added
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
            `;
                // <span class="ss-r-type">${esc(item.label)}</span>
            // i class="ti ti-circle-x pointer"

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

    function buildParams(itemtype, itemsId) {
        const form = document.querySelector('form[name="massaction_form"]')
                   || document.querySelector('form[id^="asset_form"]')
                   || document.querySelector('form');

        const get = (selector) => document.querySelector(selector)?.value ?? '';

        return {
            id:                    parseInt(getById('input[name="id"]')) || -1,
            // _users_id_requester:   getById('input[name="_users_id_requester[]"]')
            //                      || getById('select[name="_users_id_requester[]"]')
            //                      || '',
            // items_id:              itemsId ? [itemsId] : [],
            itemtype:              itemtype,
            _canupdate:            getById('input[name="_canupdate"]') || '1',
            entities_id:           parseInt(getById('input[name="entities_id"]')
                                 || getById('select[name="entities_id"]')) || 0,
        };
    }

    // ── Select an item ───────────────────────────────────────────────────────

    function select(item) {
        hideDropdown();
        getById('ss-input').value = item.serial;
        toggleClear(true);

        // Drive GLPI's native pickers so the ticket saves the link correctly
        // setNativePickers(item);

        // -DEBUG
        // showSelected(item);
        // -DEBUG

        console.log({
                'action': 'add',
                'rand': rand,
                'params': buildParams(item.itemtype, item.id),
                // 'params': {"id":0,"_users_id_requester":2,"items_id":[],"itemtype":"","_canupdate":4,"entities_id":0},
                'my_items': $('#dropdown_my_items' + rand).val() || '',
                'itemtype': item.itemtype,
                'items_id': item.id,
            });

        $.ajax({
            method: 'POST',
            url: `${GLPI_ROOT}/ajax/item_ticket.php`,
            dataType: 'html',
            data: {
                'action': 'add',
                'rand': rand,
                'params': buildParams(item.itemtype, item.id),
                // 'params': {"id":0,"_users_id_requester":2,"items_id":[],"itemtype":"","_canupdate":4,"entities_id":0},
                'my_items': $('#dropdown_my_items' + rand).val() || '',
                'itemtype': item.itemtype,
                'items_id': item.id,
            },
            success: function(response) {
                // Show confirmation badge
                showSelected(item);
            }
        });
    }

    function remove(item) {
        console.log(item);
        return

        $.ajax({
            method: 'POST',
            url: `${GLPI_ROOT}/ajax/item_ticket.php`,
            dataType: 'html',
            data: {
                'action': 'delete',
                'rand': rand,
                // 
                'params': buildParams(item.itemtype, item.id),
                // 'params': {"id":0,"_users_id_requester":2,"items_id":[],"itemtype":"","_canupdate":4,"entities_id":0},
                'my_items': $('#dropdown_my_items' + rand).val() || '',
                'itemtype': item.itemtype,
                'items_id': item.id,
            },
            success: function(response) {
                // Remove element
                getById(`#ss-inventory-${item.itemtype}-${item.id}-${item.serial}`).removeElem();
                // showSelected(item);
            }
        });
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
        const el = getById('ss-selected');
        el.innerHTML = `
            <span class="ss-sel-icon">${esc(item.icon)}</span>
            <span class="ss-sel-name">${esc(item.name)}</span>
            <code class="ss-sel-serial">${esc(item.serial)}</code>
        `;
        // el.innerHTML = `
        //     <span id="ss-inventory-${item.itemtype}-${item.id}-${item.serial}">
        //         <span class="ss-sel-icon">${esc(item.icon)}</span>
        //         <span class="ss-sel-name">${esc(item.name)}</span>
        //         <code class="ss-sel-serial">${esc(item.serial)}</code>
        //         <button class="ss-clear" type="button" title="Remove">x</button>
        //     </span>
        // `;
        // <span class="ss-sel-type">${esc(item.label)}</span>
        el.style.display = 'flex';


        // const container = getById('ss-item-list');

        // const el = document.createElement('span');
        // el.id = `ss-inventory-${item.itemtype}-${item.id}-${item.serial}`
        // el.style.display = 'flex';
        // el.innerHTML = `
        //     <span class="ss-sel-icon">${esc(item.icon)}</span>
        //     <span class="ss-sel-name">${esc(item.name)}</span>
        //     <code class="ss-sel-serial">${esc(item.serial)}</code>
        // `;
        // const button = document.createElement('button')
        // button.class = 'ss-clear'
        // button.type = 'button'
        // button.title = 'Remove'
        // button.innerHTML = `x`
        // button.addEventListener('click', () => remove(item))

        // el.appendChild(button);
        // container.appendChild(el);
    }

    function showNoResult(serial) {
        const el = getById('ss-noresult');
        // TODO: check creation process and maybe use a modal
        // getById('ss-create').href = `/glpi/front/computer.form.php?serial=${encodeURIComponent(serial)}`;
        el.style.display = 'flex';
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    function hideDropdown() {
        const d = getById('ss-dropdown');
        if (d) d.style.display = 'none';
        const n = getById('ss-noresult');
        if (n) n.style.display = 'none';
    }

    function resetSearch() {
        getById('ss-input').value    = '';
        // getById('ss-selected').style.display = 'none';
        toggleClear(false);
        hideDropdown();
    }

    function toggleClear(show) {
        const btn = getById('ss-clear');
        if (btn) btn.style.display = show ? 'flex' : 'none';
    }

    function showSpinner(on) {
        const s = getById('ss-spinner');
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

    function getById(id) {
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
