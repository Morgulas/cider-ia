import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { readJson, SerialQueue, writeFileAtomic } from './json-file.js';

export interface UserRecord {
  id: string;
  username: string;
  passwordHash: string;
  isAdmin: boolean;
  disabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/** What the API returns about a user: never the password hash */
export interface PublicUser {
  id: string;
  username: string;
  isAdmin: boolean;
  disabled: boolean;
  createdAt: string;
}

interface UsersFile {
  version: 1;
  users: UserRecord[];
}

export const USERNAME_PATTERN = /^[a-zA-Z0-9._-]{3,32}$/;

export class UserStoreError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export function toPublicUser(user: UserRecord): PublicUser {
  return {
    id: user.id,
    username: user.username,
    isAdmin: user.isAdmin,
    disabled: user.disabled,
    createdAt: user.createdAt,
  };
}

/**
 * Accounts, kept in memory and saved to users.json after every change.
 */
export class UserStore {
  private users: UserRecord[] = [];
  private readonly file: string;
  private readonly queue = new SerialQueue();

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'users.json');
  }

  async load(): Promise<void> {
    const content = await readJson<UsersFile>(this.file, { version: 1, users: [] });
    this.users = content.users ?? [];
  }

  private save(): Promise<void> {
    const content: UsersFile = { version: 1, users: this.users };
    return writeFileAtomic(this.file, JSON.stringify(content, null, 2));
  }

  count(): number {
    return this.users.length;
  }

  list(): UserRecord[] {
    return [...this.users].sort((a, b) => a.username.localeCompare(b.username));
  }

  get(id: string): UserRecord | undefined {
    return this.users.find(user => user.id === id);
  }

  findByUsername(username: string): UserRecord | undefined {
    const wanted = username.toLowerCase();
    return this.users.find(user => user.username.toLowerCase() === wanted);
  }

  private activeAdminCount(): number {
    return this.users.filter(user => user.isAdmin && !user.disabled).length;
  }

  /**
   * Creates an account. With onlyFirst, it is refused if any account already
   * exists (checked inside the write queue: two simultaneous setups cannot both succeed).
   */
  create(username: string, passwordHash: string, isAdmin: boolean, onlyFirst = false): Promise<UserRecord> {
    return this.queue.run(async () => {
      if (onlyFirst && this.users.length > 0) {
        throw new UserStoreError('the administrator account already exists', 409);
      }
      if (!USERNAME_PATTERN.test(username)) {
        throw new UserStoreError('username must be 3 to 32 letters, digits, ".", "_" or "-"', 400);
      }
      if (this.findByUsername(username)) {
        throw new UserStoreError('this username is already taken', 409);
      }
      const now = new Date().toISOString();
      const user: UserRecord = {
        id: randomUUID(),
        username,
        passwordHash,
        isAdmin,
        disabled: false,
        createdAt: now,
        updatedAt: now,
      };
      this.users.push(user);
      await this.save();
      return user;
    });
  }

  /**
   * Updates a user. Refuses any change that would leave no active administrator.
   */
  update(id: string, changes: Partial<Pick<UserRecord, 'passwordHash' | 'isAdmin' | 'disabled'>>): Promise<UserRecord> {
    return this.queue.run(async () => {
      const user = this.get(id);
      if (!user) {
        throw new UserStoreError('user not found', 404);
      }
      const losesAdmin = user.isAdmin && !user.disabled
        && (changes.isAdmin === false || changes.disabled === true);
      if (losesAdmin && this.activeAdminCount() <= 1) {
        throw new UserStoreError('at least one active administrator is required', 409);
      }
      Object.assign(user, changes, { updatedAt: new Date().toISOString() });
      await this.save();
      return user;
    });
  }

  delete(id: string): Promise<void> {
    return this.queue.run(async () => {
      const user = this.get(id);
      if (!user) {
        throw new UserStoreError('user not found', 404);
      }
      if (user.isAdmin && !user.disabled && this.activeAdminCount() <= 1) {
        throw new UserStoreError('at least one active administrator is required', 409);
      }
      this.users = this.users.filter(other => other.id !== id);
      await this.save();
    });
  }
}
