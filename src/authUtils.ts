import crypto from 'crypto';

/**
 * Hashes a plaintext password using pbkdf2Sync.
 */
export function hashPassword(password: string): string {
  const salt = 'ekos_project_tracker_salt_2026';
  return crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
}

/**
 * Verifies a plaintext password against a hashed password.
 */
export function verifyPassword(password: string, hashedPassword?: string | null): boolean {
  if (!hashedPassword) return false;
  const hash = hashPassword(password);
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(hashedPassword));
}
