import bcrypt from 'bcryptjs'

/**
 * Hash password bằng bcrypt với cost factor 10.
 * Requirement: 12.2
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10)
}

/**
 * Verify password against bcrypt hash.
 * Requirement: 12.2
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}
