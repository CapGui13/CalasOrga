import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

// ===== src/runtime.mjs =====
function sameExecutablePath(modulePath, argvPath, platform = process.platform) {
  if (!modulePath || !argvPath) return false;
  const p = platform === 'win32' ? path.win32 : path.posix;
  const left = p.normalize(modulePath);
  const right = p.normalize(p.resolve(argvPath));
  return platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function isMainModule(importMetaUrl, argvPath = process.argv[1], platform = process.platform) {
  if (!importMetaUrl || !argvPath) return false;
  return sameExecutablePath(fileURLToPath(importMetaUrl), argvPath, platform);
}


// ===== src/security.mjs =====
function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
}

function timingSafeHexEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  try { return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex')); } catch { return false; }
}

function parseCookies(header = '') {
  const out = {};
  for (const chunk of header.split(';')) {
    const idx = chunk.indexOf('=');
    if (idx <= 0) continue;
    const key = chunk.slice(0, idx).trim();
    const val = chunk.slice(idx + 1).trim();
    try { out[key] = decodeURIComponent(val); } catch { out[key] = val; }
  }
  return out;
}

function cookie(name, value, { httpOnly = true, secure = false, maxAge = 60 * 60 * 24 * 90 } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', `Max-Age=${maxAge}`, 'SameSite=Strict'];
  if (httpOnly) parts.push('HttpOnly');
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function clearCookie(name, { secure = false, httpOnly = true } = {}) {
  const parts = [`${name}=`, 'Path=/', 'Max-Age=0', 'SameSite=Strict'];
  if (httpOnly) parts.push('HttpOnly');
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function requestIsHttps(req, { trustProxy = false } = {}) {
  if (req.socket?.encrypted) return true;
  if (!trustProxy) return false;
  return String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase() === 'https';
}

function clientIp(req, { trustProxy = false } = {}) {
  const direct = String(req.socket?.remoteAddress || '').trim();
  if (!trustProxy) return direct;
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || direct;
}

function sameOriginCsrfOk(req, cookies, cookieName = 'club_csrf') {
  const header = req.headers['x-csrf-token'];
  const expected = cookies?.[cookieName];
  return typeof header === 'string' && header.length >= 16 && typeof expected === 'string' && header === expected;
}

function sameOriginRequestOk(req, { trustProxy = false } = {}) {
  const origin = String(req.headers.origin || '');
  const host = String(req.headers.host || '');
  if (!origin || !host) return false;
  try {
    const u = new URL(origin);
    const expectedProtocol = requestIsHttps(req, { trustProxy }) ? 'https:' : 'http:';
    return u.protocol === expectedProtocol && u.host === host;
  } catch {
    return false;
  }
}


function browserMutationMetadataOk(req) {
  const site = String(req.headers['sec-fetch-site'] || '').trim().toLowerCase();
  // Les clients non-navigateurs peuvent ne pas envoyer Sec-Fetch-Site. Quand le navigateur le fournit,
  // on refuse explicitement les mutations cross-site en défense supplémentaire à SameSite + CSRF.
  return !site || site === 'same-origin' || site === 'none';
}


// ===== src/domain.mjs =====
const OPEN_WEEKDAYS = new Set([1, 2, 4]); // lundi, mardi, jeudi (UTC weekday)
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const MEMBER_HORIZON_DAYS = 366;

function isIsoDate(value) {
  if (!ISO_RE.test(String(value || ''))) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function parisToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}


function addIsoDays(iso, days) {
  if (!isIsoDate(iso) || !Number.isInteger(days)) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth()+1).padStart(2,'0')}-${String(dt.getUTCDate()).padStart(2,'0')}`;
}

function weekdayForIso(iso) {
  if (!isIsoDate(iso)) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function defaultIsOpen(iso) {
  const wd = weekdayForIso(iso);
  return wd !== null && OPEN_WEEKDAYS.has(wd);
}

function effectiveIsOpen(state, iso) {
  const ex = state.scheduleExceptions?.[iso];
  return typeof ex?.isOpen === 'boolean' ? ex.isOpen : defaultIsOpen(iso);
}

function validateMemberDateChange(state, iso, now = new Date()) {
  if (!isIsoDate(iso)) return { ok: false, status: 400, error: 'Date invalide.' };
  const today = parisToday(now);
  if (iso < today) return { ok: false, status: 409, error: 'Les dates passées sont verrouillées.' };
  const maxDate = addIsoDays(today, MEMBER_HORIZON_DAYS);
  if (iso > maxDate) return { ok: false, status: 409, error: `Les inscriptions sont limitées aux ${MEMBER_HORIZON_DAYS} prochains jours.` };
  if (!effectiveIsOpen(state, iso)) return { ok: false, status: 409, error: "Le club n'est pas ouvert ce jour-là." };
  return { ok: true };
}


function isoDateRange(from, to, maxDays = 366) {
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) return null;
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const start = new Date(Date.UTC(fy, fm - 1, fd));
  const end = new Date(Date.UTC(ty, tm - 1, td));
  const days = Math.floor((end - start) / 86400000) + 1;
  if (days < 1 || days > maxDays) return null;
  const out = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start.getTime() + i * 86400000);
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`);
  }
  return out;
}

function sanitizeName(name) {
  const clean = String(name || '').trim().replace(/\s+/g, ' ');
  if (clean.length < 1 || clean.length > 80) return null;
  return clean;
}

function publicSnapshot(state, currentMemberId = null) {
  const members = state.members
    .filter((m) => m.active)
    .map(({ id, displayName }) => ({ id, name: displayName }));
  const activeIds = new Set(members.map((m) => m.id));
  const attendance = {};
  for (const [date, ids] of Object.entries(state.attendance || {})) {
    const filtered = Array.isArray(ids) ? ids.filter((id) => activeIds.has(id)) : [];
    if (filtered.length) attendance[date] = filtered;
  }
  const roleAssignments = {};
  for (const [date, rawRoles] of Object.entries(state.roleAssignments || {})) {
    if (!rawRoles || typeof rawRoles !== 'object' || Array.isArray(rawRoles)) continue;
    const roles = {};
    for (const role of ROLE_KEYS) {
      const filtered = Array.isArray(rawRoles[role]) ? rawRoles[role].filter((id) => activeIds.has(id)) : [];
      if (filtered.length) roles[role] = filtered;
    }
    if (Object.keys(roles).length) roleAssignments[date] = roles;
  }
  const assignments = {};
  const assignmentDates = new Set([...Object.keys(attendance), ...Object.keys(roleAssignments)]);
  for (const date of assignmentDates) {
    assignments[date] = {
      accueil: roleAssignments[date]?.accueil || [],
      tpe: roleAssignments[date]?.tpe || [],
      mep: roleAssignments[date]?.mep || [],
      arbitrage: roleAssignments[date]?.arbitrage || [],
      present: attendance[date] || []
    };
  }
  const exceptions = Object.fromEntries(
    Object.entries(state.scheduleExceptions || {}).map(([date, ex]) => [date, { isOpen: !!ex.isOpen, note: ex.note || '' }])
  );
  return {
    members,
    attendance,
    roleAssignments,
    assignments,
    scheduleExceptions: exceptions,
    settings: { minRequired: Math.max(1, Number(state.settings?.minRequired || 1)), timezone: 'Europe/Paris', defaultOpenDays: [1, 2, 4], roles: ALL_ROLE_KEYS },
    me: currentMemberId ? members.find((m) => m.id === currentMemberId) || null : null
  };
}


// ===== src/seed.mjs =====
const DEMO_MEMBER_TOKENS = {
  'Odile': 'demo-odile-Q7m2Kx9Lp4Vt',
  'Guillaume': 'demo-guillaume-N8p3Rw6Zk2Hs',
  'Sylvie': 'demo-sylvie-F5x9Md2Qa7Lc',
  'Caroline': 'demo-caroline-T4v8Jp1Ys6Kn',
  'Véronique': 'demo-veronique-C9h2Wx5Rb8Mf',
  'Gérard': 'demo-gerard-L6q1Nz4Vk7Pt',
  'Patrick': 'demo-patrick-A3s8Hy5Dm2Xc',
  'Christian': 'demo-christian-U7k4Fp9Qw1Ze',
  'Armelle': 'demo-armelle-B2m6Rt8Lj5Vs',
  'Pascal': 'demo-pascal-E9x3Kn7Gc4Ha'
};

function makeDemoSeed(now = new Date('2026-08-27T15:00:00Z')) {
  const entries = Object.entries(DEMO_MEMBER_TOKENS);
  const members = entries.map(([displayName], i) => ({ id: `demo_${String.fromCharCode(97 + i)}`, displayName, active: true, createdAt: now.toISOString() }));
  const memberTokens = entries.map(([displayName, raw], i) => ({
    id: `demo_token_${i + 1}`, memberId: members[i].id, tokenHash: tokenHash(raw), active: true, createdAt: now.toISOString(), revokedAt: null
  }));
  return {
    schemaVersion: 2,
    settings: { minRequired: 1 },
    members,
    memberTokens,
    sessions: [],
    attendance: {
      '2026-09-01': ['demo_b'],
      '2026-09-03': ['demo_a', 'demo_c'],
      '2026-09-07': ['demo_d'],
      '2026-09-08': ['demo_a', 'demo_b'],
      '2026-09-14': ['demo_c'],
      '2026-09-15': ['demo_a', 'demo_d'],
      '2026-09-17': ['demo_b']
    },
    roleAssignments: {
      '2026-09-01': { accueil: ['demo_a'], arbitrage: ['demo_d'] },
      '2026-09-03': { tpe: ['demo_b'], mep: ['demo_c'] }
    },
    scheduleExceptions: { '2026-12-24': { isOpen: false, note: 'Fermeture de démonstration' } },
    auditLog: [
      { at: '2026-08-27T13:10:00Z', actor: 'Guillaume', action: 'inscription', date: '2026-09-01', metadata: {} },
      { at: '2026-08-27T13:12:00Z', actor: 'Odile', action: 'inscription', date: '2026-09-03', metadata: {} }
    ]
  };
}


// ===== src/store-file.mjs =====
function clone(v) { return JSON.parse(JSON.stringify(v)); }

const RELAXED_FSYNC = process.env.RELAXED_FSYNC === '1';

const CURRENT_SCHEMA_VERSION = 3;
const BACKUP_FORMAT_VERSION = 2;
const ROLE_KEYS = ['accueil', 'tpe', 'mep', 'arbitrage'];
const ALL_ROLE_KEYS = [...ROLE_KEYS, 'present'];

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

function sha256Text(text) { return crypto.createHash('sha256').update(text, 'utf8').digest('hex'); }

function safeIsoInstant(value) {
  const t = Date.parse(String(value || ''));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function sanitizeAuditMetadata(value, depth = 0) {
  if (depth > 3) return '[tronqué]';
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value.slice(0, 500);
  if (Array.isArray(value)) return value.slice(0, 30).map((v) => sanitizeAuditMetadata(v, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value).slice(0, 30)) out[String(k).slice(0, 80)] = sanitizeAuditMetadata(v, depth + 1);
    return out;
  }
  return String(value).slice(0, 500);
}

