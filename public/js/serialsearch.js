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

function getById(id) {
    return document.getElementById(id);
}

// https://glpi-developer-documentation.readthedocs.io/en/master/plugins/index.html

(function () {
    'use strict';

    // -DEBUG
    (function() {
        const wrapper_el = getById('ss-wrapper');
        if (wrapper_el) {
            wrapper_el.remove();
        }
    })();
    // -DEBUG

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
    const item_list = [];
    let rand = null;
    let baseParams;

    function findItemsContainer() {
        // // GLPI 10 — the items row lives in a specific div
        // const byId = document.getElementById('item_ticket_0');
        // if (byId) return byId;

        // // GLPI 11 — may use a different wrapper
        // const byClass = document.querySelector('.item_ticket');
        // if (byClass) return byClass;

        // TODO: clean this!
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
        // container.style.display = 'none';

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
                <div id="ss-item-list"></div>
            </div>
        `;
            // <a id="ss-create" href="#" target="_blank">+ Create new asset</a>

        container.querySelectorAll('input[type="hidden"]').forEach((el) => {
            const val = parseInt(el.value);
            if (val === 0) return
            const match = String(el.name).match(/[^\[]+\[([^\]]+)\]\[.+/);
            const item = {
                id: val,
                itemtype: match[1],
            }
            item_list.push(item);
        });

        baseParams = {
            id:                    parseInt(getById('input[name="id"]')) || -1,
            _users_id_requester:   getById('input[name="_users_id_requester[]"]')
                                 || getById('select[name="_users_id_requester[]"]')
                                 || '',
            _canupdate:            getById('input[name="_canupdate"]') || '1',
            entities_id:           parseInt(getById('input[name="entities_id"]')
                                 || getById('select[name="entities_id"]')) || 0,
        }

        container.parentNode.insertBefore(wrapper, container);
        container.remove();
        searchIds();
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
            debounce = setTimeout(() => searchSerial(val), 300);
        });

        input.addEventListener('keydown', e => {
            if (e.key === 'Escape') resetSearchSerial();
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                focusResult(0);
            }
        });

        clear.addEventListener('click', resetSearchSerial);

        document.addEventListener('click', e => {
            if (!getById('ss-wrapper')?.contains(e.target)) hideDropdown();
        });
    }

    // ── Search ───────────────────────────────────────────────────────────────

    async function searchIds() {
        for (var i = item_list.length - 1; i >= 0; i--) {
            try {
                const id = item_list[i].id;
                const itemtype = item_list[i].itemtype;
                const res  = await fetch(
                    `${AJAX_URL}?id=${id}&itemtype=${encodeURIComponent(itemtype)}`,
                    { credentials: 'same-origin' }
                );
                if (!res.ok) throw new Error('HTTP ' + res.status);
                const data = await res.json();
                item_list[i] = {
                    ...data[0]
                }
                item_list[i].need_ajax_to_remove = true;
                showSelected(item_list[i]);
            } catch (err) {
                console.error('[SerialSearchIds]', err);
                // showNoResult(id);
            }
        }
    }

    async function searchSerial(serial) {
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
            if (findItemInList(item) >= 0) {
                return;
            }

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
                if (e.key === 'Escape')    { resetSearchSerial(); }
            });

            dropdown.appendChild(row);
        });

        dropdown.style.display = 'block';
    }

    function findItemInList(item) {
        let index = item_list.length - 1;
        while (index >= 0) {
            const curr_item = item_list[index];
            if (curr_item.id === item.id
                && (!(item.itemtype) || curr_item.itemtype === item.itemtype)) {
                break;
            }
            index--
        }
        return index;
    }

    function buildParams(itemsId, itemtype) {
        const params = {
            ...baseParams
        }
        params.items_id = itemsId ? [itemsId] : [];
        params.itemtype = itemtype;
        return params;
    }

    // ── Select an item ───────────────────────────────────────────────────────

    function select(item) {
        hideDropdown();
        getById('ss-input').value = item.serial;
        toggleClear(true);

        item_list.push(item);
        showSelected(item);
        getById('items').parentNode.querySelector('.item-counter.badge').innerHTML = String(item_list.length);

        // const empty_element = getById('ss-empty-element-tag');
        // if (empty_element) {
        //     empty_element.remove();
        // }
    }

    function remove(item) {
        if (item.need_ajax_to_remove === true) {
            $.ajax({
                method: 'POST',
                url: `${CFG_GLPI.root_doc}/ajax/item_ticket.php`,
                dataType: 'json',
                data: {
                    'action': 'delete',
                    'rand': rand,
                    'params': buildParams(item.id, item.itemtype),
                    'my_items': '0',
                    'itemtype': itemtype,
                    'items_id': items_id,
                }
            });
        }
        const item_found = findItemInList(item);
        if (item_found >= 0) {
            if (!confirm("Êtes-vous sûr de vouloir supprimer l'élément ?")) {
                return;
            }
            item_list.splice(item_found, 1);
        }
        getById(`ss-inventory-${item.itemtype}-${item.id}-${item.serial}`).removeElem();
        getById('items').parentNode.querySelector('.item-counter.badge').innerHTML = String(item_list.length);

        // if (item_list.length === 0) {
        //     const empty_input = document.createElement('input');
        //     empty_input.id = 'ss-empty-element-tag';
        //     empty_input.type = 'hidden';
        //     empty_input.name = 'items_id[][]';
        //     empty_input.value = '0';
        //     const item_list_container = getById('ss-item-list');
        //     item_list_container.appendChild(empty_input);
        // }
    }

    function showSelected(item) {
        const container = getById('ss-item-list');

        const el = document.createElement('span');
        el.id = `ss-inventory-${item.itemtype}-${item.id}-${item.serial}`
        el.style.display = 'flex';
        el.innerHTML = `
            <span class="ss-sel-icon">${esc(item.icon)}</span>
            <span class="ss-sel-name">${esc(item.name)}</span>
            <code class="ss-sel-serial">${esc(item.serial)}</code>
            <input type="hidden" name="items_id[${item.itemtype}][${item.id}]" value="${item.id}">
        `;
        const button = document.createElement('button')
        button.className = 'ss-clear'
        button.title = 'Remove'
        button.innerHTML = 'X'
        button.addEventListener('click', (e) => {e.preventDefault();remove(item)})

        el.appendChild(button);
        container.appendChild(el);
    }

    function showNoResult(serial) {
        const el = getById('ss-noresult');
        el.style.display = 'flex';
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    function hideDropdown() {
        const d = getById('ss-dropdown');
        if (d) d.style.display = 'none';
        const n = getById('ss-noresult');
        if (n) n.style.display = 'none';
    }

    function resetSearchSerial() {
        getById('ss-input').value = '';
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
