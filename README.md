# GLPI Search Bar Plugin

A quick serial-number search bar injected directly into GLPI v10 ticket forms.
Type any partial or full serial number to instantly find computers, phones,
printers, and monitors across your inventory.

---

## Features

- 🔍 Real-time autocomplete search across all major asset types
- 💻 📱 🖨️ 🖥️ Covers Computers, Phones, Printers, Monitors
- ⚡ Highlights matching characters in results
- 👤 Shows assigned user and location alongside each result
- ↗ Direct link to open the asset form in a new tab
- ➕ "Create new asset" shortcut when no machine is found
- ✅ Confirms the selected asset with a badge below the search bar
- 🔒 Requires an active GLPI session (no unauthenticated access)

---

## Requirements

- GLPI **10.0.0** or higher
- PHP 7.4+
- A standard GLPI MySQL/MariaDB setup (no extra tables needed)

---

## Installation

1. Copy the `serialsearch/` folder into your GLPI plugins directory:

```
/var/www/html/glpi/plugins/serialsearch/
```

2. Log into GLPI as a super-admin.

3. Go to **Setup → Plugins**.

4. Find **Serial Search** in the list and click **Install**, then **Enable**.

5. Open any ticket creation form — the search bar will appear above the asset picker.

---

## File Structure

```
serialsearch/
├── setup.php          Plugin registration and hooks
├── hook.php           Install / uninstall callbacks
├── ajax/
│   └── search.php     JSON endpoint queried by the search bar
├── js/
│   └── serialsearch.js UI injection and autocomplete logic
└── css/
    └── serialsearch.css Styling
```

---

## Customisation

### Add more asset types

In `ajax/search.php`, extend the `$tables` array with any GLPI asset table:

```php
'networkequipments' => [
    'table'     => 'glpi_networkequipments',
    'typeLabel' => 'Network',
    'icon'      => '🌐',
],
```

### Change the minimum search length

In `serialsearch.js`, change:
```js
if (val.length < 2) { hideDropdown(); return; }
```

### Change debounce delay

In `serialsearch.js`, change:
```js
debounceTimer = setTimeout(() => doSearch(val), 280);
```
(value in milliseconds)

---

## Troubleshooting

**The bar doesn't appear on the ticket form.**
GLPI renders its ticket form partially via AJAX. The plugin uses a
MutationObserver to wait for the right DOM element. If the form structure
changes in a future GLPI update, adjust the selectors in the
`findInsertionPoint()` function in `serialsearch.js`.

**The search returns no results.**
Check that the `serial` column is populated in your `glpi_computers` table.
You can test the endpoint directly:
```
/glpi/plugins/serialsearch/ajax/search.php?serial=ABC&type=all
```

**Selecting a result doesn't update GLPI's native picker.**
GLPI v10 uses Select2 for the item picker. The plugin attempts to drive it via
jQuery. If it doesn't work in your setup, check the browser console for errors
and verify jQuery and Select2 are loaded on the page.

---

## License

GPL v2 or later.