const INITIAL_ROSTER = ['Odile','Guillaume','Sylvie','Caroline','Véronique','Gérard','Patrick','Christian','Armelle','Pascal'];
function defaultState() {
  const createdAt = new Date().toISOString();
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    settings: { minRequired: 1 },
    members: INITIAL_ROSTER.map((displayName, i) => ({ id: `initial_${i + 1}`, displayName, active: true, createdAt })),
    memberTokens: [],
    sessions: [],
    attendance: {},
    roleAssignments: {},
    scheduleExceptions: {},
    auditLog: []
  };
}

class FileStore {
  constructor(filePath, { now = () => new Date() } = {}) {
    this.filePath = filePath;
    this.now = now;
    this.state = null;
    this.queue = Promise.resolve();
    this.confirmationSecret = randomToken(32);
  }

  async init(seed = null) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await this.#cleanupStaleTemps();
    let primaryError = null;
    try {
      await this.#loadStateFile(this.filePath);
      return this;
    } catch (err) {
      if (err?.code === 'ENOENT') {
        this.state = seed ? clone(seed) : defaultState();
        this.#normalize({ requireEnvelope: true });
        await this.#persist({ preserveCurrent: false });
        return this;
      }
      if (err?.code === 'UNSUPPORTED_SCHEMA') throw err;
      primaryError = err;
    }
    for (const suffix of ['.good', '.bak']) {
      try {
        await this.#loadStateFile(`${this.filePath}${suffix}`);
        console.warn(`Stockage principal illisible/invalide : récupération depuis ${suffix}.`);
        await this.#persist({ preserveCurrent: false });
        return this;
      } catch (recoveryErr) {
        if (recoveryErr?.code === 'UNSUPPORTED_SCHEMA') throw recoveryErr;
      }
    }
    throw primaryError;
  }

  async #loadStateFile(filename) {
    this.state = JSON.parse(await fs.readFile(filename, 'utf8'));
    this.#normalize({ requireEnvelope: true });
    const report = this.integrityReport();
    if (!report.ok) {
      throw Object.assign(new Error(`Stockage incohérent : ${report.issues.slice(0, 5).join(', ')}.`), { code: 'INVALID_SCHEMA' });
    }
  }

  #normalize({ requireEnvelope = false } = {}) {
    const rawVersion = Number(this.state?.schemaVersion);
    if (!Number.isInteger(rawVersion) || rawVersion < 1) {
      throw Object.assign(new Error('Version de stockage invalide.'), { code: 'INVALID_SCHEMA' });
    }
    if (rawVersion > CURRENT_SCHEMA_VERSION) {
      throw Object.assign(new Error(`Stockage créé par une version plus récente (${rawVersion} > ${CURRENT_SCHEMA_VERSION}). Mise à jour requise.`), { code: 'UNSUPPORTED_SCHEMA' });
    }
    if (requireEnvelope) {
      const required = ['settings', 'members', 'memberTokens', 'attendance', 'scheduleExceptions', 'auditLog'];
      if (rawVersion >= 2) required.push('sessions');
      const missing = required.filter((key) => !Object.hasOwn(this.state || {}, key));
      if (missing.length) throw Object.assign(new Error(`Stockage incomplet : ${missing.join(', ')}.`), { code: 'INVALID_SCHEMA' });
      const obj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
      const bad = [];
      if (!obj(this.state.settings)) bad.push('settings');
      if (!Array.isArray(this.state.members)) bad.push('members');
      if (!Array.isArray(this.state.memberTokens)) bad.push('memberTokens');
      if (rawVersion >= 2 && !Array.isArray(this.state.sessions)) bad.push('sessions');
      if (!obj(this.state.attendance)) bad.push('attendance');
      if (!obj(this.state.scheduleExceptions)) bad.push('scheduleExceptions');
      if (!Array.isArray(this.state.auditLog)) bad.push('auditLog');
      if (bad.length) throw Object.assign(new Error(`Types de stockage invalides : ${bad.join(', ')}.`), { code: 'INVALID_SCHEMA' });
    }
    this.state = Object.assign(defaultState(), this.state || {});
    this.state.schemaVersion = CURRENT_SCHEMA_VERSION;
    this.state.settings = Object.assign({ minRequired: 1 }, this.state.settings || {});
    this.state.members ||= [];
    this.state.memberTokens ||= [];
    this.state.sessions ||= [];
    this.state.attendance ||= {};
    this.state.roleAssignments ||= {};
    if (!this.state.roleAssignments || typeof this.state.roleAssignments !== 'object' || Array.isArray(this.state.roleAssignments)) {
      throw Object.assign(new Error('Types de stockage invalides : roleAssignments.'), { code: 'INVALID_SCHEMA' });
    }
    this.state.scheduleExceptions ||= {};
    this.state.auditLog ||= [];
  }

  async #cleanupStaleTemps() {
    const dir = path.dirname(this.filePath);
    const prefixes = [`${path.basename(this.filePath)}.tmp-`, `${path.basename(this.filePath)}.bak.tmp-`, `${path.basename(this.filePath)}.good.tmp-`];
    let names = [];
    try { names = await fs.readdir(dir); } catch { return; }
    const cutoff = Date.now() - 60 * 60 * 1000;
    await Promise.all(names.filter((name) => prefixes.some((prefix) => name.startsWith(prefix))).map(async (name) => {
      const full = path.join(dir, name);
      try { const st = await fs.stat(full); if (st.mtimeMs < cutoff) await fs.rm(full, { force: true }); } catch {}
    }));
  }

  async #writeDurable(filename, text) {
    const fh = await fs.open(filename, 'w', 0o600);
    try {
      await fh.writeFile(text, 'utf8');
      // Le mode de démonstration Windows peut désactiver fsync : certaines protections
      // Windows/antivirus refusent cette opération même lorsque l'écriture elle-même est valide.
      if (!RELAXED_FSYNC) await fh.sync();
    } finally { await fh.close(); }
  }

  async #syncParentDir() {
    if (RELAXED_FSYNC) return;
    try {
      const dirHandle = await fs.open(path.dirname(this.filePath), 'r');
      try { await dirHandle.sync(); } finally { await dirHandle.close(); }
    } catch (err) {
      // Certains systèmes de fichiers ne permettent pas fsync() sur un répertoire.
      if (!['EINVAL', 'ENOTSUP', 'EBADF', 'EPERM'].includes(err?.code)) throw err;
    }
  }

  async #persist({ preserveCurrent = true } = {}) {
    const text = JSON.stringify(this.state, null, 2);
    const tmp = `${this.filePath}.tmp-${process.pid}-${Date.now()}-${randomToken(4)}`;
    await this.#writeDurable(tmp, text);
    if (preserveCurrent) {
      try {
        const current = await fs.readFile(this.filePath, 'utf8');
        const backupTmp = `${this.filePath}.bak.tmp-${process.pid}-${Date.now()}-${randomToken(4)}`;
        await this.#writeDurable(backupTmp, current);
        await fs.rename(backupTmp, `${this.filePath}.bak`);
        await this.#syncParentDir();
      } catch (err) {
        if (err?.code !== 'ENOENT') { try { await fs.rm(tmp, { force: true }); } catch {} throw err; }
      }
    }
    await fs.rename(tmp, this.filePath);
    await this.#syncParentDir();
    // Dernier état intégralement écrit : utile si le fichier principal est ensuite endommagé.
    // Cette copie est auxiliaire : son échec ne doit pas transformer une écriture principale déjà validée en erreur ambiguë côté utilisateur.
    const goodTmp = `${this.filePath}.good.tmp-${process.pid}-${Date.now()}-${randomToken(4)}`;
    try {
      await this.#writeDurable(goodTmp, text);
      await fs.rename(goodTmp, `${this.filePath}.good`);
      await this.#syncParentDir();
    } catch (err) {
      try { await fs.rm(goodTmp, { force: true }); } catch {}
      console.warn(`Impossible de mettre à jour le snapshot .good : ${err?.message || err}`);
    }
  }

  async mutate(fn) {
    const task = this.queue.then(async () => {
      const previous = this.state;
      const draft = clone(previous);
      const result = await fn(draft);
      // Une validation refusée ne doit ni toucher au disque ni altérer l'état en mémoire.
      if (result && result.ok === false) return result;
      this.state = draft;
      try {
        await this.#persist();
        return result;
      } catch (err) {
        // Si la persistance échoue avant validation, le serveur revient à l'état précédemment confirmé.
        this.state = previous;
        throw err;
      }
    });
    this.queue = task.catch(() => {});
    return task;
  }

  #sessionAlive(rec) {
    return !!rec?.active && new Date(rec.expiresAt).getTime() > this.now().getTime();
  }

  #findSession(rawToken, kind, credentialTag = null) {
    const hash = tokenHash(rawToken);
    if (!rawToken || !hash) return null;
    return this.state.sessions.find((s) => s.kind === kind && s.tokenHash === hash && this.#sessionAlive(s) && (credentialTag == null || s.credentialTag === credentialTag)) || null;
  }

  findMemberByRawToken(rawToken) {
    const hash = tokenHash(rawToken);
    const rec = this.state.memberTokens.find((t) => t.active && t.tokenHash === hash);
    if (!rec) return null;
    const m = this.state.members.find((x) => x.id === rec.memberId && x.active);
    return m || null;
  }

  findMemberBySessionRawToken(rawToken) {
    const session = this.#findSession(rawToken, 'member');
    if (!session) return null;
    return this.state.members.find((m) => m.id === session.memberId && m.active) || null;
  }

  adminSessionOk(rawToken, credentialTag = null) {
    return !!this.#findSession(rawToken, 'admin', credentialTag);
  }

  async createMemberSession(memberId, ttlSeconds = 60 * 60 * 24 * 90) {
    const raw = randomToken();
    const now = this.now();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();
    return this.mutate((s) => {
      const member = s.members.find((m) => m.id === memberId && m.active);
      if (!member) return { ok: false, status: 401, error: 'Membre inactif ou introuvable.' };
      this.#cleanupSessions(s);
      const activeForMember = s.sessions.filter((rec) => rec.kind === 'member' && rec.memberId === memberId && rec.active && this.#sessionAlive(rec))
        .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
      while (activeForMember.length >= 5) {
        const oldest = activeForMember.shift();
        oldest.active = false; oldest.revokedAt = now.toISOString();
      }
      s.sessions.push({
        id: `s_${randomToken(10)}`, kind: 'member', memberId,
        tokenHash: tokenHash(raw), active: true,
        createdAt: now.toISOString(), expiresAt, revokedAt: null
      });
      return { ok: true, rawToken: raw, expiresAt };
    });
  }

  async createAdminSession(ttlSeconds = 60 * 60 * 8, credentialTag = null) {
    const raw = randomToken();
    const now = this.now();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();
    return this.mutate((s) => {
      this.#cleanupSessions(s);
      s.sessions.push({
        id: `s_${randomToken(10)}`, kind: 'admin', memberId: null, credentialTag: credentialTag ? String(credentialTag).slice(0, 128) : null,
        tokenHash: tokenHash(raw), active: true,
        createdAt: now.toISOString(), expiresAt, revokedAt: null
      });
      return { ok: true, rawToken: raw, expiresAt };
    });
  }

  async revokeSessionRaw(rawToken) {
    const hash = tokenHash(rawToken);
    return this.mutate((s) => {
      let changed = false;
      for (const rec of s.sessions) {
        if (rec.active && rec.tokenHash === hash) {
          rec.active = false;
          rec.revokedAt = this.now().toISOString();
          changed = true;
        }
      }
      return { ok: true, changed };
    });
  }


  async revokeOtherAdminSessions(currentRawToken) {
    const keepHash = tokenHash(currentRawToken || '');
    return this.mutate((s) => {
      let revoked = 0;
      const nowIso = this.now().toISOString();
      for (const rec of s.sessions) {
        if (rec.kind === 'admin' && rec.active && rec.tokenHash !== keepHash) {
          rec.active = false; rec.revokedAt = nowIso; revoked += 1;
        }
      }
      if (revoked) this.#log(s, 'Administrateur', 'sessions_admin_revoquees', null, { count: revoked });
      return { ok: true, revoked };
    });
  }

  async drain() { await this.queue; }

  #confirmationToken(kind, payload) {
    return crypto.createHmac('sha256', this.confirmationSecret).update(`${kind}:${canonicalJson(payload)}`, 'utf8').digest('hex');
  }

  #memberInfo(s, id) {
    const m = s.members.find((x) => x.id === id);
    return { memberId: id, name: m?.displayName || 'Membre inconnu' };
  }

  #logAttendanceRemovals(s, affected, reason) {
    for (const item of affected) {
      for (const id of item.ids || []) {
        const info = this.#memberInfo(s, id);
        this.#log(s, 'Administrateur', 'presence_retiree_fermeture', item.date, { ...info, reason, role: 'present' });
      }
      for (const [role, ids] of Object.entries(item.roles || {})) for (const id of ids) {
        const info = this.#memberInfo(s, id);
        this.#log(s, 'Administrateur', 'role_retire_fermeture', item.date, { ...info, reason, role });
      }
    }
  }
  #revokeMemberSessions(s, memberId) {
    for (const rec of s.sessions) {
      if (rec.kind === 'member' && rec.memberId === memberId && rec.active) {
        rec.active = false;
        rec.revokedAt = this.now().toISOString();
      }
    }
  }

  #cleanupSessions(s) {
    const t = this.now().getTime();
    const nowIso = this.now().toISOString();
    for (const rec of s.sessions) {
      if (rec.active && new Date(rec.expiresAt).getTime() <= t) {
        rec.active = false;
        rec.revokedAt = nowIso;
      }
    }
    const keepInactiveAfter = t - 7 * 24 * 60 * 60 * 1000;
    s.sessions = s.sessions.filter((rec) => {
      if (rec.active) return true;
      const stamp = new Date(rec.revokedAt || rec.expiresAt || rec.createdAt || 0).getTime();
      return Number.isFinite(stamp) && stamp >= keepInactiveAfter;
    });
    if (s.sessions.length > 4000) {
      const active = s.sessions.filter((x) => x.active);
      const inactive = s.sessions.filter((x) => !x.active).slice(-1000);
      s.sessions = [...inactive, ...active];
    }
  }

  #cleanupMemberTokens(s) {
    if (s.memberTokens.length <= 1500) return;
    const active = s.memberTokens.filter((x) => x.active);
    const inactive = s.memberTokens.filter((x) => !x.active)
      .sort((a, b) => String(a.revokedAt || a.createdAt || '').localeCompare(String(b.revokedAt || b.createdAt || '')));
    const room = Math.max(0, 1500 - active.length);
    const keptInactive = room > 0 ? inactive.slice(-room) : [];
    s.memberTokens = [...keptInactive, ...active];
  }

  async maintenance() {
    return this.mutate((s) => {
      const before = s.sessions.length;
      this.#cleanupSessions(s);
      return { ok: true, removedSessions: Math.max(0, before - s.sessions.length) };
    });
  }

  integrityReport() {
    const issues = [];
    if (Number(this.state?.schemaVersion) !== CURRENT_SCHEMA_VERSION) issues.push(`schema_version_invalid:${this.state?.schemaVersion}`);
    if (this.state.members.length > 500) issues.push(`members_limit_exceeded:${this.state.members.length}`);
    if (this.state.memberTokens.length > 1500) issues.push(`member_tokens_limit_exceeded:${this.state.memberTokens.length}`);
    if (this.state.sessions.length > 4000) issues.push(`sessions_limit_exceeded:${this.state.sessions.length}`);
    if (Object.keys(this.state.attendance || {}).length > 5000) issues.push(`attendance_dates_limit_exceeded:${Object.keys(this.state.attendance || {}).length}`);
    if (Object.keys(this.state.roleAssignments || {}).length > 5000) issues.push(`role_assignment_dates_limit_exceeded:${Object.keys(this.state.roleAssignments || {}).length}`);
    if (Object.keys(this.state.scheduleExceptions || {}).length > 5000) issues.push(`exceptions_limit_exceeded:${Object.keys(this.state.scheduleExceptions || {}).length}`);
    if (this.state.auditLog.length > 5000) issues.push(`audit_limit_exceeded:${this.state.auditLog.length}`);
    const memberIds = new Set();
    for (const m of this.state.members) {
      if (!m || typeof m.id !== 'string' || !m.id) issues.push('member_id_invalid');
      else if (memberIds.has(m.id)) issues.push(`member_duplicate:${m.id}`);
      else memberIds.add(m.id);
      if (!sanitizeName(m?.displayName)) issues.push(`member_name_invalid:${m?.id || '?'}`);
      if (typeof m?.active !== 'boolean') issues.push(`member_active_invalid:${m?.id || '?'}`);
      if (!safeIsoInstant(m?.createdAt)) issues.push(`member_created_at_invalid:${m?.id || '?'}`);
    }
    const tokenHashes = new Set();
    const activeTokenMembers = new Set();
    for (const t of this.state.memberTokens) {
      if (!memberIds.has(t?.memberId)) issues.push(`token_orphan:${t?.id || '?'}`);
      if (typeof t?.active !== 'boolean') issues.push(`token_active_invalid:${t?.id || '?'}`);
      if (t?.active) { if (activeTokenMembers.has(t.memberId)) issues.push(`multiple_active_tokens:${t.memberId}`); else activeTokenMembers.add(t.memberId); }
      if (!/^[a-f0-9]{64}$/i.test(String(t?.tokenHash || ''))) issues.push(`token_hash_invalid:${t?.id || '?'}`);
      else if (tokenHashes.has(t.tokenHash)) issues.push(`token_hash_duplicate:${t?.id || '?'}`);
      else tokenHashes.add(t.tokenHash);
      if (!safeIsoInstant(t?.createdAt)) issues.push(`token_created_at_invalid:${t?.id || '?'}`);
      if (t?.revokedAt && !safeIsoInstant(t.revokedAt)) issues.push(`token_revoked_at_invalid:${t?.id || '?'}`);
    }
    const sessionHashes = new Set();
    for (const rec of this.state.sessions) {
      if (!['member', 'admin'].includes(rec?.kind)) issues.push(`session_kind_invalid:${rec?.id || '?'}`);
      if (typeof rec?.active !== 'boolean') issues.push(`session_active_invalid:${rec?.id || '?'}`);
      if (!/^[a-f0-9]{64}$/i.test(String(rec?.tokenHash || ''))) issues.push(`session_hash_invalid:${rec?.id || '?'}`);
      else if (sessionHashes.has(rec.tokenHash)) issues.push(`session_hash_duplicate:${rec?.id || '?'}`);
      else sessionHashes.add(rec.tokenHash);
      if (rec?.kind === 'member' && !memberIds.has(rec?.memberId)) issues.push(`session_orphan:${rec?.id || '?'}`);
      if (rec?.kind === 'admin' && rec?.memberId != null) issues.push(`admin_session_member_invalid:${rec?.id || '?'}`);
      if (rec?.kind === 'admin' && rec?.credentialTag != null && (typeof rec.credentialTag !== 'string' || rec.credentialTag.length < 8 || rec.credentialTag.length > 128)) issues.push(`admin_session_credential_tag_invalid:${rec?.id || '?'}`);
      if (!safeIsoInstant(rec?.createdAt) || !safeIsoInstant(rec?.expiresAt)) issues.push(`session_time_invalid:${rec?.id || '?'}`);
      if (rec?.revokedAt && !safeIsoInstant(rec.revokedAt)) issues.push(`session_revoked_at_invalid:${rec?.id || '?'}`);
    }
    const today = parisToday(this.now());
    for (const [date, ids] of Object.entries(this.state.attendance || {})) {
      const validDate = isIsoDate(date);
      if (!validDate) issues.push(`attendance_date_invalid:${date}`);
      if (!Array.isArray(ids)) { issues.push(`attendance_list_invalid:${date}`); continue; }
      const seen = new Set();
      for (const id of ids) {
        if (!memberIds.has(id)) issues.push(`attendance_orphan:${date}:${id}`);
        if (seen.has(id)) issues.push(`attendance_duplicate:${date}:${id}`);
        seen.add(id);
      }
      if (validDate && date >= today && ids.length && !effectiveIsOpen(this.state, date)) issues.push(`future_attendance_on_closed_date:${date}`);
    }
    for (const [date, rawRoles] of Object.entries(this.state.roleAssignments || {})) {
      const validDate = isIsoDate(date);
      if (!validDate) issues.push(`role_assignment_date_invalid:${date}`);
      if (!rawRoles || typeof rawRoles !== 'object' || Array.isArray(rawRoles)) { issues.push(`role_assignment_invalid:${date}`); continue; }
      for (const key of Object.keys(rawRoles)) if (!ROLE_KEYS.includes(key)) issues.push(`role_assignment_role_invalid:${date}:${key}`);
      let any = false;
      for (const role of ROLE_KEYS) {
        const ids = rawRoles[role] ?? [];
        if (!Array.isArray(ids)) { issues.push(`role_assignment_list_invalid:${date}:${role}`); continue; }
        const seen = new Set();
        for (const id of ids) {
          any = true;
          if (!memberIds.has(id)) issues.push(`role_assignment_orphan:${date}:${role}:${id}`);
          if (seen.has(id)) issues.push(`role_assignment_duplicate:${date}:${role}:${id}`);
          seen.add(id);
        }
      }
      if (validDate && date >= today && any && !effectiveIsOpen(this.state, date)) issues.push(`future_role_assignment_on_closed_date:${date}`);
    }
    for (const [date, ex] of Object.entries(this.state.scheduleExceptions || {})) {
      if (!isIsoDate(date)) issues.push(`exception_date_invalid:${date}`);
      if (typeof ex?.isOpen !== 'boolean') issues.push(`exception_state_invalid:${date}`);
      if (String(ex?.note || '').length > 200) issues.push(`exception_note_too_long:${date}`);
    }
    const min = Number(this.state.settings?.minRequired);
    if (!Number.isInteger(min) || min < 1 || min > 20) issues.push('min_required_invalid');
    for (let i = 0; i < this.state.auditLog.length; i++) {
      const entry = this.state.auditLog[i];
      if (!safeIsoInstant(entry?.at)) issues.push(`audit_time_invalid:${i}`);
      if (!String(entry?.actor || '').trim()) issues.push(`audit_actor_invalid:${i}`);
      if (!String(entry?.action || '').trim()) issues.push(`audit_action_invalid:${i}`);
      if (entry?.date != null && !isIsoDate(entry.date)) issues.push(`audit_date_invalid:${i}`);
    }
    return {
      ok: issues.length === 0,
      issues: issues.slice(0, 50),
      counts: {
        members: this.state.members.length,
        activeMembers: this.state.members.filter((m) => m.active).length,
        attendanceDates: Object.keys(this.state.attendance || {}).length,
        roleAssignmentDates: Object.keys(this.state.roleAssignments || {}).length,
        exceptions: Object.keys(this.state.scheduleExceptions || {}).length,
        sessions: this.state.sessions.length,
        activeSessions: this.state.sessions.filter((s) => this.#sessionAlive(s)).length,
        auditEntries: this.state.auditLog.length
      }
    };
  }

  portableBackup() {
    const state = clone({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      settings: this.state.settings,
      members: this.state.members,
      memberTokens: this.state.memberTokens,
      attendance: this.state.attendance,
      roleAssignments: this.state.roleAssignments,
      scheduleExceptions: this.state.scheduleExceptions,
      auditLog: this.state.auditLog
    });
    return {
      format: 'club-presences-backup',
      formatVersion: BACKUP_FORMAT_VERSION,
      exportedAt: this.now().toISOString(),
      storeSchemaVersion: CURRENT_SCHEMA_VERSION,
      stateSha256: sha256Text(canonicalJson(state)),
      state
    };
  }

  #validatedBackupState(payload) {
    const formatVersion = Number(payload?.formatVersion);
    if (!payload || payload.format !== 'club-presences-backup' || ![1, BACKUP_FORMAT_VERSION].includes(formatVersion) || !payload.state || typeof payload.state !== 'object' || Array.isArray(payload.state)) {
      return { ok: false, status: 400, error: 'Fichier de sauvegarde non reconnu.' };
    }
    const src = payload.state;
    const srcSchema = Number(src.schemaVersion ?? payload.storeSchemaVersion ?? 1);
    if (!Number.isInteger(srcSchema) || srcSchema < 1) return { ok: false, status: 400, error: 'Version de données invalide dans la sauvegarde.' };
    if (srcSchema > CURRENT_SCHEMA_VERSION) return { ok: false, status: 409, error: 'Cette sauvegarde provient d’une version plus récente de l’application.' };
    if (formatVersion === BACKUP_FORMAT_VERSION) {
      const expected = String(payload.stateSha256 || '').toLowerCase();
      const actual = sha256Text(canonicalJson(src));
      if (!/^[a-f0-9]{64}$/.test(expected) || expected !== actual) return { ok: false, status: 400, error: 'La sauvegarde est incomplète ou a été modifiée (empreinte invalide).' };
    }
    const warnings = [];
    const exportedAt = safeIsoInstant(payload.exportedAt);
    if (!exportedAt) warnings.push('date_export_invalide');
    else {
      const ageMs = this.now().getTime() - new Date(exportedAt).getTime();
      if (ageMs < -10 * 60 * 1000) warnings.push('date_export_future');
      if (ageMs > 180 * 24 * 60 * 60 * 1000) warnings.push('sauvegarde_ancienne');
    }
    if (formatVersion === 1) warnings.push('ancien_format_v1');

    if (!Array.isArray(src.members) || src.members.length > 500) return { ok: false, status: 400, error: 'Liste des membres invalide.' };
    const members = [];
    const ids = new Set();
    for (const m of src.members) {
      const id = String(m?.id || ''); const displayName = sanitizeName(m?.displayName);
      if (typeof m?.active !== 'boolean') return { ok: false, status: 400, error: 'État actif/inactif invalide pour un membre.' };
      if (!id || id.length > 120 || ids.has(id) || !displayName) return { ok: false, status: 400, error: 'Membre invalide dans la sauvegarde.' };
      ids.add(id);
      members.push({ id, displayName, active: !!m.active, createdAt: safeIsoInstant(m?.createdAt) || this.now().toISOString() });
    }
    if (!Array.isArray(src.memberTokens) || src.memberTokens.length > 1500) return { ok: false, status: 400, error: 'Liens personnels invalides dans la sauvegarde.' };
    const memberTokens = []; const hashes = new Set(); const activeTokenMembers = new Set();
    for (const t of src.memberTokens) {
      const tokenHashValue = String(t?.tokenHash || '');
      if (typeof t?.active !== 'boolean') return { ok: false, status: 400, error: 'État actif/révoqué invalide pour un lien personnel.' };
      if (t.active) { if (activeTokenMembers.has(t.memberId)) return { ok: false, status: 400, error: 'Plusieurs liens personnels actifs existent pour le même membre.' }; activeTokenMembers.add(t.memberId); }
      if (!ids.has(t?.memberId) || !/^[a-f0-9]{64}$/i.test(tokenHashValue) || hashes.has(tokenHashValue)) return { ok: false, status: 400, error: 'Lien personnel invalide dans la sauvegarde.' };
      hashes.add(tokenHashValue);
      memberTokens.push({
        id: String(t.id || `t_${randomToken(10)}`).slice(0, 120), memberId: t.memberId, tokenHash: tokenHashValue.toLowerCase(), active: !!t.active,
        createdAt: safeIsoInstant(t?.createdAt) || this.now().toISOString(), revokedAt: t.revokedAt ? safeIsoInstant(t.revokedAt) : null
      });
      if (t.revokedAt && !memberTokens.at(-1).revokedAt) warnings.push('date_revocation_corrigee');
    }
    const attendance = {};
    if (!src.attendance || typeof src.attendance !== 'object' || Array.isArray(src.attendance) || Object.keys(src.attendance).length > 5000) return { ok: false, status: 400, error: 'Présences invalides dans la sauvegarde.' };
    for (const [date, rawIds] of Object.entries(src.attendance)) {
      if (!isIsoDate(date) || !Array.isArray(rawIds) || rawIds.length > 500) return { ok: false, status: 400, error: 'Présence invalide dans la sauvegarde.' };
      const unique = [...new Set(rawIds.map(String))];
      if (unique.some((id) => !ids.has(id))) return { ok: false, status: 400, error: 'Présence rattachée à un membre inconnu.' };
      if (unique.length) attendance[date] = unique;
    }
    const roleAssignments = {};
    const rawRoleAssignments = src.roleAssignments ?? {};
    if (!rawRoleAssignments || typeof rawRoleAssignments !== 'object' || Array.isArray(rawRoleAssignments) || Object.keys(rawRoleAssignments).length > 5000) return { ok: false, status: 400, error: 'Affectations de rôles invalides dans la sauvegarde.' };
    for (const [date, rawRoles] of Object.entries(rawRoleAssignments)) {
      if (!isIsoDate(date) || !rawRoles || typeof rawRoles !== 'object' || Array.isArray(rawRoles)) return { ok: false, status: 400, error: 'Affectation de rôle invalide dans la sauvegarde.' };
      const cleanRoles = {};
      for (const key of Object.keys(rawRoles)) if (!ROLE_KEYS.includes(key)) return { ok: false, status: 400, error: 'Rôle inconnu dans la sauvegarde.' };
      for (const role of ROLE_KEYS) {
        const rawIds = rawRoles[role] ?? [];
        if (!Array.isArray(rawIds) || rawIds.length > 500) return { ok: false, status: 400, error: 'Liste de rôle invalide dans la sauvegarde.' };
        const unique = [...new Set(rawIds.map(String))];
        if (unique.some((id) => !ids.has(id))) return { ok: false, status: 400, error: 'Rôle rattaché à un membre inconnu.' };
        if (unique.length) cleanRoles[role] = unique;
      }
      if (Object.keys(cleanRoles).length) roleAssignments[date] = cleanRoles;
    }
    const scheduleExceptions = {};
    if (!src.scheduleExceptions || typeof src.scheduleExceptions !== 'object' || Array.isArray(src.scheduleExceptions) || Object.keys(src.scheduleExceptions).length > 5000) return { ok: false, status: 400, error: 'Exceptions calendrier invalides.' };
    for (const [date, ex] of Object.entries(src.scheduleExceptions)) {
      if (!isIsoDate(date) || typeof ex?.isOpen !== 'boolean') return { ok: false, status: 400, error: 'Exception calendrier invalide.' };
      scheduleExceptions[date] = { isOpen: ex.isOpen, note: String(ex.note || '').slice(0, 200) };
    }
    const minRequired = Number(src.settings?.minRequired || 1);
    if (!Number.isInteger(minRequired) || minRequired < 1 || minRequired > 20) return { ok: false, status: 400, error: 'Réglage minimum invalide.' };
    const auditLog = Array.isArray(src.auditLog) ? src.auditLog.slice(-5000).map((x) => ({
      at: safeIsoInstant(x?.at) || this.now().toISOString(), actor: String(x?.actor || 'Inconnu').slice(0, 100), action: String(x?.action || 'import').slice(0, 100),
      date: x?.date && isIsoDate(x.date) ? x.date : null, metadata: sanitizeAuditMetadata(x?.metadata && typeof x.metadata === 'object' && !Array.isArray(x.metadata) ? x.metadata : {})
    })) : [];
    const nextState = { schemaVersion: CURRENT_SCHEMA_VERSION, settings: { minRequired }, members, memberTokens, sessions: [], attendance, roleAssignments, scheduleExceptions, auditLog };
    const probe = new FileStore(this.filePath, { now: this.now });
    probe.state = clone(nextState);
    const integrity = probe.integrityReport();
    if (!integrity.ok) {
      return { ok: false, status: 400, error: `Sauvegarde incohérente : ${integrity.issues.slice(0, 5).join(', ')}.` };
    }
    return { ok: true, warnings: [...new Set(warnings)], state: nextState };
  }

  validatePortableBackup(payload) {
    const valid = this.#validatedBackupState(payload);
    if (!valid.ok) return valid;
    return {
      ok: true,
      warnings: valid.warnings,
      summary: {
        formatVersion: Number(payload.formatVersion),
        exportedAt: safeIsoInstant(payload.exportedAt),
        members: valid.state.members.length,
        activeMembers: valid.state.members.filter((m) => m.active).length,
        attendanceDates: Object.keys(valid.state.attendance).length,
        roleAssignmentDates: Object.keys(valid.state.roleAssignments || {}).length,
        exceptions: Object.keys(valid.state.scheduleExceptions).length,
        auditEntries: valid.state.auditLog.length,
        minRequired: valid.state.settings.minRequired
      }
    };
  }

  async restorePortableBackup(payload, currentAdminSessionRaw) {
    const valid = this.#validatedBackupState(payload);
    if (!valid.ok) return valid;
    const currentHash = tokenHash(currentAdminSessionRaw || '');
    return this.mutate((s) => {
      const keepAdmin = s.sessions.find((rec) => rec.kind === 'admin' && rec.tokenHash === currentHash && this.#sessionAlive(rec));
      const next = clone(valid.state);
      next.sessions = keepAdmin ? [clone(keepAdmin)] : [];
      for (const key of Object.keys(s)) delete s[key];
      Object.assign(s, next);
      this.#log(s, 'Administrateur', 'sauvegarde_importee', null, { exportedAt: safeIsoInstant(payload.exportedAt) || '', formatVersion: Number(payload.formatVersion), warnings: valid.warnings });
      return { ok: true, warnings: valid.warnings };
    });
  }

  memberSnapshot(memberId) {
    const snap = publicSnapshot(this.state, memberId);
    const from = parisToday(this.now());
    const to = addIsoDays(from, MEMBER_HORIZON_DAYS);
    snap.attendance = Object.fromEntries(Object.entries(snap.attendance).filter(([date]) => date >= from && date <= to));
    snap.roleAssignments = Object.fromEntries(Object.entries(snap.roleAssignments || {}).filter(([date]) => date >= from && date <= to));
    snap.assignments = Object.fromEntries(Object.entries(snap.assignments || {}).filter(([date]) => date >= from && date <= to));
    snap.scheduleExceptions = Object.fromEntries(Object.entries(snap.scheduleExceptions).filter(([date]) => date >= from && date <= to));
    const visibleIds = new Set([memberId]);
    for (const day of Object.values(snap.assignments)) for (const ids of Object.values(day)) for (const id of ids) visibleIds.add(id);
    snap.members = snap.members.filter((m) => visibleIds.has(m.id));
    snap.settings.memberWindow = { from, to };
    return snap;
  }
  auditEntries(limit = 5000) {
    const n = Math.max(1, Math.min(5000, Number(limit) || 5000));
    return clone(this.state.auditLog.slice(-n).reverse());
  }
  adminSnapshot() {
    const base = publicSnapshot(this.state);
    base.members = this.state.members.map((m) => ({ id: m.id, name: m.displayName, active: !!m.active }));
    base.attendance = clone(this.state.attendance);
    base.roleAssignments = clone(this.state.roleAssignments || {});
    base.assignments = publicSnapshot(this.state).assignments;
    base.scheduleExceptions = clone(this.state.scheduleExceptions);
    return {
      ...base,
      membersAdmin: this.state.members.map((m) => ({
        id: m.id,
        name: m.displayName,
        active: !!m.active,
        createdAt: m.createdAt,
        hasActiveLink: this.state.memberTokens.some((t) => t.memberId === m.id && t.active)
      })),
      auditLog: this.state.auditLog.slice(-200).reverse(),
      integrity: this.integrityReport()
    };
  }

  async setRoleAssignment(memberId, date, role, present) {
    role = String(role || '').toLowerCase();
    if (!ALL_ROLE_KEYS.includes(role)) return { ok: false, status: 400, error: 'Rôle invalide.' };
    if (role === 'present') return this.setAttendance(memberId, date, present);
    return this.mutate((s) => {
      const member = s.members.find((m) => m.id === memberId && m.active);
      if (!member) return { ok: false, status: 401, error: 'Session invalide.' };
      const valid = validateMemberDateChange(s, date, this.now());
      if (!valid.ok) return valid;
      return this.#setRoleInState(s, member, date, role, present, member.displayName, present ? 'role_inscription' : 'role_retrait');
    });
  }

  async setRoleAssignmentAsAdmin(memberId, date, role, present) {
    role = String(role || '').toLowerCase();
    if (!ALL_ROLE_KEYS.includes(role)) return { ok: false, status: 400, error: 'Rôle invalide.' };
    if (role === 'present') return this.setAttendanceAsAdmin(memberId, date, present);
    if (!isIsoDate(date)) return { ok: false, status: 400, error: 'Date invalide.' };
    return this.mutate((s) => {
      const member = s.members.find((m) => m.id === memberId && m.active);
      if (!member) return { ok: false, status: 404, error: 'Membre actif introuvable.' };
      if (!effectiveIsOpen(s, date)) return { ok: false, status: 409, error: "Le club n'est pas ouvert ce jour-là." };
      return this.#setRoleInState(s, member, date, role, present, 'Administrateur', present ? 'admin_role_inscription' : 'admin_role_retrait');
    });
  }

  #setRoleInState(s, member, date, role, present, actor, action) {
    if (!Object.hasOwn(s.roleAssignments, date) && present && Object.keys(s.roleAssignments).length >= 5000) {
      return { ok: false, status: 409, error: 'Limite de dates de rôles atteinte. Archive ou nettoie les anciennes données.' };
    }
    const roles = s.roleAssignments[date] && typeof s.roleAssignments[date] === 'object' ? clone(s.roleAssignments[date]) : {};
    const set = new Set(Array.isArray(roles[role]) ? roles[role] : []);
    const had = set.has(member.id);
    if (present) set.add(member.id); else set.delete(member.id);
    if (set.size) roles[role] = [...set]; else delete roles[role];
    if (Object.keys(roles).length) s.roleAssignments[date] = roles; else delete s.roleAssignments[date];
    if (had !== !!present) this.#log(s, actor, action, date, { memberId: member.id, name: member.displayName, role });
    return { ok: true, changed: had !== !!present, present: !!present, role };
  }

  async setAttendance(memberId, date, present) {
    return this.mutate((s) => {
      const member = s.members.find((m) => m.id === memberId && m.active);
      if (!member) return { ok: false, status: 401, error: 'Session invalide.' };
      const valid = validateMemberDateChange(s, date, this.now());
      if (!valid.ok) return valid;
      return this.#setAttendanceInState(s, member, date, present, member.displayName, present ? 'inscription' : 'retrait');
    });
  }

  async setAttendanceAsAdmin(memberId, date, present) {
    if (!isIsoDate(date)) return { ok: false, status: 400, error: 'Date invalide.' };
    return this.mutate((s) => {
      const member = s.members.find((m) => m.id === memberId && m.active);
      if (!member) return { ok: false, status: 404, error: 'Membre actif introuvable.' };
      if (!effectiveIsOpen(s, date)) return { ok: false, status: 409, error: "Le club n'est pas ouvert ce jour-là." };
      return this.#setAttendanceInState(s, member, date, present, 'Administrateur', present ? 'admin_inscription' : 'admin_retrait');
    });
  }

  #setAttendanceInState(s, member, date, present, actor, action) {
    if (present && !Object.hasOwn(s.attendance, date) && Object.keys(s.attendance).length >= 5000) {
      return { ok: false, status: 409, error: 'Limite de dates de présence atteinte. Archive ou nettoie les anciennes données.' };
    }
    const set = new Set(Array.isArray(s.attendance[date]) ? s.attendance[date] : []);
    const had = set.has(member.id);
    if (present) set.add(member.id); else set.delete(member.id);
    if (set.size) s.attendance[date] = [...set]; else delete s.attendance[date];
    if (had !== !!present) this.#log(s, actor, action, date, { memberId: member.id, name: member.displayName });
    return { ok: true, changed: had !== !!present, present: !!present };
  }

  #futureAffected(s, dates, willBeOpen) {
    const today = parisToday(this.now());
    const affected = [];
    for (const date of dates) {
      if (date < today || willBeOpen(date)) continue;
      const ids = Array.isArray(s.attendance[date]) ? [...new Set(s.attendance[date].map(String))].sort() : [];
      const roles = {};
      const rawRoles = s.roleAssignments?.[date] || {};
      for (const role of ROLE_KEYS) {
        const roleIds = Array.isArray(rawRoles[role]) ? [...new Set(rawRoles[role].map(String))].sort() : [];
        if (roleIds.length) roles[role] = roleIds;
      }
      if (ids.length || Object.keys(roles).length) affected.push({ date, ids, roles });
    }
    return affected;
  }

  #confirmationConflict(kind, payload, affected, suppliedToken) {
    const attendanceCount = affected.reduce((n, x) => n + (x.ids?.length || 0) + Object.values(x.roles || {}).reduce((m, ids) => m + ids.length, 0), 0);
    if (!attendanceCount) return null;
    const confirmationToken = this.#confirmationToken(kind, { ...payload, affected: affected.map((x) => ({ date: x.date, ids: x.ids || [], roles: x.roles || {} })) });
    if (suppliedToken === confirmationToken) return null;
    return {
      ok: false, status: 409, requiresConfirmation: true,
      stateChanged: !!suppliedToken,
      attendanceCount,
      affectedDates: affected.map((x) => x.date),
      confirmationToken,
      error: suppliedToken
        ? 'Le planning a changé depuis la confirmation. Vérifie les inscriptions concernées puis confirme à nouveau.'
        : `${attendanceCount} inscription(s) future(s) seraient retirée(s). Confirmation requise.`
    };
  }

  #clearAffectedAttendance(s, affected, reason) {
    if (!affected.length) return 0;
    this.#logAttendanceRemovals(s, affected, reason);
    let removed = 0;
    for (const { date, ids = [], roles = {} } of affected) {
      const current = new Set(Array.isArray(s.attendance[date]) ? s.attendance[date] : []);
      for (const id of ids) if (current.delete(id)) removed += 1;
      if (current.size) s.attendance[date] = [...current]; else delete s.attendance[date];
      const dayRoles = s.roleAssignments?.[date] && typeof s.roleAssignments[date] === 'object' ? clone(s.roleAssignments[date]) : {};
      for (const [role, roleIds] of Object.entries(roles)) {
        const set = new Set(Array.isArray(dayRoles[role]) ? dayRoles[role] : []);
        for (const id of roleIds) if (set.delete(id)) removed += 1;
        if (set.size) dayRoles[role] = [...set]; else delete dayRoles[role];
      }
      if (Object.keys(dayRoles).length) s.roleAssignments[date] = dayRoles; else delete s.roleAssignments[date];
    }
    return removed;
  }

  async setException(date, isOpen, note = '', { confirmationToken = '' } = {}) {
    if (!isIsoDate(date)) return { ok: false, status: 400, error: 'Date invalide.' };
    const cleanNote = String(note || '').slice(0, 200);
    return this.mutate((s) => {
      if (!Object.hasOwn(s.scheduleExceptions, date) && Object.keys(s.scheduleExceptions).length >= 5000) {
        return { ok: false, status: 409, error: 'Limite d’exceptions calendrier atteinte.' };
      }
      const affected = this.#futureAffected(s, [date], () => !!isOpen);
      const conflict = this.#confirmationConflict('setException', { date, isOpen: !!isOpen, note: cleanNote }, affected, confirmationToken);
      if (conflict) return conflict;
      const attendanceRemoved = this.#clearAffectedAttendance(s, affected, 'fermeture_exceptionnelle');
      s.scheduleExceptions[date] = { isOpen: !!isOpen, note: cleanNote };
      this.#log(s, 'Administrateur', isOpen ? 'ouverture_exceptionnelle' : 'fermeture_exceptionnelle', date, { note: cleanNote, attendanceRemoved });
      return { ok: true, attendanceRemoved };
    });
  }

  async setExceptionsRange(from, to, isOpen, note = '', { confirmationToken = '' } = {}) {
    const dates = isoDateRange(from, to, 366);
    if (!dates) return { ok: false, status: 400, error: 'Période invalide ou trop longue.' };
    const cleanNote = String(note || '').slice(0, 200);
    return this.mutate((s) => {
      const newCount = dates.filter((date) => !Object.hasOwn(s.scheduleExceptions, date)).length;
      if (Object.keys(s.scheduleExceptions).length + newCount > 5000) return { ok: false, status: 409, error: 'Limite d’exceptions calendrier atteinte.' };
      const affected = this.#futureAffected(s, dates, () => !!isOpen);
      const conflict = this.#confirmationConflict('setExceptionsRange', { from, to, isOpen: !!isOpen, note: cleanNote }, affected, confirmationToken);
      if (conflict) return conflict;
      const attendanceRemoved = this.#clearAffectedAttendance(s, affected, 'fermeture_periode');
      for (const date of dates) s.scheduleExceptions[date] = { isOpen: !!isOpen, note: cleanNote };
      this.#log(s, 'Administrateur', isOpen ? 'ouverture_periode' : 'fermeture_periode', from, { to, note: cleanNote, count: dates.length, attendanceRemoved, attendanceDatesCleared: affected.length });
      return { ok: true, count: dates.length, attendanceRemoved, attendanceDatesCleared: affected.length };
    });
  }

  async removeExceptionsRange(from, to, { confirmationToken = '' } = {}) {
    const dates = isoDateRange(from, to, 366);
    if (!dates) return { ok: false, status: 400, error: 'Période invalide ou trop longue.' };
    return this.mutate((s) => {
      const closingDates = dates.filter((date) => Object.hasOwn(s.scheduleExceptions, date) && !defaultIsOpen(date));
      const affected = this.#futureAffected(s, closingDates, (date) => defaultIsOpen(date));
      const conflict = this.#confirmationConflict('removeExceptionsRange', { from, to }, affected, confirmationToken);
      if (conflict) return conflict;
      const attendanceRemoved = this.#clearAffectedAttendance(s, affected, 'retour_horaires_habituels');
      let changed = 0;
      for (const date of dates) {
        if (Object.hasOwn(s.scheduleExceptions, date)) { delete s.scheduleExceptions[date]; changed += 1; }
      }
      if (changed) this.#log(s, 'Administrateur', 'exceptions_periode_supprimees', from, { to, count: dates.length, changed, attendanceRemoved });
      return { ok: true, count: dates.length, changed, attendanceRemoved, attendanceDatesCleared: affected.length };
    });
  }

  async removeException(date, { confirmationToken = '' } = {}) {
    if (!isIsoDate(date)) return { ok: false, status: 400, error: 'Date invalide.' };
    return this.mutate((s) => {
      const existed = !!s.scheduleExceptions[date];
      const closing = existed && !defaultIsOpen(date);
      const affected = closing ? this.#futureAffected(s, [date], () => defaultIsOpen(date)) : [];
      const conflict = this.#confirmationConflict('removeException', { date }, affected, confirmationToken);
      if (conflict) return conflict;
      const attendanceRemoved = this.#clearAffectedAttendance(s, affected, 'suppression_exception');
      delete s.scheduleExceptions[date];
      if (existed) this.#log(s, 'Administrateur', 'exception_supprimee', date, { attendanceRemoved });
      return { ok: true, changed: existed, attendanceRemoved };
    });
  }

  async setMinRequired(value) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > 20) return { ok: false, status: 400, error: 'Minimum invalide.' };
    return this.mutate((s) => {
      const before = Number(s.settings.minRequired || 1);
      s.settings.minRequired = n;
      if (before !== n) this.#log(s, 'Administrateur', 'minimum_modifie', null, { before, after: n });
      return { ok: true };
    });
  }

  async createMember(name) {
    const clean = sanitizeName(name);
    if (!clean) return { ok: false, status: 400, error: 'Nom invalide.' };
    const raw = randomToken();
    const id = `m_${randomToken(12)}`;
    return this.mutate((s) => {
      if (s.members.length >= 500) return { ok: false, status: 409, error: 'Limite de membres atteinte.' };
      const member = { id, displayName: clean, active: true, createdAt: this.now().toISOString() };
      s.members.push(member);
      s.memberTokens.push({ id: `t_${randomToken(10)}`, memberId: id, tokenHash: tokenHash(raw), active: true, createdAt: this.now().toISOString(), revokedAt: null });
      this.#cleanupMemberTokens(s);
      this.#log(s, 'Administrateur', 'membre_cree', null, { memberId: id, name: clean });
      return { ok: true, member: { id, name: clean }, rawToken: raw };
    });
  }

  async renameMember(memberId, name) {
    const clean = sanitizeName(name);
    if (!clean) return { ok: false, status: 400, error: 'Nom invalide.' };
    return this.mutate((s) => {
      const m = s.members.find((x) => x.id === memberId);
      if (!m) return { ok: false, status: 404, error: 'Membre introuvable.' };
      const before = m.displayName; m.displayName = clean;
      if (before !== clean) this.#log(s, 'Administrateur', 'membre_renomme', null, { memberId, before, after: clean });
      return { ok: true };
    });
  }

  async setMemberActive(memberId, active) {
    const requested = !!active;
    const raw = requested ? randomToken() : null;
    return this.mutate((s) => {
      const m = s.members.find((x) => x.id === memberId);
      if (!m) return { ok: false, status: 404, error: 'Membre introuvable.' };
      const before = !!m.active;
      if (before === requested) return { ok: true, changed: false };
      m.active = requested;
      for (const t of s.memberTokens.filter((t) => t.memberId === memberId && t.active)) {
        t.active = false;
        t.revokedAt = this.now().toISOString();
      }
      this.#revokeMemberSessions(s, memberId);
      let futureAttendanceRemoved = 0;
      if (!requested) {
        const today = parisToday(this.now());
        for (const [date, ids] of Object.entries(s.attendance || {})) {
          if (date < today || !Array.isArray(ids) || !ids.includes(memberId)) continue;
          const nextIds = ids.filter((id) => id !== memberId);
          this.#log(s, 'Administrateur', 'presence_retiree_desactivation', date, { memberId, name: m.displayName });
          if (nextIds.length) s.attendance[date] = nextIds; else delete s.attendance[date];
          futureAttendanceRemoved += 1;
        }
        for (const [date, roles] of Object.entries(s.roleAssignments || {})) {
          if (date < today || !roles || typeof roles !== 'object') continue;
          let changedDay = false;
          for (const role of ROLE_KEYS) {
            const ids = Array.isArray(roles[role]) ? roles[role] : [];
            if (!ids.includes(memberId)) continue;
            const nextIds = ids.filter((id) => id !== memberId);
            this.#log(s, 'Administrateur', 'role_retire_desactivation', date, { memberId, name: m.displayName, role });
            if (nextIds.length) roles[role] = nextIds; else delete roles[role];
            futureAttendanceRemoved += 1; changedDay = true;
          }
          if (changedDay && !Object.keys(roles).length) delete s.roleAssignments[date];
        }
      }
      if (requested) {
        s.memberTokens.push({ id: `t_${randomToken(10)}`, memberId, tokenHash: tokenHash(raw), active: true, createdAt: this.now().toISOString(), revokedAt: null });
        this.#cleanupMemberTokens(s);
      }
      this.#log(s, 'Administrateur', requested ? 'membre_reactive' : 'membre_desactive', null, { memberId, name: m.displayName, futureAttendanceRemoved });
      return { ok: true, changed: true, member: { id: m.id, name: m.displayName }, rawToken: requested ? raw : undefined, futureAttendanceRemoved };
    });
  }

  async rotateToken(memberId) {
    const raw = randomToken();
    return this.mutate((s) => {
      const m = s.members.find((x) => x.id === memberId && x.active);
      if (!m) return { ok: false, status: 404, error: 'Membre actif introuvable.' };
      for (const t of s.memberTokens.filter((t) => t.memberId === memberId && t.active)) { t.active = false; t.revokedAt = this.now().toISOString(); }
      this.#revokeMemberSessions(s, memberId);
      s.memberTokens.push({ id: `t_${randomToken(10)}`, memberId, tokenHash: tokenHash(raw), active: true, createdAt: this.now().toISOString(), revokedAt: null });
      this.#cleanupMemberTokens(s);
      this.#log(s, 'Administrateur', 'lien_regenere', null, { memberId, name: m.displayName });
      return { ok: true, member: { id: m.id, name: m.displayName }, rawToken: raw };
    });
  }

  #log(s, actor, action, date, metadata) {
    s.auditLog.push({ at: this.now().toISOString(), actor: String(actor || 'Inconnu').slice(0, 100), action: String(action || 'action').slice(0, 100), date: date && isIsoDate(date) ? date : null, metadata: sanitizeAuditMetadata(metadata || {}) });
    if (s.auditLog.length > 5000) s.auditLog = s.auditLog.slice(-5000);
  }
}

