/**
 * Metro bundler config.
 *
 * We opt out of the newer ``exports`` field resolution because several
 * transitive dependencies (zustand nested under @reactflow/*) ship an
 * ESM ``.mjs`` entrypoint that uses ``import.meta``. Metro can bundle
 * the file but the web runtime serves the result as a plain script, so
 * ``import.meta`` throws ``Cannot use 'import.meta' outside a module``.
 *
 * Falling back to the legacy ``main`` / ``module`` fields picks up the
 * CJS builds, which Metro handles correctly on both web and native.
 * This matches the Expo-blessed escape hatch:
 *   https://docs.expo.dev/guides/customizing-metro/#resolution
 */
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.unstable_enablePackageExports = false;

module.exports = config;
