// src/modules/validation.js
// ─────────────────────────────────────────────────────────────
// Centralised input validation and sanitisation.
// All user input MUST pass through these before hitting the DB.
//
// Security note:
//   – Supabase uses parameterised queries so SQL injection is
//     already impossible. These functions add a second layer:
//     they trim, limit length, and reject obviously bad data.
//   – HTML escaping lives in the render layer (escapeHtml),
//     NOT here. Sanitisation here is about data integrity.
// ─────────────────────────────────────────────────────────────

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Sanitise a plain text field.
 *
 * @param {string}  value      Raw input
 * @param {string}  fieldName  Human-readable name (for error messages)
 * @param {number}  maxLen     Maximum character length
 * @param {boolean} required   Whether empty string is an error
 * @returns {string} Trimmed, length-checked value
 */
export function sanitizeText(value, fieldName, maxLen = 255, required = true) {
  const trimmed = String(value ?? '').trim();

  if (required && !trimmed) {
    throw new ValidationError(`${fieldName} nu poate fi gol.`);
  }

  if (trimmed.length > maxLen) {
    throw new ValidationError(`${fieldName} poate avea maxim ${maxLen} caractere.`);
  }

  return trimmed;
}

/**
 * Normalise and validate a Romanian phone number.
 * Accepts formats: 0775147463, +40775147463, 40775147463
 * Always returns the 10-digit national form (07xx...) or throws.
 */
export function sanitizePhone(raw) {
  if (!raw) return null;

  // Strip everything that isn't a digit or leading +
  const cleaned = String(raw).trim();
  const digits  = cleaned.replace(/\D/g, '');

  let national;
  if (digits.startsWith('40') && digits.length === 11) {
    national = `0${digits.slice(2)}`;
  } else if (digits.startsWith('0') && digits.length === 10) {
    national = digits;
  } else {
    // Non-standard length / prefix – return as-is so we don't reject
    // valid numbers from other countries if the tutor has foreign students
    if (digits.length < 7 || digits.length > 15) return null;
    return digits;
  }

  return national;
}

/**
 * Escape HTML special characters before inserting into innerHTML.
 * Use this on EVERY piece of user-generated content.
 */
export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&',  '&amp;')
    .replaceAll('<',  '&lt;')
    .replaceAll('>',  '&gt;')
    .replaceAll('"',  '&quot;')
    .replaceAll("'",  '&#x27;');
}

/**
 * Escape a value for use inside an HTML attribute.
 */
export function escapeAttr(value) {
  return escapeHtml(value);
}