// ===== server =====

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataFile = process.env.DATA_FILE || path.join(__dirname, 'data', 'store.json');
const port = Number(process.env.PORT || 3000);
const APP_VERSION = '0.14.0-complete';
const demoMode = process.env.DEMO_MODE === '1';
const listenHost = String(process.env.LISTEN_HOST || (demoMode ? '127.0.0.1' : '')).trim();
let demoRootHits = 0;
const trustProxy = ['1', 'true', 'yes'].includes(String(process.env.TRUST_PROXY || '').toLowerCase());
const adminToken = process.env.ADMIN_TOKEN || (demoMode ? 'demo-admin-V1' : '');
const configuredAdminHash = String(process.env.ADMIN_TOKEN_SHA256 || '').trim().toLowerCase();
if (configuredAdminHash && !/^[a-f0-9]{64}$/.test(configuredAdminHash)) {
  console.error('ADMIN_TOKEN_SHA256 doit être une empreinte SHA-256 hexadécimale de 64 caractères.');
  process.exit(2);
}
const adminTokenHash = configuredAdminHash || (adminToken ? tokenHash(adminToken) : '');
const adminCredentialTag = adminTokenHash ? tokenHash(`admin-credential-v1:${adminTokenHash}`).slice(0, 32) : '';
const now = process.env.NODE_ENV === 'test' && process.env.NOW_OVERRIDE ? () => new Date(process.env.NOW_OVERRIDE) : () => new Date();
const store = await new FileStore(dataFile, { now }).init(demoMode ? makeDemoSeed(now()) : null);

