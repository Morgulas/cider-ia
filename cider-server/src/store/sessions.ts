import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import { readJson, SerialQueue, writeFileAtomic } from './json-file.js';

interface SessionRecord {
  /** sha256 of the token: a stolen sessions.json does not give usable tokens */
  tokenHash: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
}

interface SessionsFile {
  version: 1;
  sessions: SessionRecord[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
// a session is extended at most once per hour, to avoid a disk write per request
const RENEW_AFTER_MS = 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Login sessions. The browser keeps a random token in an HttpOnly cookie;
 * only its hash is stored, in sessions.json, so sessions survive a restart.
 */
export class SessionStore {
  private sessions: SessionRecord[] = [];
  private readonly file: string;
  private readonly queue = new SerialQueue();

  constructor(dataDir: string, private readonly lifetimeDays: number) {
    this.file = path.join(dataDir, 'sessions.json');
  }

  async load(): Promise<void> {
    const content = await readJson<SessionsFile>(this.file, { version: 1, sessions: [] });
    const now = Date.now();
    this.sessions = (content.sessions ?? []).filter(session => Date.parse(session.expiresAt) > now);
  }

  private save(): Promise<void> {
    const content: SessionsFile = { version: 1, sessions: this.sessions };
    return writeFileAtomic(this.file, JSON.stringify(content));
  }

  private expiry(): string {
    return new Date(Date.now() + this.lifetimeDays * DAY_MS).toISOString();
  }

  /** Creates a session and returns the token to put in the cookie */
  create(userId: string): Promise<string> {
    return this.queue.run(async () => {
      const token = randomBytes(32).toString('base64url');
      this.sessions.push({
        tokenHash: hashToken(token),
        userId,
        createdAt: new Date().toISOString(),
        expiresAt: this.expiry(),
      });
      await this.save();
      return token;
    });
  }

  /** Returns the user id of a valid session, extending it while it is used */
  async resolve(token: string | undefined): Promise<string | undefined> {
    if (!token) {
      return undefined;
    }
    const tokenHash = hashToken(token);
    const session = this.sessions.find(candidate => candidate.tokenHash === tokenHash);
    if (!session) {
      return undefined;
    }
    const expiresAt = Date.parse(session.expiresAt);
    if (expiresAt <= Date.now()) {
      await this.queue.run(async () => {
        this.sessions = this.sessions.filter(candidate => candidate !== session);
        await this.save();
      });
      return undefined;
    }
    if (expiresAt - Date.now() < this.lifetimeDays * DAY_MS - RENEW_AFTER_MS) {
      await this.queue.run(async () => {
        session.expiresAt = this.expiry();
        await this.save();
      });
    }
    return session.userId;
  }

  revoke(token: string | undefined): Promise<void> {
    return this.queue.run(async () => {
      if (!token) {
        return;
      }
      const tokenHash = hashToken(token);
      this.sessions = this.sessions.filter(session => session.tokenHash !== tokenHash);
      await this.save();
    });
  }

  /** Logs a user out everywhere (password change, account disabled or deleted) */
  revokeUser(userId: string, exceptToken?: string): Promise<void> {
    return this.queue.run(async () => {
      const keep = exceptToken ? hashToken(exceptToken) : undefined;
      this.sessions = this.sessions.filter(session => session.userId !== userId || session.tokenHash === keep);
      await this.save();
    });
  }
}
