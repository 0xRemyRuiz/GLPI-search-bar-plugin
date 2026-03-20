<?php

/**
 * Serial Search — AJAX endpoint
 * Returns JSON list of assets matching a partial serial number.
 *
 * GET params:
 *   serial (string) — partial or full serial number (min 2 chars)
 */

include('../../../inc/includes.php');

// Must be authenticated
Session::checkLoginUser();

header('Content-Type: application/json; charset=utf-8');

$serial = trim($_GET['serial'] ?? '');
$id = trim($_GET['id'] ?? '');

echo json_encode([$serial, $id]);

if ($id == '' && strlen($serial) < 2) {
    echo json_encode([]);
    exit;
}

global $DB, $CFG_GLPI;

$results = [];

/**
 * Asset types to search across.
 *
 * In GLPI 10+ the "Asset" concept unifies all itemtypes under Item_Ticket.
 * We search each table individually so the query stays simple and fast.
 *
 * glpi_assets_assets covers custom asset definitions added in GLPI 11.
 */
$asset_tables = [
    ['table' => 'glpi_computers',         'label' => 'Computer',  'icon' => '💻'],
    ['table' => 'glpi_phones',            'label' => 'Phone',     'icon' => '📱'],
    ['table' => 'glpi_printers',          'label' => 'Printer',   'icon' => '🖨️'],
    ['table' => 'glpi_monitors',          'label' => 'Monitor',   'icon' => '🖥️'],
    ['table' => 'glpi_networkequipments', 'label' => 'Network',   'icon' => '🌐'],
    ['table' => 'glpi_peripherals',       'label' => 'Peripheral','icon' => '🖱️'],
];

// GLPI 11 generic/custom assets — only query if the table exists
if ($DB->tableExists('glpi_assets_assets')) {
    $asset_tables[] = ['table' => 'glpi_assets_assets', 'label' => 'Asset', 'icon' => '📦'];
}

foreach ($asset_tables as $def) {
    if (!$DB->tableExists($def['table'])) {
        continue;
    }

    try {
        if ($serial) {
            $where = [
                'serial'     => ['LIKE', '%' . $DB->escape($serial) . '%'],
                'is_deleted' => 0,
            ];
        } else {
            $where = [
                'id'         => ['LIKE', $DB->escape($id)],
                'is_deleted' => 0,
            ];
        }

        $iterator = $DB->request([
            'SELECT' => ['id', 'name', 'serial', 'otherserial', 'locations_id', 'users_id'],
            'FROM'   => $def['table'],
            'WHERE'  => $where,
            'ORDER'  => ['serial ASC'],
            'LIMIT'  => 10,
        ]);

        foreach ($iterator as $row) {
            // Resolve location name
            $location = '';
            if (!empty($row['locations_id'])) {
                $loc = $DB->request([
                    'SELECT' => ['completename'],
                    'FROM'   => 'glpi_locations',
                    'WHERE'  => ['id' => $row['locations_id']],
                ])->current();
                $location = $loc['completename'] ?? '';
            }

            // Resolve user name
            $user = '';
            if (!empty($row['users_id'])) {
                $u = $DB->request([
                    'SELECT' => ['firstname', 'realname'],
                    'FROM'   => 'glpi_users',
                    'WHERE'  => ['id' => $row['users_id']],
                ])->current();
                if ($u) {
                    $user = trim(($u['firstname'] ?? '') . ' ' . ($u['realname'] ?? ''));
                }
            }

            // Derive the itemtype class name from the table name
            // Use GLPI's own table-to-itemtype mapping
            $itemtype = getItemTypeForTable($def['table']);

            $results[] = [
                'id'          => (int) $row['id'],
                'itemtype'    => $itemtype,
                'label'       => $def['label'],
                'icon'        => $def['icon'],
                'name'        => $row['name'] ?? '',
                'serial'      => $row['serial'] ?? '',
                'otherserial' => $row['otherserial'] ?? '',
                'location'    => $location,
                'user'        => $user,
            ];
        }
    } catch (Exception $e) {
        // Table may not exist in all GLPI configs — skip silently
        continue;
    }
}

// Exact matches first
usort($results, function ($a, $b) use ($serial) {
    $aExact = (strcasecmp($a['serial'], $serial) === 0) ? 0 : 1;
    $bExact = (strcasecmp($b['serial'], $serial) === 0) ? 0 : 1;
    return $aExact - $bExact;
});

echo json_encode(array_slice($results, 0, 15));
exit;
