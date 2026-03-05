<?php

/**
 * Serial Search Plugin for GLPI
 * Adds a quick serial number search bar to ticket forms
 */

define('PLUGIN_SERIALSEARCH_VERSION', '1.0.0');
define('PLUGIN_SERIALSEARCH_MIN_GLPI', '10.0.0');
// define('PLUGIN_SERIALSEARCH_MAX_GLPI', '11.99.99');
define('SERIALSEARCH_ROOT', Plugin::getWebDir('serialsearch'));


/**
 * Plugin version information
 */
function plugin_version_serialsearch(): array {
    return [
        'name'         => 'Serial Search',
        'version'      => PLUGIN_SERIALSEARCH_VERSION,
        'author'       => 'Repair Shop',
        'license'      => 'GPL v2+',
        'homepage'     => '',
        'requirements' => [
            'glpi' => [
                'min' => PLUGIN_SERIALSEARCH_MIN_GLPI,
                // 'max' => PLUGIN_SERIALSEARCH_MAX_GLPI,
            ]
        ]
    ];
}

/**
 * Check prerequisites before enabling the plugin
 */
function plugin_serialsearch_check_prerequisites(): bool {
    if (version_compare(GLPI_VERSION, PLUGIN_SERIALSEARCH_MIN_GLPI, 'lt')) {
        echo "This plugin requires GLPI >= " . PLUGIN_SERIALSEARCH_MIN_GLPI;
        return false;
    }
    return true;
}

/**
 * Check plugin configuration
 */
function plugin_serialsearch_check_config(): bool {
    return true;
}

/**
 * Register hooks
 */
function plugin_serialsearch_init(): void {
    global $PLUGIN_HOOKS;

    $PLUGIN_HOOKS['csrf_compliant']['serialsearch'] = true;

    // Inject JS on every page (will self-activate only on ticket forms)
    // $PLUGIN_HOOKS['add_javascript']['serialsearch'] = 'plugin_serialsearch_add_javascript';
    $PLUGIN_HOOKS['add_javascript']['serialsearch'] = ['js/serialsearch.js'];

    // Inject CSS
    // $PLUGIN_HOOKS['add_css']['serialsearch'] = 'plugin_serialsearch_add_css';
    $PLUGIN_HOOKS['add_css']['serialsearch'] = ['css/serialsearch.css'];
}

/**
 * Output the JS include tag
 */
// function plugin_serialsearch_add_javascript(): void {
//     echo "<script src='" . SERIALSEARCH_ROOT ."/js/serialsearch.js?v=" . PLUGIN_SERIALSEARCH_VERSION . "'></script>\n";
// }

/**
 * Output the CSS include tag
 */
// function plugin_serialsearch_add_css(): void {
//     echo "<link rel='stylesheet' href='" . SERIALSEARCH_ROOT . "/css/serialsearch.css?v=" . PLUGIN_SERIALSEARCH_VERSION . "'>\n";
// }

