import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'ekos_jwt_secret_key_change_in_production_2026';
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '9h';
export const SESSION_DURATION_SECONDS = 9 * 60 * 60; // 9 hours (32400 seconds)

/**
 * Hashes a plaintext password using bcrypt.
 */
export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}

/**
 * Legacy PBKDF2 hash function for backwards compatibility verification.
 */
function hashPasswordLegacy(password: string): string {
  const salt = 'ekos_project_tracker_salt_2026';
  return crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
}

/**
 * Verifies a plaintext password against a hashed password (supporting both bcrypt and legacy PBKDF2).
 */
export function verifyPassword(password: string, hashedPassword?: string | null): boolean {
  if (!hashedPassword) return false;
  
  // Try bcrypt first
  if (hashedPassword.startsWith('$2a$') || hashedPassword.startsWith('$2b$') || hashedPassword.startsWith('$2y$')) {
    return bcrypt.compareSync(password, hashedPassword);
  }
  
  // Fallback to legacy PBKDF2 verification
  const legacyHash = hashPasswordLegacy(password);
  if (legacyHash.length === hashedPassword.length) {
    return crypto.timingSafeEqual(Buffer.from(legacyHash), Buffer.from(hashedPassword));
  }
  
  return false;
}

export interface JwtPayload {
  userId: string;
  role: string;
}

/**
 * Generates a signed JWT token for a user.
 */
export function generateToken(user: { id: string; role: string }, expiresIn: string | number = JWT_EXPIRES_IN): string {
  const options: jwt.SignOptions = { expiresIn: expiresIn as any };
  return jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, options);
}

/**
 * Verifies and decodes a JWT token.
 */
export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch (error) {
    return null;
  }
}

