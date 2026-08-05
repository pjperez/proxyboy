'use strict';
function parse(value, strict) {
  if (typeof value === 'boolean') return value;
  if (value == null) return false;
  if (typeof value === 'number') return value !== 0 && !Number.isNaN(value);
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n', 'off', ''].includes(normalized)) return false;
    return strict ? false : Boolean(value);
  }
  return Boolean(value);
}
function isBooleanable(value) {
  if (typeof value === 'boolean' || typeof value === 'number') return true;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return ['true','false','1','0','yes','no','y','n','on','off',''].includes(normalized);
  }
  return false;
}
module.exports = parse;
module.exports.boolean = parse;
module.exports.isBooleanable = isBooleanable;
