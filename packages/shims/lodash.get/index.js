'use strict';
function get(object, path, defaultValue) {
  if (object == null) return defaultValue;
  const parts = Array.isArray(path)
    ? path
    : String(path)
        .replace(/\[(\d+)\]/g, '.$1')
        .split('.')
        .filter(Boolean);
  let current = object;
  for (const part of parts) {
    if (current == null) return defaultValue;
    current = current[part];
  }
  return current === undefined ? defaultValue : current;
}
module.exports = get;