if (!adminTokenHash) {
  console.error('ADMIN_TOKEN ou ADMIN_TOKEN_SHA256 est obligatoire hors DEMO_MODE.');
  process.exit(2);
}
if (!demoMode && !configuredAdminHash && adminToken.length < 24) {
  console.error('ADMIN_TOKEN est trop court : utilisez au moins 24 caractères, ou de préférence ADMIN_TOKEN_SHA256 généré par npm run admin-token.');
  process.exit(2);
}

const rate = new Map();
function limited(key, max = 60, windowMs = 60_000) {
  const t = Date.now(); const row = rate.get(key) || { start: t, n: 0 };
  if (t - row.start > windowMs) { row.start = t; row.n = 0; }
  row.n += 1; rate.set(key, row); return row.n > max;
}
setInterval(() => { const t = Date.now(); for (const [k, v] of rate) if (t - v.start > 5 * 60_000) rate.delete(k); }, 5 * 60_000).unref();
setInterval(() => { store.maintenance().catch((err) => console.error('Maintenance stockage:', err)); }, 60 * 60_000).unref();

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self' ${INLINE_SCRIPT_HASH}; style-src 'self' ${INLINE_STYLE_HASH}; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`);
  res.setHeader('Cache-Control', 'no-store');
}

function json(res, status, body, extra = {}) {
  securityHeaders(res); res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8');
  for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}
