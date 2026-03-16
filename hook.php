<?php

/**
 * Install hook — no DB tables needed, we only read existing GLPI tables
 */
function plugin_serialsearch_install() {
    return true;
}

/**
 * Uninstall hook
 */
function plugin_serialsearch_uninstall() {
    return true;
}
