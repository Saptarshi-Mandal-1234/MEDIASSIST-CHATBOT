function bad(message) { const e = new Error(message); e.status = 400; throw e; }
function text(value, name, required = false, max = 500) {
  if (value == null || value === '') { if (required) bad(`${name} is required`); return null; }
  if (typeof value !== 'string' || !value.trim() || value.length > max) bad(`${name} must be text of at most ${max} characters`);
  return value.trim();
}
function number(value, name, min, max, integer = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) bad(`${name} must be ${integer ? 'an integer' : 'a number'} between ${min} and ${max}`);
  return value;
}
function id(value) { if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) bad('Invalid record ID'); return Number(value); }
module.exports = { bad, text, number, id };
