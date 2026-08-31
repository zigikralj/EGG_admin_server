import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { UserRole } from './types';

const JWT_SECRET_ENV = process.env.JWT_SECRET;
if (!JWT_SECRET_ENV) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('FATAL: JWT_SECRET environment variable is required in production');
  }
  console.warn('⚠️ JWT_SECRET not set — using development fallback. DO NOT use in production.');
}
const JWT_SECRET = JWT_SECRET_ENV || 'dev_only_secret_not_for_production';
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
  role: UserRole | string;
}

/**
 * Generates a signed JWT token for a user.
 */
export function generateToken(user: { id: string; role: UserRole | string }, expiresIn: string | number = JWT_EXPIRES_IN): string {
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


// Generates a temporary 12-character secure password for admin-created users
export function generateTempPassword(length = 12): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%&*';
  const all = upper + lower + digits + symbols;
  // Guarantee at least one of each category
  let password = [
    upper[crypto.randomInt(upper.length)],
    lower[crypto.randomInt(lower.length)],
    digits[crypto.randomInt(digits.length)],
    symbols[crypto.randomInt(symbols.length)],
  ];
  for (let i = password.length; i < length; i++) {
    password.push(all[crypto.randomInt(all.length)]);
  }
  // Shuffle
  return password.sort(() => crypto.randomInt(3) - 1).join('');
}