function redirect(res, location, cookies = []) {
  securityHeaders(res); res.statusCode = 303; res.setHeader('Location', location); if (cookies.length) res.setHeader('Set-Cookie', cookies); res.end();
}
function getIp(req) { return clientIp(req, { trustProxy }); }
function serverAddIsoDays(iso, days) {
  const [y, m, d] = String(iso).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}
function csvCell(value) {
  let text = String(value ?? '');
  // Empêche qu'un nom/remarque soit interprété comme une formule par Excel/LibreOffice.
  if (/^[\t \r\n]*[=+\-@]/.test(text)) text = `'${text}`;
  return /[;"\n\r]/.test(text) ? `"${text.replaceAll('\"', '\"\"')}"` : text;
}
function planningCsv(snapshot, from, to) {
  const dates = isoDateRange(from, to, 366);
  if (!dates) return null;
  const names = Object.fromEntries((snapshot.members || []).map((m) => [m.id, m.name]));
  const min = Math.max(1, Number(snapshot.settings?.minRequired || 1));
  const rows = [['Date', 'Jour', 'Accueil', 'TPE', 'MEP', 'Arbitrage', 'Présent', 'Nombre présent', 'Minimum', 'Couverture', 'Remarque']];
  for (const date of dates) {
    if (!effectiveIsOpen(snapshot, date)) continue;
    const dayAssignments = snapshot.assignments?.[date] || {};
    const presentIds = Array.isArray(dayAssignments.present) ? dayAssignments.present : (Array.isArray(snapshot.attendance?.[date]) ? snapshot.attendance[date] : []);
    const label = (role) => (Array.isArray(dayAssignments[role]) ? dayAssignments[role] : []).map((id) => names[id]).filter(Boolean).join(', ');
    const present = presentIds.map((id) => names[id]).filter(Boolean);
    const [y, m, d] = date.split('-').map(Number);
    const day = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)));
    const note = snapshot.scheduleExceptions?.[date]?.note || '';
    rows.push([date, day, label('accueil'), label('tpe'), label('mep'), label('arbitrage'), present.join(', '), present.length, min, present.length >= min ? 'Assurée' : 'À pourvoir', note]);
  }
  return '\ufeff' + rows.map((row) => row.map(csvCell).join(';')).join('\r\n') + '\r\n';
}
function auditCsv(entries) {
  const rows = [['Horodatage', 'Acteur', 'Action', 'Date', 'Détails']];
  for (const entry of entries || []) {
    rows.push([entry.at || '', entry.actor || '', entry.action || '', entry.date || '', JSON.stringify(entry.metadata || {})]);
  }
  return '\ufeff' + rows.map((row) => row.map(csvCell).join(';')).join('\r\n') + '\r\n';
}
async function bodyJson(req, max = 16_384) {
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') throw Object.assign(new Error('Content-Type application/json requis.'), { status: 415 });
  let size = 0, text = '';
  for await (const chunk of req) { size += chunk.length; if (size > max) throw Object.assign(new Error('Corps trop volumineux.'), { status: 413 }); text += chunk; }
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Object.assign(new Error('Objet JSON requis.'), { status: 400 });
    return parsed;
  } catch (err) {
    if (err?.status) throw err;
    throw Object.assign(new Error('JSON invalide.'), { status: 400 });
  }
}
function sessionMember(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  const rawSession = cookies.club_session || '';
  return { cookies, rawSession, member: rawSession ? store.findMemberBySessionRawToken(rawSession) : null };
}
function adminOk(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  const rawSession = cookies.club_admin || '';
  return { cookies, rawSession, ok: rawSession ? store.adminSessionOk(rawSession, adminCredentialTag) : false };
}
function csrfCookie(name, secure, maxAge) { const token = randomToken(18); return { token, header: cookie(name, token, { httpOnly: false, secure, maxAge }) }; }

