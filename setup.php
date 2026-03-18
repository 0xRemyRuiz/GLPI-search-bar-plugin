<?php

/**
 * Serial Search — GLPI Plugin
 * Compatible with GLPI 10.x and 11.x
 */

define('PLUGIN_SERIALSEARCH_VERSION', '1.0.0');
define('PLUGIN_SERIALSEARCH_MIN_GLPI', '10.0.0');
define('PLUGIN_SERIALSEARCH_MAX_GLPI', '11.99.99');

/**
 * Plugin metadata — required by GLPI
 */
function plugin_version_serialsearch() {
    return [
        'name'         => 'Serial Search',
        'version'      => PLUGIN_SERIALSEARCH_VERSION,
        'author'       => 'Repair Shop',
        'license'      => 'MIT',
        'homepage'     => '',
        'requirements' => [
            'glpi' => [
                'min' => PLUGIN_SERIALSEARCH_MIN_GLPI,
                'max' => PLUGIN_SERIALSEARCH_MAX_GLPI,
            ],
        ],
    ];
}

/**
 * Prerequisites check — required by GLPI
 */
function plugin_serialsearch_check_prerequisites() {
    return true;
}

/**
 * Config check — required by GLPI
 */
function plugin_serialsearch_check_config() {
    return true;
}

/**
 * Plugin init — called by GLPI on every page load.
 * Note: function name must be plugin_init_PLUGINNAME (not plugin_PLUGINNAME_init).
 */
function plugin_init_serialsearch() {
    global $PLUGIN_HOOKS;

    // Required for CSRF protection
    $PLUGIN_HOOKS['csrf_compliant']['serialsearch'] = true;

    // Only inject our JS/CSS on the ticket creation / edition page
    $uri = $_SERVER['REQUEST_URI'] ?? '';
    if (
        strpos($uri, 'ticket.form.php') !== false ||
        strpos($uri, '/Ticket/') !== false   // GLPI 11 uses clean URLs
    ) {
        // In GLPI 10+/11, paths are relative to the plugin's /public directory
        $PLUGIN_HOOKS['add_javascript']['serialsearch'] = ['js/serialsearch.js'];
        $PLUGIN_HOOKS['add_css']['serialsearch']        = ['css/serialsearch.css'];
    }
}
