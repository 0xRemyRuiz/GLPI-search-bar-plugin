<?php

/**
 * Plugin install hook
 * Nothing to create in DB for this plugin — we only query existing tables.
 */
function plugin_serialsearch_install(): bool {
    return true;
}

/**
 * Plugin uninstall hook
 */
function plugin_serialsearch_uninstall(): bool {
    return true;
}
