'use strict';

/**
 * Sentinel type system.
 *
 * Sentinel types are machine-reserved note types identified by a '$' prefix.
 * They are defined here as the single source of truth. Any note submitted
 * with an unknown '$'-prefixed type is rejected at write time.
 *
 * To add a new sentinel type, add it to SENTINEL_TYPES below.
 */
const SENTINEL_TYPES = new Set([
  '$system',
  '$attachment',
]);

/**
 * Returns true if the given type string is sentinel-prefixed.
 * @param {string} type
 * @returns {boolean}
 */
function isSentinelType(type) {
  return typeof type === 'string' && type.startsWith('$');
}

/**
 * Validate a note type. Throws for unknown sentinel-prefixed types.
 * Regular (non-'$') types pass through without validation.
 * @param {string} type
 */
function validateType(type) {
  if (!isSentinelType(type)) return;
  if (!SENTINEL_TYPES.has(type)) {
    throw new Error(
      `Unknown sentinel type: "${type}". Valid sentinel types: ${[...SENTINEL_TYPES].join(', ')}`
    );
  }
}

module.exports = { SENTINEL_TYPES, isSentinelType, validateType };
