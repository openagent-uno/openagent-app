/** Pure encrypted-credential vault primitives, isolated for unit testing. */

export interface CredentialCipher {
  isAvailable(): boolean;
  encrypt(plainText: string): Uint8Array;
  decrypt(cipherText: Uint8Array): string;
}

export interface CredentialBackend {
  get(accountId: string): string | null;
  set(accountId: string, cipherTextBase64: string): void;
  delete(accountId: string): void;
}

export interface CredentialVault {
  isAvailable(): boolean;
  has(accountId: string): boolean;
  load(accountId: string): string | null;
  save(accountId: string, password: string): boolean;
  remove(accountId: string): void;
}

const ACCOUNT_ID = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_PASSWORD_LENGTH = 4096;

export function isSafeStorageBackendUsable(
  platform: NodeJS.Platform,
  encryptionAvailable: boolean,
  selectedBackend?: string,
): boolean {
  if (!encryptionAvailable) return false;
  if (platform !== 'linux') return true;
  return !!selectedBackend
    && selectedBackend !== 'basic_text'
    && selectedBackend !== 'unknown';
}

function assertAccountId(accountId: string): void {
  if (!ACCOUNT_ID.test(accountId)) {
    throw new Error('credential accountId is invalid');
  }
}

function assertPassword(password: string): void {
  if (!password || password.length > MAX_PASSWORD_LENGTH) {
    throw new Error('credential password must be between 1 and 4096 characters');
  }
}

export function createCredentialVault(
  backend: CredentialBackend,
  cipher: CredentialCipher,
): CredentialVault {
  const available = () => {
    try {
      return cipher.isAvailable();
    } catch {
      return false;
    }
  };

  return {
    isAvailable: available,

    has(accountId) {
      assertAccountId(accountId);
      return available() && backend.get(accountId) != null;
    },

    load(accountId) {
      assertAccountId(accountId);
      if (!available()) return null;
      const encoded = backend.get(accountId);
      if (encoded == null) return null;
      try {
        const encrypted = Buffer.from(encoded, 'base64');
        if (encrypted.length === 0) throw new Error('empty ciphertext');
        const password = cipher.decrypt(encrypted);
        assertPassword(password);
        return password;
      } catch {
        // A corrupted or no-longer-decryptable entry must never trap the app
        // in an automatic-login loop. Remove only this account's ciphertext.
        backend.delete(accountId);
        return null;
      }
    },

    save(accountId, password) {
      assertAccountId(accountId);
      assertPassword(password);
      if (!available()) return false;
      const encrypted = cipher.encrypt(password);
      if (encrypted.length === 0) throw new Error('credential encryption returned no data');
      backend.set(accountId, Buffer.from(encrypted).toString('base64'));
      return true;
    },

    remove(accountId) {
      assertAccountId(accountId);
      backend.delete(accountId);
    },
  };
}

/** Only authentication rejection invalidates a remembered password.
 * Transport and availability failures keep it so the UI can offer retry. */
export function isCredentialRejection(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const normalized = message.toLowerCase();
  return normalized.includes('unauthorized')
    || normalized.includes('invalid_credentials')
    || normalized.includes('invalid credentials')
    || normalized.includes('wrong password')
    || normalized.includes('incorrect password');
}
