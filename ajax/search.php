<?php

/**
 * AJAX endpoint: search assets by serial number
 * Called by serialsearch.js via fetch()
 *
 * GET params:
 *   serial  (string) — partial or full serial number to search
 *   type    (string) — asset type filter: 'all' | 'computers' | 'phones' | 'printers' (default: all)
 */

// Boot GLPI
include('../../../inc/includes.php');

// Must be logged in
Session::checkLoginUser();

header('Content-Type: application/json');

$serial = trim($_GET['serial'] ?? '');
$type   = trim($_GET['type'] ?? 'all');

// Minimum 2 characters to search
if (strlen($serial) < 2) {
    echo json_encode([]);
    exit;
}

global $DB;
$results = [];

// Map of asset types to their GLPI tables
$tables = [
    'computers' => [
        'table'     => 'glpi_computers',
        'typeLabel' => 'Computer',
        'icon'      => '💻',
    ],
    'phones' => [
        'table'     => 'glpi_phones',
        'typeLabel' => 'Phone',
        'icon'      => '📱',
    ],
    'printers' => [
        'table'     => 'glpi_printers',
        'typeLabel' => 'Printer',
        'icon'      => '🖨️',
    ],
    'monitors' => [
        'table'     => 'glpi_monitors',
        'typeLabel' => 'Monitor',
        'icon'      => '🖥️',
    ],
];

// Filter by type if requested
if ($type !== 'all' && isset($tables[$type])) {
    $tables = [$type => $tables[$type]];
}

foreach ($tables as $typeKey => $def) {
    try {
        $iterator = $DB->request([
            'SELECT' => ['id', 'name', 'serial', 'otherserial', 'locations_id', 'users_id'],
            'FROM'   => $def['table'],
            'WHERE'  => [
                ['serial'     => ['LIKE', "%" . $DB->escape($serial) . "%"]],
                ['is_deleted' => 0],
            ],
            'ORDER'  => ['serial ASC'],
            'LIMIT'  => 8,
        ]);

        foreach ($iterator as $row) {
            // Resolve location name
            $locationName = '';
            if (!empty($row['locations_id'])) {
                $locRow = $DB->request([
                    'SELECT' => ['completename'],
                    'FROM'   => 'glpi_locations',
                    'WHERE'  => ['id' => $row['locations_id']],
                ])->current();
                $locationName = $locRow['completename'] ?? '';
            }

            // Resolve user name
            $userName = '';
            if (!empty($row['users_id'])) {
                $userRow = $DB->request([
                    'SELECT' => ['firstname', 'realname'],
                    'FROM'   => 'glpi_users',
                    'WHERE'  => ['id' => $row['users_id']],
                ])->current();
                if ($userRow) {
                    $userName = trim(($userRow['firstname'] ?? '') . ' ' . ($userRow['realname'] ?? ''));
                }
            }

            $results[] = [
                'id'           => (int) $row['id'],
                'type'         => $typeKey,
                'typeLabel'    => $def['typeLabel'],
                'icon'         => $def['icon'],
                'name'         => $row['name'],
                'serial'       => $row['serial'],
                'otherserial'  => $row['otherserial'],
                'location'     => $locationName,
                'user'         => $userName,
                'editUrl'      => $CFG_GLPI['root_doc'] . '/front/' . rtrim($typeKey, 's') . '.form.php?id=' . $row['id'],
                'createUrl'    => $CFG_GLPI['root_doc'] . '/front/' . rtrim($typeKey, 's') . '.form.php',
            ];
        }
    } catch (Exception $e) {
        // Table might not exist in all GLPI configs — skip silently
        continue;
    }
}

// Sort: exact matches first
usort($results, function($a, $b) use ($serial) {
    $aExact = strcasecmp($a['serial'], $serial) === 0 ? 0 : 1;
    $bExact = strcasecmp($b['serial'], $serial) === 0 ? 0 : 1;
    return $aExact - $bExact;
});

echo json_encode(array_slice($results, 0, 10));
exit;