const indexHtml = await fs.readFile(path.join(__dirname, 'index.html'));
const indexText = indexHtml.toString('utf8');
function inlineHash(tag) {
  const lower = indexText.toLowerCase();
  const openStart = lower.indexOf(`<${tag}`);
  if (openStart < 0) return '';
  const contentStart = lower.indexOf('>', openStart) + 1;
  const contentEnd = lower.indexOf(`</${tag}>`, contentStart);
  if (!contentStart || contentEnd < 0) return '';
  const content = indexText.slice(contentStart, contentEnd);
  return `'sha256-${crypto.createHash('sha256').update(content, 'utf8').digest('base64')}'`;
}
const INLINE_STYLE_HASH = inlineHash('style');
const INLINE_SCRIPT_HASH = inlineHash('script');
function serveIndex(res) {
  securityHeaders(res); res.statusCode = 200; res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(indexHtml);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;
    if (pathname.startsWith('/api/') && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !browserMutationMetadataOk(req)) {
      return json(res, 403, { error: 'Requête intersite refusée.' });
    }
    const secure = requestIsHttps(req, { trustProxy });
    if (secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

    if (pathname === '/healthz' && req.method === 'GET') {
      const integrity = store.integrityReport();
      return json(res, 200, { ok: true, appVersion: APP_VERSION, storage: 'file', integrity: integrity.ok });
    }
    if (pathname === '/readyz' && req.method === 'GET') {
      const integrity = store.integrityReport();
      return json(res, integrity.ok ? 200 : 503, { ok: integrity.ok, appVersion: APP_VERSION, storage: 'file' });
    }
    if (pathname === '/api/demo/launch-state' && req.method === 'GET' && demoMode) return json(res, 200, { pageHits: demoRootHits });
    if (pathname === '/robots.txt' && req.method === 'GET') { securityHeaders(res); res.statusCode = 200; res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.end('User-agent: *\nDisallow: /\n'); return; }
    if (pathname === '/' && req.method === 'GET') {
      if (demoMode) demoRootHits += 1;
      return serveIndex(res);
    }
    if (['/calendar','/join','/admin-login','/admin','/invalid'].includes(pathname) && req.method === 'GET') return serveIndex(res);


    if (pathname === '/api/session/member' && req.method === 'POST') {
      if (limited(`member-login:${getIp(req)}`, 40)) return json(res, 429, { error: 'Trop de tentatives.' });
      if (!sameOriginRequestOk(req, { trustProxy })) return json(res, 403, { error: 'Origine de connexion invalide.' });
      const b = await bodyJson(req, 4096); const raw = String(b.token || '');
      const member = raw ? store.findMemberByRawToken(raw) : null;
      if (!member) return json(res, 401, { error: 'Lien personnel invalide ou révoqué.' });
      const session = await store.createMemberSession(member.id);
      if (!session.ok) return json(res, session.status, { error: session.error });
      const csrf = csrfCookie('club_member_csrf', secure, 60 * 60 * 24 * 90);
      return json(res, 200, { ok: true }, { 'Set-Cookie': [cookie('club_session', session.rawToken, { secure, maxAge: 60 * 60 * 24 * 90 }), csrf.header] });
    }
    if (pathname === '/api/session/admin' && req.method === 'POST') {
      if (limited(`admin-login:${getIp(req)}`, 20)) return json(res, 429, { error: 'Trop de tentatives.' });
      if (!sameOriginRequestOk(req, { trustProxy })) return json(res, 403, { error: 'Origine de connexion invalide.' });
      const b = await bodyJson(req, 4096); const raw = String(b.token || '');
      if (!timingSafeHexEqual(tokenHash(raw), adminTokenHash)) return json(res, 401, { error: 'Lien administrateur invalide.' });
      const session = await store.createAdminSession(60 * 60 * 8, adminCredentialTag);
      const csrf = csrfCookie('club_admin_csrf', secure, 60 * 60 * 8);
      return json(res, 200, { ok: true }, { 'Set-Cookie': [cookie('club_admin', session.rawToken, { secure, maxAge: 60 * 60 * 8 }), csrf.header] });
    }

    if (pathname === '/api/me' && req.method === 'GET') {
      const { member } = sessionMember(req); if (!member) return json(res, 401, { error: 'Lien personnel invalide ou expiré.' });
      return json(res, 200, store.memberSnapshot(member.id));
    }
    if (pathname === '/api/me/attendance' && (req.method === 'POST' || req.method === 'DELETE')) {
      const { member, cookies, rawSession } = sessionMember(req); if (!member) return json(res, 401, { error: 'Session invalide.' });
      if (!sameOriginCsrfOk(req, cookies, 'club_member_csrf')) return json(res, 403, { error: 'Protection de session invalide.' });
      if (limited(`member-write:${member.id}`, 30)) return json(res, 429, { error: 'Trop de modifications en peu de temps. Réessaie dans une minute.' });
      const body = req.method === 'POST' ? await bodyJson(req) : { date: url.searchParams.get('date') };
      const result = await store.setAttendance(member.id, body.date, req.method === 'POST');
      if (!result.ok) return json(res, result.status, { error: result.error });
      return json(res, 200, { ...result, snapshot: store.memberSnapshot(member.id) });
    }
    if (pathname === '/api/me/assignment' && req.method === 'POST') {
      const { member, cookies } = sessionMember(req); if (!member) return json(res, 401, { error: 'Session invalide.' });
      if (!sameOriginCsrfOk(req, cookies, 'club_member_csrf')) return json(res, 403, { error: 'Protection de session invalide.' });
      if (limited(`member-write:${member.id}`, 30)) return json(res, 429, { error: 'Trop de modifications en peu de temps. Réessaie dans une minute.' });
      const body = await bodyJson(req);
      const result = await store.setRoleAssignment(member.id, body.date, body.role, !!body.present);
      if (!result.ok) return json(res, result.status, { error: result.error });
      return json(res, 200, { ...result, snapshot: store.memberSnapshot(member.id) });
    }
    if (pathname === '/api/logout' && req.method === 'POST') {
      const m = sessionMember(req); if (!m.member) return json(res, 401, { error: 'Session invalide.' });
      if (!sameOriginCsrfOk(req, m.cookies, 'club_member_csrf')) return json(res, 403, { error: 'Protection de session invalide.' });
      await store.revokeSessionRaw(m.rawSession);
      return json(res, 200, { ok: true }, { 'Set-Cookie': [clearCookie('club_session', { secure }), clearCookie('club_member_csrf', { secure, httpOnly: false })] });
    }

    if (pathname === '/api/admin/logout' && req.method === 'POST') {
      const a = adminOk(req); if (!a.ok) return json(res, 401, { error: 'Accès administrateur requis.' });
      if (!sameOriginCsrfOk(req, a.cookies, 'club_admin_csrf')) return json(res, 403, { error: 'Protection de session invalide.' });
      await store.revokeSessionRaw(a.rawSession);
      return json(res, 200, { ok: true }, { 'Set-Cookie': [clearCookie('club_admin', { secure }), clearCookie('club_admin_csrf', { secure, httpOnly: false })] });
    }

    if (pathname === '/api/admin/sessions/revoke-others' && req.method === 'POST') {
      const a = adminOk(req); if (!a.ok) return json(res, 401, { error: 'Accès administrateur requis.' });
      if (!sameOriginCsrfOk(req, a.cookies, 'club_admin_csrf')) return json(res, 403, { error: 'Protection de session invalide.' });
      const r = await store.revokeOtherAdminSessions(a.rawSession);
      return json(res, 200, { ...r, snapshot: store.adminSnapshot() });
    }

    if (pathname === '/api/admin' && req.method === 'GET') {
      const a = adminOk(req); if (!a.ok) return json(res, 401, { error: 'Accès administrateur requis.' });
      return json(res, 200, store.adminSnapshot());
    }
    if (pathname === '/api/admin/backup' && req.method === 'GET') {
      const a = adminOk(req); if (!a.ok) return json(res, 401, { error: 'Accès administrateur requis.' });
      const integrity = store.integrityReport();
      if (!integrity.ok) return json(res, 409, { error: 'Sauvegarde restaurable refusée : le stockage est incohérent. Utilise l’export diagnostic et corrige d’abord les données.' });
      securityHeaders(res); res.statusCode = 200; res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="club-presences-backup-${now().toISOString().slice(0,10)}.json"`);
      res.end(JSON.stringify(store.portableBackup(), null, 2)); return;
    }
    if (pathname === '/api/admin/backup/validate' && req.method === 'POST') {
      const a = adminOk(req); if (!a.ok) return json(res, 401, { error: 'Accès administrateur requis.' });
      if (!sameOriginCsrfOk(req, a.cookies, 'club_admin_csrf')) return json(res, 403, { error: 'Protection de session invalide.' });
      const payload = await bodyJson(req, 10_000_000);
      const r = store.validatePortableBackup(payload);
      if (!r.ok) return json(res, r.status, { error: r.error });
      return json(res, 200, r);
    }
    if (pathname === '/api/admin/backup/restore' && req.method === 'POST') {
      const a = adminOk(req); if (!a.ok) return json(res, 401, { error: 'Accès administrateur requis.' });
      if (!sameOriginCsrfOk(req, a.cookies, 'club_admin_csrf')) return json(res, 403, { error: 'Protection de session invalide.' });
      if (limited(`admin-write:${tokenHash(a.rawSession).slice(0, 24)}`, 120)) return json(res, 429, { error: 'Trop de modifications en peu de temps.' });
      const payload = await bodyJson(req, 10_000_000);
      const r = await store.restorePortableBackup(payload, a.rawSession);
      if (!r.ok) return json(res, r.status, { error: r.error });
      return json(res, 200, { ...r, snapshot: store.adminSnapshot() });
    }
    if (pathname === '/api/admin/assignment' && req.method === 'POST') {
      const a = adminOk(req); if (!a.ok) return json(res, 401, { error: 'Session administrateur invalide.' });
      if (!sameOriginCsrfOk(req, a.cookies, 'club_admin_csrf')) return json(res, 403, { error: 'Protection de session invalide.' });
      if (limited(`admin-write:${getIp(req)}`, 120)) return json(res, 429, { error: 'Trop de modifications en peu de temps.' });
      const b = await bodyJson(req); const r = await store.setRoleAssignmentAsAdmin(String(b.memberId || ''), b.date, b.role, !!b.present);
      if (!r.ok) return json(res, r.status, { error: r.error });
      return json(res, 200, { ...r, snapshot: store.adminSnapshot() });
    }
    if (pathname === '/api/admin/attendance' && req.method === 'POST') {
      const a = adminOk(req); if (!a.ok) return json(res, 401, { error: 'Accès administrateur requis.' });
      if (!sameOriginCsrfOk(req, a.cookies, 'club_admin_csrf')) return json(res, 403, { error: 'Protection de session invalide.' });
      if (limited(`admin-write:${tokenHash(a.rawSession).slice(0, 24)}`, 120)) return json(res, 429, { error: 'Trop de modifications en peu de temps.' });
      const b = await bodyJson(req); const r = await store.setAttendanceAsAdmin(String(b.memberId || ''), b.date, !!b.present);
      if (!r.ok) return json(res, r.status, { error: r.error });
      return json(res, 200, { ...r, snapshot: store.adminSnapshot() });
    }
    if (pathname === '/api/admin/exceptions/bulk' && req.method === 'POST') {
      const a = adminOk(req); if (!a.ok) return json(res, 401, { error: 'Accès administrateur requis.' });
      if (!sameOriginCsrfOk(req, a.cookies, 'club_admin_csrf')) return json(res, 403, { error: 'Protection de session invalide.' });
      if (limited(`admin-write:${tokenHash(a.rawSession).slice(0, 24)}`, 120)) return json(res, 429, { error: 'Trop de modifications en peu de temps.' });
      const b = await bodyJson(req); const r = await store.setExceptionsRange(b.from, b.to, !!b.isOpen, b.note || '', { confirmationToken: String(b.confirmationToken || '') });
      if (!r.ok) return json(res, r.status, { ...r });
      return json(res, 200, { ...r, snapshot: store.adminSnapshot() });
    }
    if (pathname === '/api/admin/exceptions/reset-range' && req.method === 'POST') {
      const a = adminOk(req); if (!a.ok) return json(res, 401, { error: 'Accès administrateur requis.' });
      if (!sameOriginCsrfOk(req, a.cookies, 'club_admin_csrf')) return json(res, 403, { error: 'Protection de session invalide.' });
      if (limited(`admin-write:${tokenHash(a.rawSession).slice(0, 24)}`, 120)) return json(res, 429, { error: 'Trop de modifications en peu de temps.' });
      const b = await bodyJson(req); const r = await store.removeExceptionsRange(b.from, b.to, { confirmationToken: String(b.confirmationToken || '') });
      if (!r.ok) return json(res, r.status, { error: r.error });
      return json(res, 200, { ...r, snapshot: store.adminSnapshot() });
    }
    if (pathname === '/api/admin/exception' && req.method === 'POST') {
      const a = adminOk(req); if (!a.ok) return json(res, 401, { error: 'Accès administrateur requis.' });
      if (!sameOriginCsrfOk(req, a.cookies, 'club_admin_csrf')) return json(res, 403, { error: 'Protection de session invalide.' });
      if (limited(`admin-write:${tokenHash(a.rawSession).slice(0, 24)}`, 120)) return json(res, 429, { error: 'Trop de modifications en peu de temps.' });
      const b = await bodyJson(req); const r = await store.setException(b.date, !!b.isOpen, b.note || '', { confirmationToken: String(b.confirmationToken || '') });
      if (!r.ok) return json(res, r.status, { ...r }); return json(res, 200, { ...r, snapshot: store.adminSnapshot() });
    }
    if (pathname === '/api/admin/exception' && req.method === 'DELETE') {
      const a = adminOk(req); if (!a.ok) return json(res, 401, { error: 'Accès administrateur requis.' });
      if (!sameOriginCsrfOk(req, a.cookies, 'club_admin_csrf')) return json(res, 403, { error: 'Protection de session invalide.' });
      if (limited(`admin-write:${tokenHash(a.rawSession).slice(0, 24)}`, 120)) return json(res, 429, { error: 'Trop de modifications en peu de temps.' });
      const b = await bodyJson(req, 4096);
      const r = await store.removeException(url.searchParams.get('date'), { confirmationToken: String(b.confirmationToken || '') });
      if (!r.ok) return json(res, r.status, { error: r.error }); return json(res, 200, { ...r, snapshot: store.adminSnapshot() });
    }
    if (pathname === '/api/admin/settings' && req.method === 'POST') {
      const a = adminOk(req); if (!a.ok) return json(res, 401, { error: 'Accès administrateur requis.' });
      if (!sameOriginCsrfOk(req, a.cookies, 'club_admin_csrf')) return json(res, 403, { error: 'Protection de session invalide.' });
      if (limited(`admin-write:${tokenHash(a.rawSession).slice(0, 24)}`, 120)) return json(res, 429, { error: 'Trop de modifications en peu de temps.' });
      const b = await bodyJson(req); const r = await store.setMinRequired(b.minRequired);
      if (!r.ok) return json(res, r.status, { error: r.error }); return json(res, 200, { ...r, snapshot: store.adminSnapshot() });
    }
    if (pathname === '/api/admin/members' && req.method === 'POST') {
      const a = adminOk(req); if (!a.ok) return json(res, 401, { error: 'Accès administrateur requis.' });
      if (!sameOriginCsrfOk(req, a.cookies, 'club_admin_csrf')) return json(res, 403, { error: 'Protection de session invalide.' });
      if (limited(`admin-write:${tokenHash(a.rawSession).slice(0, 24)}`, 120)) return json(res, 429, { error: 'Trop de modifications en peu de temps.' });
      const b = await bodyJson(req); const r = await store.createMember(b.name);
      if (!r.ok) return json(res, r.status, { error: r.error }); return json(res, 201, { ...r, personalPath: `/join#${r.rawToken}`, snapshot: store.adminSnapshot() });
    }
    const memberMatch = pathname.match(/^\/api\/admin\/members\/([^/]+)(?:\/(rotate))?$/);
    if (memberMatch && req.method === 'POST') {
      const a = adminOk(req); if (!a.ok) return json(res, 401, { error: 'Accès administrateur requis.' });
      if (!sameOriginCsrfOk(req, a.cookies, 'club_admin_csrf')) return json(res, 403, { error: 'Protection de session invalide.' });
      if (limited(`admin-write:${tokenHash(a.rawSession).slice(0, 24)}`, 120)) return json(res, 429, { error: 'Trop de modifications en peu de temps.' });
      const memberId = decodeURIComponent(memberMatch[1]);
      if (memberMatch[2] === 'rotate') {
        const r = await store.rotateToken(memberId); if (!r.ok) return json(res, r.status, { error: r.error });
        return json(res, 200, { ...r, personalPath: `/join#${r.rawToken}`, snapshot: store.adminSnapshot() });
      }
      const b = await bodyJson(req); let r;
      if (Object.hasOwn(b, 'name')) r = await store.renameMember(memberId, b.name);
      else if (Object.hasOwn(b, 'active')) r = await store.setMemberActive(memberId, !!b.active);
      else return json(res, 400, { error: 'Modification inconnue.' });
      if (!r.ok) return json(res, r.status, { error: r.error });
      return json(res, 200, { ...r, ...(r.rawToken ? { personalPath: `/join#${r.rawToken}` } : {}), snapshot: store.adminSnapshot() });
    }
    if (pathname === '/api/admin/audit.csv' && req.method === 'GET') {
      const a = adminOk(req); if (!a.ok) return json(res, 401, { error: 'Accès administrateur requis.' });
      const csv = auditCsv(store.auditEntries());
      securityHeaders(res); res.statusCode = 200; res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="historique-presences-${now().toISOString().slice(0,10)}.csv"`);
      res.end(csv); return;
    }
    if (pathname === '/api/admin/planning.csv' && req.method === 'GET') {
      const a = adminOk(req); if (!a.ok) return json(res, 401, { error: 'Accès administrateur requis.' });
      const from = url.searchParams.get('from') || parisToday(now());
      const to = url.searchParams.get('to') || serverAddIsoDays(from, 365);
      const csv = planningCsv(store.adminSnapshot(), from, to);
      if (csv == null) return json(res, 400, { error: 'Période CSV invalide ou supérieure à 366 jours.' });
      securityHeaders(res); res.statusCode = 200; res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="planning-presences-${from}-${to}.csv"`);
      res.end(csv); return;
    }
    if (pathname === '/api/admin/export' && req.method === 'GET') {
      const a = adminOk(req); if (!a.ok) return json(res, 401, { error: 'Accès administrateur requis.' });
      securityHeaders(res); res.statusCode = 200; res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="club-presences-export-${now().toISOString().slice(0,10)}.json"`); res.end(JSON.stringify(store.adminSnapshot(), null, 2)); return;
    }

    return json(res, 404, { error: 'Introuvable.' });
  } catch (err) {
    console.error(err); return json(res, err?.status || 500, { error: err?.status ? err.message : 'Erreur serveur.' });
  }
});

// Bornes défensives adaptées à une petite application interactive exposée sur Internet.
server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 5_000;
server.maxHeadersCount = 100;

if (isMainModule(import.meta.url)) {
  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal}: arrêt propre en cours…`);
    const hardStop = setTimeout(() => { console.error('Arrêt forcé après délai.'); process.exit(1); }, 10_000);
    hardStop.unref();
    server.close(async () => {
      try { await store.drain(); clearTimeout(hardStop); process.exit(0); }
      catch (err) { console.error('Erreur pendant l’arrêt propre:', err); process.exit(1); }
    });
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
  const onListening = () => {
    const displayHost = listenHost || 'localhost';
    console.log(`Présences du club v${APP_VERSION}: http://${displayHost}:${port}`);
    if (demoMode) console.log(`Admin démo: http://${displayHost}:${port}/admin-login#${adminToken}`);
  };
  if (listenHost) server.listen(port, listenHost, onListening);
  else server.listen(port, onListening);
}
