export function formatPrice(amount) {
  const numericAmount = Number(amount);

  return `${numericAmount.toLocaleString("uz-UZ")} so'm`;
}

export const PHONE_REGEX = /^\+?\d{9,15}$/;

export function normalizePhoneNumber(rawPhone) {
  const digitsOnly = rawPhone.replace(/[\s()-]/g, "");
  return digitsOnly.startsWith("+") ? digitsOnly : `+${digitsOnly}`;
}

export function buildGoogleMapsLink(latitude, longitude) {
  return `https://www.google.com/maps?q=${latitude},${longitude}`;
}
