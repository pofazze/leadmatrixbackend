export function normalizeBrazilPhone(raw: any): string | null {
  if (raw == null) return null;
  let digits = String(raw).replace(/\D/g, '');
  // Drop leading zeros
  digits = digits.replace(/^0+/, '');

  // If starts without country code, assume 55
  if (!digits.startsWith('55')) {
    // If has 10 or 11 digits (DDD + local), prepend 55
    if (digits.length === 10 || digits.length === 11) {
      digits = '55' + digits;
    } else if (digits.length === 8 || digits.length === 9) {
      // Missing DDD; cannot infer safely
      return null;
    }
  }

  // Now should start with 55
  if (!digits.startsWith('55')) return null;
  // Remove any extra leading 55 repetitions
  digits = '55' + digits.replace(/^55+/, '');

  // After 55, expect 2-digit DDD + 8 or 9 digit local
  const rest = digits.slice(2);
  if (rest.length < 10) return null;
  // Ensure 11-digit (includes leading 9). If 10, insert 9 after DDD
  if (rest.length === 10) {
    const ddd = rest.slice(0, 2);
    const local = rest.slice(2);
    digits = '55' + ddd + '9' + local;
  } else if (rest.length === 11) {
    // Ensure the first local digit is 9; if not, insert 9
    const ddd = rest.slice(0, 2);
    const local = rest.slice(2);
    if (!local.startsWith('9')) {
      digits = '55' + ddd + '9' + local;
    }
  } else {
    // Too long; try to trim to last 11 local digits
    const trimmed = rest.slice(-11);
    const ddd = trimmed.slice(0, 2);
    const local = trimmed.slice(2);
    const localFixed = local.startsWith('9') ? local : ('9' + local.slice(0, 8));
    digits = '55' + ddd + localFixed;
  }

  // Final sanity: 55 + 2 + 9 + 8 = 13 digits
  if (!/^55\d{11}$/.test(digits)) return null;
  return digits;
}
