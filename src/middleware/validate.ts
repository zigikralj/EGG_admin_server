/**
 * Input validation and sanitization helpers.
 */

/**
 * Trims a string value. Returns null if empty or not a string.
 */
export function sanitizeString(val: unknown): string | null {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Password complexity validator.
 * Requires: ≥8 chars, 1 uppercase, 1 lowercase, 1 digit, 1 special character.
 * (Active enforcement in routes will be wired up in Phase 3.)
 */
export function validatePassword(password: string): { valid: boolean; message: string } {
  if (password.length < 8)
    return { valid: false, message: 'Password must be at least 8 characters long.' };
  if (!/[A-Z]/.test(password))
    return { valid: false, message: 'Password must contain at least one uppercase letter.' };
  if (!/[a-z]/.test(password))
    return { valid: false, message: 'Password must contain at least one lowercase letter.' };
  if (!/[0-9]/.test(password))
    return { valid: false, message: 'Password must contain at least one digit.' };
  if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password))
    return { valid: false, message: 'Password must contain at least one special character.' };
  return { valid: true, message: '' };
}
