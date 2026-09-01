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

const MEMBER_SESSION_TTL_SECONDS = 60 * 60 * 24 * 365;

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


function cleanHeaderToken(value, max = 80) {
  return String(value || '').replace(/^"|"$/g, '').replace(/[\r\n]/g, ' ').trim().slice(0, max);
}

function clientDeviceInfo(req) {
  const ua = cleanHeaderToken(req.headers['user-agent'], 512);
  const lower = ua.toLowerCase();
  const platformHint = cleanHeaderToken(req.headers['sec-ch-ua-platform'], 40);
  const mobileHint = cleanHeaderToken(req.headers['sec-ch-ua-mobile'], 8);

  let type = 'Ordinateur';
  if (mobileHint === '?1' || /iphone|ipod|android.+mobile|windows phone/.test(lower)) type = 'Mobile';
  else if (/ipad|tablet|android/.test(lower)) type = 'Tablette';

  let os = platformHint;
  if (!os) {
    if (/windows nt/.test(lower)) os = 'Windows';
    else if (/iphone|ipod/.test(lower)) os = 'iOS';
    else if (/ipad/.test(lower)) os = 'iPadOS';
    else if (/android/.test(lower)) os = 'Android';
    else if (/macintosh|mac os x/.test(lower)) os = 'macOS';
    else if (/cros/.test(lower)) os = 'ChromeOS';
    else if (/linux/.test(lower)) os = 'Linux';
    else os = 'Système inconnu';
  }

  let browser = 'Navigateur inconnu';
  if (/\bedg\//.test(lower)) browser = 'Edge';
  else if (/\bopr\//.test(lower) || /\bopera\//.test(lower)) browser = 'Opera';
  else if (/\bfirefox\//.test(lower) || /\bfxios\//.test(lower)) browser = 'Firefox';
  else if (/\bcrios\//.test(lower) || (/\bchrome\//.test(lower) && !/\bedg\//.test(lower))) browser = 'Chrome';
  else if (/\bsafari\//.test(lower) && /\bversion\//.test(lower)) browser = 'Safari';

  const label = [type, browser, os].filter(Boolean).join(' · ').slice(0, 160);
  return { type, browser, os, label };
}

function sanitizeSessionDevice(info) {
  if (!info || typeof info !== 'object') return null;
  const type = cleanHeaderToken(info.type, 30) || 'Appareil';
  const browser = cleanHeaderToken(info.browser, 40) || 'Navigateur inconnu';
  const os = cleanHeaderToken(info.os, 40) || 'Système inconnu';
  const label = cleanHeaderToken(info.label, 160) || [type, browser, os].join(' · ');
  return { type, browser, os, label };
}


// ===== src/domain.mjs =====
const OPEN_WEEKDAYS = new Set([1, 2, 4]); // lundi, mardi, jeudi (UTC weekday)
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const PLANNING_HORIZON_MONTHS = 3;

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

function planningWindowEnd(todayIso) {
  if (!isIsoDate(todayIso)) return null;
  const [y, m] = todayIso.split('-').map(Number);
  const zeroBased = (m - 1) + (PLANNING_HORIZON_MONTHS - 1);
  const endYear = y + Math.floor(zeroBased / 12);
  const endMonth = (zeroBased % 12) + 1;
  const lastDay = new Date(Date.UTC(endYear, endMonth, 0)).getUTCDate();
  return `${endYear}-${String(endMonth).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;
}

function validatePlanningHorizonDate(iso, now = new Date()) {
  if (!isIsoDate(iso)) return { ok: false, status: 400, error: 'Date invalide.' };
  const maxDate = planningWindowEnd(parisToday(now));
  if (iso > maxDate) {
    return {
      ok: false,
      status: 409,
      error: 'Le planning est limité au mois en cours et aux deux mois suivants.'
    };
  }
  return { ok: true };
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
  const horizon = validatePlanningHorizonDate(iso, now);
  if (!horizon.ok) return horizon;
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

function sanitizeEmail(email) {
  const clean = String(email || '').trim().toLowerCase();
  if (!clean || clean.length > 254 || /[\r\n\t\s]/.test(clean)) return null;
  if (!/^[^@]+@[^@]+\.[^@]+$/u.test(clean)) return null;
  return clean;
}

const CURRENT_ROSTER_VERSION = 'managed-v2';
const LEGACY_ROSTER_VERSIONS = new Set(['2026-08-31-v1','managed-v2']);
const CURRENT_LINK_STORAGE_VERSION = '2026-08-31-recoverable-v1';
// Le roster réel vit uniquement dans le stockage privé. Aucun nom/email réel n'est embarqué dans le code public.
const CURRENT_ROSTER = [];
const DEMO_ROSTER = Array.from({ length: 10 }, (_, i) => ({
  id: `demo_roster_${String(i + 1).padStart(2, '0')}`,
  displayName: `Membre démo ${i + 1}`,
  email: `membre${i + 1}@example.invalid`
}));

function applyCurrentRoster(state, nowIso = new Date().toISOString()) {
  const previousVersion = String(state?.rosterVersion || '');
  state.members = Array.isArray(state?.members) ? state.members : [];
  state.memberTokens = Array.isArray(state?.memberTokens) ? state.memberTokens : [];
  state.sessions = Array.isArray(state?.sessions) ? state.sessions : [];
  state.attendance = state?.attendance && typeof state.attendance === 'object' ? state.attendance : {};
  state.roleAssignments = state?.roleAssignments && typeof state.roleAssignments === 'object' ? state.roleAssignments : {};
  state.auditLog = Array.isArray(state?.auditLog) ? state.auditLog : [];
  state.rosterVersion = CURRENT_ROSTER_VERSION;
  state.linkStorageVersion ||= CURRENT_LINK_STORAGE_VERSION;
  state.auditLog.push({
    at: nowIso,
    actor: 'Système',
    action: 'roster_migration_non_destructive',
    date: null,
    metadata: {
      previousVersion,
      rosterVersion: CURRENT_ROSTER_VERSION,
      membersPreserved: state.members.length,
      linksPreserved: state.memberTokens.length,
      sessionsPreserved: state.sessions.length,
      attendanceDatesPreserved: Object.keys(state.attendance).length,
      roleDatesPreserved: Object.keys(state.roleAssignments).length
    }
  });
  if (state.auditLog.length > 5000) state.auditLog = state.auditLog.slice(-5000);
  return true;
}

function shortPersonalName(name) {
  const clean = sanitizeName(name) || 'Membre';
  const first = clean.split(/\s+/)[0].normalize('NFC');
  const safe = first.replace(/[^\p{L}\p{N}]/gu, '');
  return (safe || 'Membre').slice(0, 40);
}

function makeShortPersonalToken(name) {
  const digits = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  return `${shortPersonalName(name)}${digits}`;
}

function shortPersonalTokenHash(raw, pepper = memberShortPepper) {
  return crypto.createHmac('sha256', pepper)
    .update(`member-short-v1:${String(raw || '').normalize('NFC')}`, 'utf8')
    .digest('hex');
}

function shortPersonalTokenHashCandidates(raw) {
  const primary = shortPersonalTokenHash(raw, memberShortPepper);
  const legacy = shortPersonalTokenHash(raw, legacyMemberShortPepper);
  return primary === legacy ? [primary] : [primary, legacy];
}

function memberLinkCipherKey() {
  return crypto.createHash('sha256')
    .update(Buffer.concat([Buffer.from('member-link-display-v1:', 'utf8'), Buffer.from(memberShortPepper)]))
    .digest();
}

function encryptMemberShortToken(raw) {
  const clean = String(raw || '').normalize('NFC');
  if (!clean) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', memberLinkCipherKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(clean, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
}

function decryptMemberShortToken(encoded) {
  try {
    const [version, ivRaw, tagRaw, dataRaw] = String(encoded || '').split('.');
    if (version !== 'v1' || !ivRaw || !tagRaw || !dataRaw) return null;
    const iv = Buffer.from(ivRaw, 'base64url');
    const tag = Buffer.from(tagRaw, 'base64url');
    const ciphertext = Buffer.from(dataRaw, 'base64url');
    if (iv.length !== 12 || tag.length !== 16 || !ciphertext.length) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', memberLinkCipherKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8').normalize('NFC');
  } catch {
    return null;
  }
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
const DEMO_MEMBER_TOKENS = Object.fromEntries(
  DEMO_ROSTER.map((m, i) => [m.displayName, `demo-member-${i + 1}-Qx7vKp4mN2`])
);

function makeDemoSeed(now = new Date('2026-08-27T15:00:00Z')) {
  const members = DEMO_ROSTER.map((m, i) => ({
    id: `demo_${String.fromCharCode(97 + i)}`,
    displayName: m.displayName,
    email: m.email,
    active: true,
    adminPrivilege: false,
    createdAt: now.toISOString()
  }));
  const memberTokens = members.map((m, i) => {
    const raw = DEMO_MEMBER_TOKENS[m.displayName];
    return {
      id: `demo_token_${i + 1}`,
      memberId: m.id,
      tokenHash: tokenHash(raw),
      active: true,
      createdAt: now.toISOString(),
      revokedAt: null
    };
  });
  return {
    schemaVersion: 4,
    rosterVersion: CURRENT_ROSTER_VERSION,
    linkStorageVersion: CURRENT_LINK_STORAGE_VERSION,
    settings: { minRequired: 1 },
    members,
    memberTokens,
    sessions: [],
    attendance: {},
    roleAssignments: {},
    scheduleExceptions: { '2026-12-24': { isOpen: false, note: 'Fermeture de démonstration' } },
    auditLog: []
  };
}


// ===== src/store-file.mjs =====
function clone(v) { return JSON.parse(JSON.stringify(v)); }

const RELAXED_FSYNC = process.env.RELAXED_FSYNC === '1';

const CURRENT_SCHEMA_VERSION = 4;
const BACKUP_FORMAT_VERSION = 2;
const ROLE_KEYS = ['accueil', 'tpe', 'mep', 'arbitrage'];
const ALL_ROLE_KEYS = [...ROLE_KEYS, 'present'];

const ROLE_NOTIFICATION_LABELS = Object.freeze({
  accueil: 'Accueil',
  tpe: 'TPE',
  mep: 'MEP',
  arbitrage: 'Arbitrage'
});

function formatRoleAssignmentDateFr(date) {
  const match = String(date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return String(date || '');
  const [, y, m, d] = match;
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(new Date(Date.UTC(Number(y), Number(m) - 1, Number(d))));
}

/**
 * Hook prêt pour le futur service d'email.
 *
 * IMPORTANT V15.42.4 :
 * - aucune requête réseau ;
 * - aucun email envoyé ;
 * - aucune clé/API nécessaire ;
 * - l'enregistrement du planning ne dépend jamais de ce hook.
 *
 * Plus tard, il suffira de remplacer la section TODO par l'appel au
 * fournisseur choisi (Resend, Brevo, SMTP, etc.).
 */

const MEMBER_LINK_PUBLIC_HOME = String(
  process.env.MEMBER_LINK_PUBLIC_HOME || 'https://capgui13.github.io/CalasOrga/'
).replace(/\/?$/, '/');

function memberShortPublicUrl(shortToken) {
  return `${MEMBER_LINK_PUBLIC_HOME}#${String(shortToken || '').normalize('NFC')}`;
}

/**
 * Futur envoi du lien personnel d'un membre.
 *
 * V15.42.5 :
 * - le destinataire, le lien, le sujet et le corps sont réellement préparés ;
 * - aucun fournisseur d'email n'est encore appelé ;
 * - la route admin peut donc déjà être utilisée par l'interface.
 */
async function sendMemberPersonalLinkEmail({
  memberId,
  memberName,
  email,
  personalUrl
} = {}) {
  const message = {
    kind: 'member_personal_link',
    memberId: String(memberId || ''),
    memberName: String(memberName || ''),
    email: String(email || ''),
    personalUrl: String(personalUrl || ''),
    subject: 'CalasOrga — Votre lien personnel',
    text: `Bonjour ${String(memberName || '').trim()},\n\nVoici votre lien personnel CalasOrga :\n${String(personalUrl || '')}\n\nConservez ce lien pour accéder à votre planning.`
  };

  // TODO MAIL :
  // await mailProvider.send({
  //   to: message.email,
  //   subject: message.subject,
  //   text: message.text
  // });

  return {
    ok: true,
    sent: false,
    prepared: true,
    reason: 'mail_provider_not_configured',
    message
  };
}

async function notifyMemberRoleAssignment({
  memberId,
  memberName,
  email,
  date,
  role
} = {}) {
  const roleLabel = ROLE_NOTIFICATION_LABELS[role] || String(role || '');
  const dateLabel = formatRoleAssignmentDateFr(date);

  const message = {
    kind: 'availability_to_active_role',
    memberId: String(memberId || ''),
    memberName: String(memberName || ''),
    email: String(email || ''),
    date: String(date || ''),
    role: String(role || ''),
    roleLabel,
    subject: 'CalasOrga — Nouvelle affectation',
    text: `Bonjour ${String(memberName || '').trim()},\n\nVous avez été affecté à ${roleLabel} le ${dateLabel}.\n\nCette modification a été effectuée par un administrateur.`
  };

  // TODO MAIL :
  // await mailProvider.send({
  //   to: message.email,
  //   subject: message.subject,
  //   text: message.text
  // });

  return {
    ok: true,
    sent: false,
    prepared: true,
    reason: 'mail_provider_not_configured',
    message
  };
}

function collectAvailabilityToRoleNotifications(beforeState, afterState) {
  const notifications = [];
  const members = new Map(
    (afterState?.members || beforeState?.members || [])
      .map((m) => [String(m.id), m])
  );

  const dates = new Set([
    ...Object.keys(beforeState?.attendance || {}),
    ...Object.keys(afterState?.roleAssignments || {})
  ]);

  for (const date of dates) {
    const availableBefore = new Set(
      Array.isArray(beforeState?.attendance?.[date])
        ? beforeState.attendance[date].map(String)
        : []
    );
    if (!availableBefore.size) continue;

    const rolesAfter = afterState?.roleAssignments?.[date] || {};
    for (const role of ROLE_KEYS) {
      const idsAfter = Array.isArray(rolesAfter[role])
        ? rolesAfter[role].map(String)
        : [];

      for (const memberId of idsAfter) {
        if (!availableBefore.has(memberId)) continue;
        const member = members.get(memberId);
        if (!member) continue;

        notifications.push({
          memberId,
          memberName: member.displayName || '',
          email: member.email || '',
          date,
          role
        });
      }
    }
  }

  return notifications;
}

async function runAdminPlanningMutationWithNotifications(store, mutation) {
  const beforeState = clone(store.state);
  const result = await mutation();

  if (!result?.ok) return result;

  const notifications = collectAvailabilityToRoleNotifications(
    beforeState,
    store.state
  );

  for (const notification of notifications) {
    try {
      await notifyMemberRoleAssignment(notification);
    } catch (err) {
      // Le planning est déjà enregistré : une future panne mail ne doit
      // jamais transformer cette modification en échec utilisateur.
      console.warn(
        `Notification d'affectation non envoyée (${notification.memberId}, ${notification.date}, ${notification.role}) : ${err?.message || err}`
      );
    }
  }

  return {
    ...result,
    notificationCandidates: notifications.length
  };
}

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

function defaultState() {
  const createdAt = new Date().toISOString();
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    rosterVersion: CURRENT_ROSTER_VERSION,
    settings: { minRequired: 1 },
    members: CURRENT_ROSTER.map((m) => ({ id: m.id, displayName: m.displayName, email: m.email, active: true, adminPrivilege: false, createdAt })),
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
    const configuredConfirmationBasis = process.env.CONFIRMATION_SECRET || process.env.ADMIN_TOKEN_SHA256 || process.env.ADMIN_TOKEN || process.env.ADMIN_CODE || '';
    this.confirmationSecret = configuredConfirmationBasis
      ? sha256Text(`confirmation-v1:${configuredConfirmationBasis}`)
      : randomToken(32);
    this.remoteBlob = !!(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
    this.blobPath = String(process.env.BLOB_STATE_PATH || 'calasorga/store.json').replace(/^\/+/, '');
    this.blobApi = null;
    this.remoteEtag = null;
    this.remoteCurrentText = null;
  }

  async #blobClient() {
    if (!this.blobApi) this.blobApi = await import('@vercel/blob');
    return this.blobApi;
  }

  #isBlobNotFound(err) {
    const status = Number(err?.status ?? err?.statusCode ?? err?.response?.status ?? 0);
    const signature = [err?.name, err?.constructor?.name, err?.code, err?.message]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return status === 404
      || err?.code === 'BLOB_NOT_FOUND'
      || signature.includes('blobnotfound')
      || signature.includes('requested blob does not exist')
      || signature.includes('blob does not exist');
  }

  #isBlobConflict(err) {
    return err?.name === 'BlobPreconditionFailedError' || err?.status === 412 || err?.statusCode === 412 || err?.code === 'BLOB_PRECONDITION_FAILED';
  }

  async #readRemoteCandidate(pathname) {
    const api = await this.#blobClient();
    const token = process.env.BLOB_READ_WRITE_TOKEN || undefined;
    let meta;
    try {
      meta = await api.head(pathname, { token });
    } catch (err) {
      if (this.#isBlobNotFound(err)) throw Object.assign(new Error('Blob absent.'), { code: 'ENOENT' });
      throw err;
    }
    let result;
    try {
      result = await api.get(pathname, { access: 'private', useCache: false, token });
    } catch (err) {
      if (this.#isBlobNotFound(err)) throw Object.assign(new Error('Blob absent.'), { code: 'ENOENT' });
      throw err;
    }
    if (!result || result.statusCode !== 200) throw Object.assign(new Error('Blob absent.'), { code: 'ENOENT' });
    const rawText = await new Response(result.stream).text();
    const before = this.state;
    try {
      this.state = JSON.parse(rawText);
      const rosterMigrationNeeded = this.state?.rosterVersion !== CURRENT_ROSTER_VERSION;
      this.#normalize({ requireEnvelope: true });
      const report = this.integrityReport();
      if (!report.ok) {
        throw Object.assign(new Error(`Stockage incohérent : ${report.issues.slice(0, 5).join(', ')}.`), { code: 'INVALID_SCHEMA' });
      }
      return { state: clone(this.state), rawText, etag: meta?.etag || null, rosterMigrationNeeded };
    } finally {
      this.state = before;
    }
  }

  async #loadRemotePrimary({ persistRosterMigration = false } = {}) {
    const loaded = await this.#readRemoteCandidate(this.blobPath);
    this.state = loaded.state;
    this.remoteEtag = loaded.etag;
    this.remoteCurrentText = loaded.rawText;
    if (persistRosterMigration && loaded.rosterMigrationNeeded) {
      await this.#persist({ preserveCurrent: false, snapshots: true });
    }
    return loaded;
  }

  async refresh() {
    if (!this.remoteBlob) return this;
    await this.#loadRemotePrimary({ persistRosterMigration: true });
    return this;
  }

  async init(seed = null) {
    if (this.remoteBlob) {
      let primaryError = null;
      try {
        await this.#loadRemotePrimary({ persistRosterMigration: true });
        return this;
      } catch (err) {
        if (err?.code === 'UNSUPPORTED_SCHEMA') throw err;
        if (err?.code === 'ENOENT') {
          this.state = seed ? clone(seed) : defaultState();
          this.#normalize({ requireEnvelope: true });
          this.remoteEtag = null;
          this.remoteCurrentText = null;
          await this.#persist({ preserveCurrent: false });
          return this;
        }
        primaryError = err;
      }

      try {
        const api = await this.#blobClient();
        const meta = await api.head(this.blobPath, { token: process.env.BLOB_READ_WRITE_TOKEN || undefined });
        this.remoteEtag = meta?.etag || null;
      } catch {}

      for (const suffix of ['.good', '.bak']) {
        try {
          const loaded = await this.#readRemoteCandidate(`${this.blobPath}${suffix}`);
          this.state = loaded.state;
          this.remoteCurrentText = null;
          this.#invalidateRecoveredCredentials(`blob:${suffix}`);
          console.warn(`Stockage Blob principal illisible/invalide : récupération depuis ${suffix}.`);
          await this.#persist({ preserveCurrent: false });
          return this;
        } catch (recoveryErr) {
          if (recoveryErr?.code === 'UNSUPPORTED_SCHEMA') throw recoveryErr;
        }
      }
      throw primaryError;
    }

    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await this.#cleanupStaleTemps();
    let primaryError = null;
    try {
      const migrated = await this.#loadStateFile(this.filePath);
      if (migrated) await this.#persist({ preserveCurrent: false });
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
        this.#invalidateRecoveredCredentials(`file:${suffix}`);
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
    const rosterMigrationNeeded = this.state?.rosterVersion !== CURRENT_ROSTER_VERSION;
    const linkStorageMigrationNeeded = this.state?.linkStorageVersion !== CURRENT_LINK_STORAGE_VERSION;
    this.#normalize({ requireEnvelope: true });
    const report = this.integrityReport();
    if (!report.ok) {
      throw Object.assign(new Error(`Stockage incohérent : ${report.issues.slice(0, 5).join(', ')}.`), { code: 'INVALID_SCHEMA' });
    }
    return rosterMigrationNeeded || linkStorageMigrationNeeded;
  }

  #invalidateRecoveredCredentials(reason = 'reprise_stockage') {
    const nowIso = this.now().toISOString();
    let revokedLinks = 0;
    for (const rec of this.state.memberTokens || []) {
      if (!rec.active) continue;
      rec.active = false;
      rec.revokedAt = nowIso;
      revokedLinks += 1;
    }
    const revokedSessions = (this.state.sessions || []).filter((rec) => rec.active).length;
    this.state.sessions = [];
    this.#log(this.state, 'Système', 'identifiants_revoques_reprise_stockage', null, {
      reason, revokedLinks, revokedSessions
    });
  }

  #normalize({ requireEnvelope = false } = {}) {
    const rosterMigrationNeeded = this.state?.rosterVersion !== CURRENT_ROSTER_VERSION;
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
    if (rosterMigrationNeeded) {
      applyCurrentRoster(this.state, this.now().toISOString());
    } else {
      this.state.rosterVersion = CURRENT_ROSTER_VERSION;
      for (const m of this.state.members) {
        const email = sanitizeEmail(m?.email);
        if (email) m.email = email;
        m.adminPrivilege = m?.adminPrivilege === true;
      }
    }

    if (this.state.linkStorageVersion !== CURRENT_LINK_STORAGE_VERSION) {
      const nowIso = this.now().toISOString();
      let upgraded = 0;
      for (const m of this.state.members) {
        const legacyActive = this.state.memberTokens.find((t) => t.memberId === m.id && t.active && !t.shortTokenEnc);
        if (!legacyActive) continue;

        /* L'ancien short token n'est pas réversible. On le remplace par un
           nouveau lien affichable, mais on conserve les sessions appareils
           existantes : seul l'ancien URL devient invalide. */
        for (const t of this.state.memberTokens.filter((t) => t.memberId === m.id && t.active)) {
          t.active = false;
          t.revokedAt = nowIso;
        }
        const raw = randomToken();
        const short = this.#newShortPersonalToken(this.state, m.displayName);
        this.state.memberTokens.push({
          id: `t_${randomToken(10)}`,
          memberId: m.id,
          tokenHash: tokenHash(raw),
          shortTokenHash: short.hash,
          shortTokenEnc: encryptMemberShortToken(short.raw),
          active: true,
          createdAt: nowIso,
          revokedAt: null
        });
        upgraded += 1;
      }
      this.state.linkStorageVersion = CURRENT_LINK_STORAGE_VERSION;
      if (upgraded) {
        this.#log(this.state, 'Système', 'liens_anciens_convertis', null, { upgraded });
        this.#cleanupMemberTokens(this.state);
      }
    }
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

  async #persist({ preserveCurrent = true, snapshots = true } = {}) {
    const text = JSON.stringify(this.state, null, 2);

    if (this.remoteBlob) {
      const api = await this.#blobClient();
      const token = process.env.BLOB_READ_WRITE_TOKEN || undefined;
      const previousText = this.remoteCurrentText;
      const options = { access: 'private', token, allowOverwrite: true };
      if (this.remoteEtag) options.ifMatch = this.remoteEtag;

      let uploaded;
      try {
        uploaded = await api.put(this.blobPath, text, options);
      } catch (err) {
        if (this.#isBlobConflict(err)) {
          throw Object.assign(new Error('Le calendrier a été modifié simultanément. Nouvelle tentative requise.'), { code: 'REMOTE_CONFLICT', status: 409 });
        }
        throw err;
      }

      if (uploaded?.etag) this.remoteEtag = uploaded.etag;
      else {
        const meta = await api.head(this.blobPath, { token });
        this.remoteEtag = meta?.etag || null;
      }
      this.remoteCurrentText = text;

      // Les écritures de session n'ont pas besoin de réécrire .bak/.good : en cas de
      // récupération exceptionnelle, toutes les sessions sont de toute façon révoquées.
      if (!snapshots) return;
      // Les copies auxiliaires n'entrent jamais dans la transaction principale :
      // la réussite du blob principal suffit à valider l'écriture.
      const snapshotWrites = [];
      if (preserveCurrent && previousText) snapshotWrites.push(['.bak', previousText]);
      snapshotWrites.push(['.good', text]);
      const settled = await Promise.allSettled(snapshotWrites.map(([suffix, body]) =>
        api.put(`${this.blobPath}${suffix}`, body, { access: 'private', token, allowOverwrite: true })
      ));
      for (const item of settled) {
        if (item.status === 'rejected') console.warn(`Impossible de mettre à jour un snapshot Blob auxiliaire : ${item.reason?.message || item.reason}`);
      }
      return;
    }

    const tmp = `${this.filePath}.tmp-${process.pid}-${Date.now()}-${randomToken(4)}`;
    await this.#writeDurable(tmp, text);
    if (preserveCurrent && snapshots) {
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
    if (snapshots) {
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
  }

  async mutate(fn, { snapshots = true, useCurrentRemote = false } = {}) {
    const task = this.queue.then(async () => {
      if (this.remoteBlob) {
        for (let attempt = 0; attempt < 8; attempt++) {
          // requestHandler a déjà rafraîchi l'état partagé juste avant ces mutations.
          // Le premier essai réutilise donc cet état et son ETag. En cas de conflit,
          // les tentatives suivantes relisent intégralement le Blob.
          if (!(useCurrentRemote && attempt === 0 && this.remoteCurrentText != null)) {
            await this.#loadRemotePrimary();
          }
          const previous = this.state;
          const draft = clone(previous);
          const result = await fn(draft);
          if (result && result.ok === false) return result;
          this.state = draft;
          try {
            await this.#persist({ snapshots });
            return result;
          } catch (err) {
            this.state = previous;
            if (err?.code !== 'REMOTE_CONFLICT') throw err;
            if (attempt === 7) {
              throw Object.assign(new Error('Plusieurs modifications simultanées empêchent momentanément l’enregistrement. Réessayez.'), { status: 409 });
            }
            await new Promise((resolve) => setTimeout(resolve, 8 + Math.floor(Math.random() * 18) + attempt * 6));
          }
        }
      }

      const previous = this.state;
      const draft = clone(previous);
      const result = await fn(draft);
      // Une validation refusée ne doit ni toucher au disque ni altérer l'état en mémoire.
      if (result && result.ok === false) return result;
      this.state = draft;
      try {
        await this.#persist({ snapshots });
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

  #findSessionInState(state, rawToken, kind, credentialTag = null) {
    const hash = tokenHash(rawToken);
    if (!rawToken || !hash) return null;
    return state.sessions.find((s) => s.kind === kind && s.tokenHash === hash && this.#sessionAlive(s) && (credentialTag == null || s.credentialTag === credentialTag)) || null;
  }

  #findSession(rawToken, kind, credentialTag = null) {
    return this.#findSessionInState(this.state, rawToken, kind, credentialTag);
  }

  findMemberByRawToken(rawToken) {
    const hash = tokenHash(rawToken);
    const rec = this.state.memberTokens.find((t) => t.active && t.tokenHash === hash);
    if (!rec) return null;
    const m = this.state.members.find((x) => x.id === rec.memberId && x.active);
    return m || null;
  }

  findMemberByShortToken(rawToken) {
    const clean = String(rawToken || '').normalize('NFC');
    if (!/^[\p{L}\p{N}]{1,40}\d{6}$/u.test(clean)) return null;
    const hashes = new Set(shortPersonalTokenHashCandidates(clean));
    const rec = this.state.memberTokens.find((t) => t.active && hashes.has(t.shortTokenHash));
    if (!rec) return null;
    return this.state.members.find((x) => x.id === rec.memberId && x.active) || null;
  }

  findMemberBySessionRawToken(rawToken) {
    const session = this.#findSession(rawToken, 'member');
    if (!session) return null;
    return this.state.members.find((m) => m.id === session.memberId && m.active) || null;
  }

  adminSessionInfo(rawToken, credentialTag = null) {
    const rec = this.#findSession(rawToken, 'admin', credentialTag);
    if (!rec) return null;
    if (rec.sourceMemberId) {
      const member = this.state.members.find((m) => m.id === rec.sourceMemberId && m.active && m.adminPrivilege === true);
      if (!member) return null;
    }
    return rec;
  }

  adminSessionOk(rawToken, credentialTag = null) {
    return !!this.adminSessionInfo(rawToken, credentialTag);
  }

  adminSessionContext(rawToken, credentialTag = null) {
    const rec = this.adminSessionInfo(rawToken, credentialTag);
    if (!rec) return null;
    if (!rec.sourceMemberId) return { fromMember: false, memberId: null, name: null };
    const member = this.state.members.find((m) => m.id === rec.sourceMemberId && m.active && m.adminPrivilege === true);
    return member ? { fromMember: true, memberId: member.id, name: member.displayName } : null;
  }

  #appendMemberSession(s, memberId, raw, expiresAt, now, deviceInfo = null) {
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
      createdAt: now.toISOString(), expiresAt, revokedAt: null,
      device: sanitizeSessionDevice(deviceInfo)
    });
    return { ok: true, rawToken: raw, expiresAt, member: { id: member.id, name: member.displayName } };
  }

  async createMemberSession(memberId, ttlSeconds = MEMBER_SESSION_TTL_SECONDS, deviceInfo = null) {
    const raw = randomToken();
    const now = this.now();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();
    return this.mutate((s) => this.#appendMemberSession(s, memberId, raw, expiresAt, now, deviceInfo), { snapshots: false });
  }

  async loginMemberByRawToken(rawToken, currentRawSession = '', ttlSeconds = MEMBER_SESSION_TTL_SECONDS, deviceInfo = null) {
    const rawSession = randomToken();
    const now = this.now();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();
    const linkHash = tokenHash(rawToken);
    return this.mutate((s) => {
      const rec = s.memberTokens.find((t) => t.active && t.tokenHash === linkHash);
      if (!rec) return { ok: false, status: 401, error: 'Lien personnel invalide ou révoqué.' };
      const currentSession = currentRawSession ? this.#findSessionInState(s, currentRawSession, 'member') : null;
      if (currentSession?.memberId === rec.memberId) {
        currentSession.active = false;
        currentSession.revokedAt = now.toISOString();
      }
      return this.#appendMemberSession(s, rec.memberId, rawSession, expiresAt, now, deviceInfo);
    }, { snapshots: false });
  }

  async loginMemberByShortToken(rawToken, currentRawSession = '', confirmSwitch = false, ttlSeconds = MEMBER_SESSION_TTL_SECONDS, deviceInfo = null) {
    const clean = String(rawToken || '').trim().normalize('NFC');
    if (!/^[\p{L}\p{N}]{1,40}\d{6}$/u.test(clean)) return { ok: false, status: 401, error: 'Lien personnel invalide ou révoqué.' };
    const hashes = new Set(shortPersonalTokenHashCandidates(clean));
    const rawSession = randomToken();
    const now = this.now();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();
    return this.mutate((s) => {
      const rec = s.memberTokens.find((t) => t.active && hashes.has(t.shortTokenHash));
      const target = rec ? s.members.find((m) => m.id === rec.memberId && m.active) : null;
      if (!target) return { ok: false, status: 401, error: 'Lien personnel invalide ou révoqué.' };
      const currentSession = currentRawSession ? this.#findSessionInState(s, currentRawSession, 'member') : null;
      const current = currentSession ? s.members.find((m) => m.id === currentSession.memberId && m.active) : null;
      if (current && current.id !== target.id && confirmSwitch !== true) {
        return {
          ok: false, status: 409,
          error: `Cet appareil est déjà associé à ${current.displayName}.`,
          requiresIdentitySwitch: true,
          currentMember: { id: current.id, name: current.displayName },
          targetMember: { id: target.id, name: target.displayName }
        };
      }
      if (currentSession) {
        currentSession.active = false;
        currentSession.revokedAt = now.toISOString();
      }
      return this.#appendMemberSession(s, target.id, rawSession, expiresAt, now, deviceInfo);
    }, { snapshots: false });
  }

  async createAdminSession(ttlSeconds = 60 * 60 * 8, credentialTag = null, sourceMemberId = null) {
    const raw = randomToken();
    const now = this.now();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();
    return this.mutate((s) => {
      this.#cleanupSessions(s);
      let source = null;
      if (sourceMemberId) {
        source = s.members.find((m) => m.id === sourceMemberId && m.active && m.adminPrivilege === true);
        if (!source) return { ok: false, status: 403, error: 'Privilèges administrateur requis.' };
        for (const rec of s.sessions) {
          if (rec.kind === 'admin' && rec.sourceMemberId === sourceMemberId && rec.active) {
            rec.active = false;
            rec.revokedAt = now.toISOString();
          }
        }
      }
      s.sessions.push({
        id: `s_${randomToken(10)}`, kind: 'admin', memberId: null,
        sourceMemberId: source?.id || null,
        credentialTag: credentialTag ? String(credentialTag).slice(0, 128) : null,
        tokenHash: tokenHash(raw), active: true,
        createdAt: now.toISOString(), expiresAt, revokedAt: null
      });
      return {
        ok: true,
        rawToken: raw,
        expiresAt,
        sourceMember: source ? { id: source.id, name: source.displayName } : null
      };
    }, { snapshots: false });
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
    }, { snapshots: false });
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

  async revokeMemberSessionsByAdmin(memberId) {
    return this.mutate((s) => {
      const member = s.members.find((m) => m.id === memberId);
      if (!member) return { ok: false, status: 404, error: 'Membre introuvable.' };
      const revoked = this.#revokeMemberSessions(s, memberId);
      if (revoked) this.#log(s, 'Administrateur', 'sessions_membre_revoquees', null, { memberId, name: member.displayName, count: revoked });
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
    let revoked = 0;
    for (const rec of s.sessions) {
      const belongsToMember =
        (rec.kind === 'member' && rec.memberId === memberId) ||
        (rec.kind === 'admin' && rec.sourceMemberId === memberId);
      if (belongsToMember && rec.active) {
        rec.active = false;
        rec.revokedAt = this.now().toISOString();
        revoked += 1;
      }
    }
    return revoked;
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

  #newShortPersonalToken(s, displayName) {
    for (let i = 0; i < 32; i++) {
      const raw = makeShortPersonalToken(displayName);
      const hash = shortPersonalTokenHash(raw);
      if (!(s.memberTokens || []).some((t) => t.shortTokenHash === hash)) return { raw, hash };
    }
    throw new Error('Impossible de générer un lien personnel court unique.');
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
    if (this.state?.rosterVersion !== CURRENT_ROSTER_VERSION) issues.push(`roster_version_invalid:${this.state?.rosterVersion || ''}`);
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
      if (!sanitizeEmail(m?.email)) issues.push(`member_email_invalid:${m?.id || '?'}`);
      if (typeof m?.adminPrivilege !== 'boolean') issues.push(`member_admin_privilege_invalid:${m?.id || '?'}`);
      if (typeof m?.active !== 'boolean') issues.push(`member_active_invalid:${m?.id || '?'}`);
      if (!safeIsoInstant(m?.createdAt)) issues.push(`member_created_at_invalid:${m?.id || '?'}`);
    }
    const tokenHashes = new Set();
    const shortTokenHashes = new Set();
    const activeTokenMembers = new Set();
    for (const t of this.state.memberTokens) {
      if (!memberIds.has(t?.memberId)) issues.push(`token_orphan:${t?.id || '?'}`);
      if (typeof t?.active !== 'boolean') issues.push(`token_active_invalid:${t?.id || '?'}`);
      if (t?.active) { if (activeTokenMembers.has(t.memberId)) issues.push(`multiple_active_tokens:${t.memberId}`); else activeTokenMembers.add(t.memberId); }
      if (!/^[a-f0-9]{64}$/i.test(String(t?.tokenHash || ''))) issues.push(`token_hash_invalid:${t?.id || '?'}`);
      else if (tokenHashes.has(t.tokenHash)) issues.push(`token_hash_duplicate:${t?.id || '?'}`);
      else tokenHashes.add(t.tokenHash);
      if (t?.shortTokenHash != null) {
        const shortHash = String(t.shortTokenHash || '');
        if (!/^[a-f0-9]{64}$/i.test(shortHash)) issues.push(`short_token_hash_invalid:${t?.id || '?'}`);
        else if (shortTokenHashes.has(shortHash)) issues.push(`short_token_hash_duplicate:${t?.id || '?'}`);
        else shortTokenHashes.add(shortHash);
        if (t?.shortTokenEnc != null) {
          const recoveredShort = decryptMemberShortToken(t.shortTokenEnc);
          if (!recoveredShort || !shortPersonalTokenHashCandidates(recoveredShort).includes(shortHash.toLowerCase())) {
            issues.push(`short_token_display_invalid:${t?.id || '?'}`);
          }
        }
      }
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
      if (rec?.kind === 'admin' && rec?.sourceMemberId != null && !memberIds.has(rec.sourceMemberId)) issues.push(`admin_session_source_member_invalid:${rec?.id || '?'}`);
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
    for (const [date, ids] of Object.entries(this.state.attendance || {})) {
      const roles = this.state.roleAssignments?.[date] || {};
      const coreIds = new Set(ROLE_KEYS.flatMap((role) => Array.isArray(roles[role]) ? roles[role].map(String) : []));
      for (const id of Array.isArray(ids) ? ids.map(String) : []) {
        if (coreIds.has(id)) issues.push(`availability_role_conflict:${date}:${id}`);
      }
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
      rosterVersion: CURRENT_ROSTER_VERSION,
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
    const backupRosterVersion = String(src.rosterVersion || '');
    if (!LEGACY_ROSTER_VERSIONS.has(backupRosterVersion)) {
      return { ok: false, status: 409, error: 'Cette sauvegarde utilise une version de liste de membres inconnue.' };
    }
    if (backupRosterVersion !== CURRENT_ROSTER_VERSION) warnings.push('roster_version_legacy');
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
      const id = String(m?.id || ''); const displayName = sanitizeName(m?.displayName); const email = sanitizeEmail(m?.email);
      if (typeof m?.active !== 'boolean') return { ok: false, status: 400, error: 'État actif/inactif invalide pour un membre.' };
      if (!id || id.length > 120 || ids.has(id) || !displayName || !email) return { ok: false, status: 400, error: 'Membre invalide dans la sauvegarde.' };
      ids.add(id);
      members.push({ id, displayName, email, active: !!m.active, adminPrivilege: m?.adminPrivilege === true, createdAt: safeIsoInstant(m?.createdAt) || this.now().toISOString() });
    }
    if (!Array.isArray(src.memberTokens) || src.memberTokens.length > 1500) return { ok: false, status: 400, error: 'Liens personnels invalides dans la sauvegarde.' };
    const memberTokens = []; const hashes = new Set(); const shortHashes = new Set(); const activeTokenMembers = new Set();
    for (const t of src.memberTokens) {
      const tokenHashValue = String(t?.tokenHash || '');
      const shortTokenHashValue = t?.shortTokenHash == null ? '' : String(t.shortTokenHash || '');
      const shortTokenEncValue = t?.shortTokenEnc == null ? '' : String(t.shortTokenEnc || '');
      if (typeof t?.active !== 'boolean') return { ok: false, status: 400, error: 'État actif/révoqué invalide pour un lien personnel.' };
      if (t.active) { if (activeTokenMembers.has(t.memberId)) return { ok: false, status: 400, error: 'Plusieurs liens personnels actifs existent pour le même membre.' }; activeTokenMembers.add(t.memberId); }
      if (!ids.has(t?.memberId) || !/^[a-f0-9]{64}$/i.test(tokenHashValue) || hashes.has(tokenHashValue)) return { ok: false, status: 400, error: 'Lien personnel invalide dans la sauvegarde.' };
      if (shortTokenHashValue && (!/^[a-f0-9]{64}$/i.test(shortTokenHashValue) || shortHashes.has(shortTokenHashValue.toLowerCase()))) return { ok: false, status: 400, error: 'Lien personnel court invalide dans la sauvegarde.' };
      hashes.add(tokenHashValue);
      if (shortTokenHashValue) shortHashes.add(shortTokenHashValue.toLowerCase());
      let preservedShortTokenEnc = '';
      if (shortTokenEncValue && shortTokenHashValue) {
        const recoveredShort = decryptMemberShortToken(shortTokenEncValue);
        if (recoveredShort && shortPersonalTokenHashCandidates(recoveredShort).includes(shortTokenHashValue.toLowerCase())) {
          preservedShortTokenEnc = shortTokenEncValue;
        } else {
          warnings.push('lien_affichable_ignore');
        }
      }
      memberTokens.push({
        id: String(t.id || `t_${randomToken(10)}`).slice(0, 120), memberId: t.memberId, tokenHash: tokenHashValue.toLowerCase(),
        ...(shortTokenHashValue ? { shortTokenHash: shortTokenHashValue.toLowerCase() } : {}),
        ...(preservedShortTokenEnc ? { shortTokenEnc: preservedShortTokenEnc } : {}), active: !!t.active,
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
    const nextState = { schemaVersion: CURRENT_SCHEMA_VERSION, rosterVersion: CURRENT_ROSTER_VERSION, linkStorageVersion: CURRENT_LINK_STORAGE_VERSION, settings: { minRequired }, members, memberTokens, sessions: [], attendance, roleAssignments, scheduleExceptions, auditLog };
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
      const restoredIds = new Set(valid.state.members.map((m) => m.id));
      const restoredActiveIds = new Set(valid.state.members.filter((m) => m.active).map((m) => m.id));
      const preservedMemberTokens = clone((s.memberTokens || []).filter((rec) => restoredIds.has(rec.memberId)));
      const nowIso = this.now().toISOString();
      let linksRevokedBecauseMemberInactive = 0;
      for (const rec of preservedMemberTokens) {
        if (rec.active && !restoredActiveIds.has(rec.memberId)) {
          rec.active = false;
          rec.revokedAt = nowIso;
          linksRevokedBecauseMemberInactive += 1;
        }
      }
      const preservedActiveLinks = preservedMemberTokens.filter((rec) => rec.active).length;
      const backupActiveLinksIgnored = valid.state.memberTokens.filter((rec) => rec.active).length;
      const next = clone(valid.state);
      // Une restauration remet les données métier, jamais les credentials du fichier importé.
      // Les liens actuellement valides restent valides pour les membres encore présents/actifs.
      // Un ancien lien révoqué ne peut donc pas ressusciter via une vieille sauvegarde.
      next.memberTokens = preservedMemberTokens;
      next.sessions = keepAdmin ? [clone(keepAdmin)] : [];
      for (const key of Object.keys(s)) delete s[key];
      Object.assign(s, next);
      this.#log(s, 'Administrateur', 'sauvegarde_importee', null, {
        exportedAt: safeIsoInstant(payload.exportedAt) || '',
        formatVersion: Number(payload.formatVersion),
        warnings: valid.warnings,
        credentialPolicy: 'preserve_current_links_ignore_backup_links',
        preservedActiveLinks,
        backupActiveLinksIgnored,
        linksRevokedBecauseMemberInactive
      });
      return { ok: true, warnings: valid.warnings, preservedActiveLinks, backupActiveLinksIgnored };
    });
  }

  memberSnapshot(memberId) {
    const snap = publicSnapshot(this.state, memberId);
    const from = parisToday(this.now());
    const to = planningWindowEnd(from);
    snap.attendance = Object.fromEntries(Object.entries(snap.attendance).filter(([date]) => date >= from && date <= to));
    snap.roleAssignments = Object.fromEntries(Object.entries(snap.roleAssignments || {}).filter(([date]) => date >= from && date <= to));
    snap.assignments = Object.fromEntries(Object.entries(snap.assignments || {}).filter(([date]) => date >= from && date <= to));
    snap.scheduleExceptions = Object.fromEntries(Object.entries(snap.scheduleExceptions).filter(([date]) => date >= from && date <= to));
    const visibleIds = new Set([memberId]);
    for (const day of Object.values(snap.assignments)) for (const ids of Object.values(day)) for (const id of ids) visibleIds.add(id);
    snap.members = snap.members.filter((m) => visibleIds.has(m.id));
    snap.settings.memberWindow = { from, to };
    const self = this.state.members.find((m) => m.id === memberId && m.active);
    if (snap.me) snap.me.adminPrivilege = !!self?.adminPrivilege;
    return snap;
  }
  auditEntries(limit = 5000) {
    const n = Math.max(1, Math.min(5000, Number(limit) || 5000));
    return clone(this.state.auditLog.slice(-n).reverse());
  }
  #memberSessionSummary(memberId) {
    const active = this.state.sessions
      .filter((rec) => rec.kind === 'member' && rec.memberId === memberId && this.#sessionAlive(rec))
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    return {
      deviceCount: active.length,
      oldestDeviceAt: active[0]?.createdAt || null,
      latestDeviceAt: active.at(-1)?.createdAt || null,
      devices: active.map((rec) => ({
        createdAt: rec.createdAt || null,
        expiresAt: rec.expiresAt || null,
        type: rec.device?.type || null,
        browser: rec.device?.browser || null,
        os: rec.device?.os || null,
        label: rec.device?.label || null
      }))
    };
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
      membersAdmin: this.state.members.map((m) => {
        const activeToken = this.state.memberTokens.find((t) => t.memberId === m.id && t.active) || null;
        const currentShortToken = activeToken?.shortTokenEnc ? decryptMemberShortToken(activeToken.shortTokenEnc) : null;
        return {
          id: m.id,
          name: m.displayName,
          email: m.email,
          active: !!m.active,
          adminPrivilege: !!m.adminPrivilege,
          createdAt: m.createdAt,
          hasActiveLink: !!activeToken,
          currentShortToken: currentShortToken || null,
          linkRecoverable: !!currentShortToken,
          ...this.#memberSessionSummary(m.id)
        };
      }),
      auditLog: this.state.auditLog.slice(-200).reverse(),
      integrity: this.integrityReport()
    };
  }


  async setMemberAssignmentsBatch(memberId, changes) {
    if (!Array.isArray(changes) || !changes.length) {
      return { ok: false, status: 400, error: 'Aucune modification à enregistrer.' };
    }
    if (changes.length > 100) {
      return { ok: false, status: 413, error: 'Trop de modifications dans un seul lot.' };
    }

    const final = new Map();
    for (const raw of changes) {
      const date = String(raw?.date || '');
      const role = String(raw?.role || '').toLowerCase();
      if (!isIsoDate(date)) return { ok: false, status: 400, error: 'Date invalide.' };
      if (!ALL_ROLE_KEYS.includes(role)) return { ok: false, status: 400, error: 'Rôle invalide.' };
      final.set(`${date}|${role}`, { date, role, present: raw?.present === true });
    }
    const desired = [...final.values()];

    return this.mutate((s) => {
      const member = s.members.find((m) => m.id === memberId && m.active);
      if (!member) return { ok: false, status: 401, error: 'Session invalide.' };

      /* Validation complète avant la première mutation : le lot est tout ou rien. */
      for (const change of desired) {
        const valid = validateMemberDateChange(s, change.date, this.now());
        if (!valid.ok) return valid;
      }

      const results = [];
      for (const change of desired) {
        const r = change.role === 'present'
          ? this.#setAttendanceInState(
              s, member, change.date, change.present,
              member.displayName,
              change.present ? 'inscription' : 'retrait'
            )
          : this.#setRoleInState(
              s, member, change.date, change.role, change.present,
              member.displayName,
              change.present ? 'role_inscription' : 'role_retrait'
            );
        if (!r.ok) return r;
        results.push({ date: change.date, role: change.role, present: change.present, changed: !!r.changed });
      }

      return {
        ok: true,
        batched: true,
        changedCount: results.filter((r) => r.changed).length,
        results
      };
    }, { useCurrentRemote: true });
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
    const horizon = validatePlanningHorizonDate(date, this.now());
    if (!horizon.ok) return horizon;
    return this.mutate((s) => {
      const member = s.members.find((m) => m.id === memberId && m.active);
      if (!member) return { ok: false, status: 404, error: 'Membre actif introuvable.' };
      if (!effectiveIsOpen(s, date)) return { ok: false, status: 409, error: "Le club n'est pas ouvert ce jour-là." };
      return this.#setRoleInState(s, member, date, role, present, 'Administrateur', present ? 'admin_role_inscription' : 'admin_role_retrait');
    });
  }

  #setRoleInState(s, member, date, role, present, actor, action) {
    if (!Object.hasOwn(s.roleAssignments, date) && present && Object.keys(s.roleAssignments).length >= 5000) {
      return { ok: false, status: 409, error: 'Limite de dates de rôles atteinte. Archivez ou nettoyez les anciennes données.' };
    }

    if (present && actor !== 'Administrateur') {
      const currentRoles = s.roleAssignments?.[date] || {};
      const occupants = new Set(Array.isArray(currentRoles[role]) ? currentRoles[role].map(String) : []);
      const occupiedByOther = [...occupants].some((id) => id !== String(member.id));
      if (occupiedByOther) {
        return {
          ok: false,
          status: 409,
          error: 'Cette position est déjà occupée par un autre membre.'
        };
      }
    }

    let availabilityRemoved = false;
    if (present) {
      const available = new Set(Array.isArray(s.attendance[date]) ? s.attendance[date].map(String) : []);
      if (available.delete(member.id)) {
        availabilityRemoved = true;
        if (available.size) s.attendance[date] = [...available];
        else delete s.attendance[date];
        this.#log(
          s,
          actor,
          actor === 'Administrateur' ? 'admin_retrait' : 'retrait',
          date,
          { memberId: member.id, name: member.displayName, automatic: true, reason: 'role_assignment' }
        );
      }
    }

    const roles = s.roleAssignments[date] && typeof s.roleAssignments[date] === 'object' ? clone(s.roleAssignments[date]) : {};
    const set = new Set(Array.isArray(roles[role]) ? roles[role] : []);
    const had = set.has(member.id);
    if (present) set.add(member.id); else set.delete(member.id);
    if (set.size) roles[role] = [...set]; else delete roles[role];
    if (Object.keys(roles).length) s.roleAssignments[date] = roles; else delete s.roleAssignments[date];
    if (had !== !!present) this.#log(s, actor, action, date, { memberId: member.id, name: member.displayName, role });
    return { ok: true, changed: had !== !!present || availabilityRemoved, present: !!present, role, availabilityRemoved };
  }


  async moveAssignmentAsAdmin({ memberId, sourceDate, sourceRole, targetDate, targetRole } = {}) {
    memberId = String(memberId || '').trim();
    sourceRole = String(sourceRole || '').toLowerCase();
    targetRole = String(targetRole || '').toLowerCase();
    if (!memberId) return { ok: false, status: 400, error: 'Membre invalide.' };
    if (!isIsoDate(sourceDate) || !isIsoDate(targetDate)) return { ok: false, status: 400, error: 'Date invalide.' };
    const sourceHorizon = validatePlanningHorizonDate(sourceDate, this.now());
    if (!sourceHorizon.ok) return sourceHorizon;
    const targetHorizon = validatePlanningHorizonDate(targetDate, this.now());
    if (!targetHorizon.ok) return targetHorizon;
    if (!ALL_ROLE_KEYS.includes(sourceRole) || !ALL_ROLE_KEYS.includes(targetRole)) return { ok: false, status: 400, error: 'Position invalide.' };
    if (sourceDate === targetDate && sourceRole === targetRole) return { ok: true, changed: false };

    return this.mutate((s) => {
      if (!effectiveIsOpen(s, sourceDate) || !effectiveIsOpen(s, targetDate)) {
        return { ok: false, status: 409, error: "Une des journées n'est pas ouverte." };
      }
      const active = new Map(s.members.filter((m) => m.active).map((m) => [m.id, m]));
      const member = active.get(memberId);
      if (!member) return { ok: false, status: 404, error: 'Membre actif introuvable.' };

      const readIds = (date, role) => {
        if (role === 'present') return Array.isArray(s.attendance[date]) ? [...new Set(s.attendance[date].map(String))] : [];
        const roles = s.roleAssignments?.[date] || {};
        return Array.isArray(roles[role]) ? [...new Set(roles[role].map(String))] : [];
      };
      const writeIds = (date, role, ids) => {
        const next = [...new Set((ids || []).map(String).filter(Boolean))];
        const old = readIds(date, role);
        if (role === 'present') {
          const roles = s.roleAssignments?.[date] || {};
          const coreIds = new Set(ROLE_KEYS.flatMap((r) => Array.isArray(roles[r]) ? roles[r].map(String) : []));
          for (let i = next.length - 1; i >= 0; i--) {
            if (coreIds.has(String(next[i]))) next.splice(i, 1);
          }
          for (const oldId of old) {
            if (next.includes(oldId)) continue;
            const m = s.members.find((x) => x.id === oldId);
            this.#log(s, 'Administrateur', 'admin_retrait', date, { memberId: oldId, name: m?.displayName || '' });
          }
          for (const newId of next) {
            if (old.includes(newId)) continue;
            const m = active.get(newId);
            this.#log(s, 'Administrateur', 'admin_inscription', date, { memberId: newId, name: m?.displayName || '' });
          }
          if (next.length) s.attendance[date] = next; else delete s.attendance[date];
          return
        }
        if (next.length) {
          const available = new Set(Array.isArray(s.attendance[date]) ? s.attendance[date].map(String) : []);
          let removed = false;
          for (const id of next) removed = available.delete(String(id)) || removed;
          if (removed) {
            if (available.size) s.attendance[date] = [...available];
            else delete s.attendance[date];
          }
        }
        const roles = s.roleAssignments[date] && typeof s.roleAssignments[date] === 'object' ? clone(s.roleAssignments[date]) : {};
        for (const oldId of old) {
          if (next.includes(oldId)) continue;
          const m = s.members.find((x) => x.id === oldId);
          this.#log(s, 'Administrateur', 'admin_role_retrait', date, { memberId: oldId, name: m?.displayName || '', role });
        }
        for (const newId of next) {
          if (old.includes(newId)) continue;
          const m = active.get(newId);
          this.#log(s, 'Administrateur', 'admin_role_inscription', date, { memberId: newId, name: m?.displayName || '', role });
        }
        if (next.length) roles[role] = next; else delete roles[role];
        if (Object.keys(roles).length) s.roleAssignments[date] = roles; else delete s.roleAssignments[date]
      };

      const sourceIds = readIds(sourceDate, sourceRole);
      if (!sourceIds.includes(memberId)) return { ok: false, status: 409, error: 'Cette affectation a déjà changé.' };
      const targetIds = readIds(targetDate, targetRole);

      if (targetRole === 'present' && !Object.hasOwn(s.attendance, targetDate) && Object.keys(s.attendance).length >= 5000) {
        return { ok: false, status: 409, error: 'Limite de dates de disponibilité atteinte.' };
      }
      if (targetRole !== 'present' && !Object.hasOwn(s.roleAssignments, targetDate) && Object.keys(s.roleAssignments).length >= 5000) {
        return { ok: false, status: 409, error: 'Limite de dates de rôles atteinte.' };
      }

      // V15.20 : même poste vers une autre date = COPIE.
      // La source reste inchangée, ce qui permet de recopier une affectation régulière.
      const copySameRoleAcrossDates = sourceDate !== targetDate && sourceRole === targetRole;
      if (copySameRoleAcrossDates) {
        const targetAfter = targetRole === 'present'
          ? [...new Set([...targetIds, memberId])]
          : [memberId];
        const changed = JSON.stringify(targetAfter) !== JSON.stringify(targetIds);
        if (changed) writeIds(targetDate, targetRole, targetAfter);
        return {
          ok: true,
          changed,
          copied: true,
          swapped: false,
          source: { date: sourceDate, role: sourceRole, memberIds: readIds(sourceDate, sourceRole) },
          target: { date: targetDate, role: targetRole, memberIds: readIds(targetDate, targetRole) }
        };
      }

      // Deux postes principaux mono-occupés = échange atomique.
      const canSwap =
        ROLE_KEYS.includes(sourceRole) &&
        ROLE_KEYS.includes(targetRole) &&
        sourceIds.length === 1 &&
        targetIds.length === 1 &&
        targetIds[0] !== memberId;

      if (canSwap) {
        const displacedMemberId = targetIds[0];
        if (!active.has(displacedMemberId)) {
          return { ok: false, status: 409, error: 'La personne à échanger n’est plus active.' };
        }
        writeIds(sourceDate, sourceRole, [displacedMemberId]);
        writeIds(targetDate, targetRole, [memberId]);
        return {
          ok: true,
          changed: true,
          swapped: true,
          copied: false,
          displacedMemberId,
          source: { date: sourceDate, role: sourceRole, memberIds: readIds(sourceDate, sourceRole) },
          target: { date: targetDate, role: targetRole, memberIds: readIds(targetDate, targetRole) }
        };
      }

      writeIds(sourceDate, sourceRole, sourceIds.filter((id) => id !== memberId));
      writeIds(targetDate, targetRole, targetRole === 'present' ? [...targetIds, memberId] : [memberId]);

      return {
        ok: true,
        changed: true,
        swapped: false,
        copied: false,
        source: { date: sourceDate, role: sourceRole, memberIds: readIds(sourceDate, sourceRole) },
        target: { date: targetDate, role: targetRole, memberIds: readIds(targetDate, targetRole) }
      };
    }, { useCurrentRemote: true });
  }


  async setPlanningCellsAsAdmin(cells) {
    if (!Array.isArray(cells) || !cells.length) {
      return { ok: false, status: 400, error: 'Aucune modification à enregistrer.' };
    }
    if (cells.length > 200) {
      return { ok: false, status: 413, error: 'Trop de cellules dans un seul lot.' };
    }

    const final = new Map();
    for (const raw of cells) {
      const date = String(raw?.date || '');
      const role = String(raw?.role || '').toLowerCase();
      if (!isIsoDate(date)) return { ok: false, status: 400, error: 'Date invalide.' };
      if (!ALL_ROLE_KEYS.includes(role)) return { ok: false, status: 400, error: 'Position invalide.' };

      const ids = [...new Set(
        (Array.isArray(raw?.memberIds) ? raw.memberIds : [])
          .map((id) => String(id || '').trim())
          .filter(Boolean)
      )];
      if (role !== 'present' && ids.length > 1) {
        return { ok: false, status: 400, error: 'Un poste principal ne peut contenir qu’un seul membre.' };
      }
      final.set(`${date}|${role}`, { date, role, memberIds: ids });
    }
    const desired = [...final.values()];

    return this.mutate((s) => {
      const active = new Map(s.members.filter((m) => m.active).map((m) => [m.id, m]));

      /* Validation de tout le lot avant écriture. */
      for (const cell of desired) {
        const horizon = validatePlanningHorizonDate(cell.date, this.now());
        if (!horizon.ok) return horizon;
        if (!effectiveIsOpen(s, cell.date)) {
          return { ok: false, status: 409, error: `Le club n'est pas ouvert le ${cell.date}.` };
        }
        for (const id of cell.memberIds) {
          if (!active.has(id)) return { ok: false, status: 404, error: 'Un membre du lot n’est plus actif.' };
        }
      }

      const readIds = (date, role) => {
        if (role === 'present') {
          return Array.isArray(s.attendance[date])
            ? [...new Set(s.attendance[date].map(String))]
            : [];
        }
        const roles = s.roleAssignments?.[date] || {};
        return Array.isArray(roles[role])
          ? [...new Set(roles[role].map(String))]
          : [];
      };

      const desiredMap = new Map(desired.map((cell) => [`${cell.date}|${cell.role}`, cell]));
      const touchedDates = [...new Set(desired.map((cell) => cell.date))];
      for (const date of touchedDates) {
        const projectedCore = new Set();
        for (const role of ROLE_KEYS) {
          const pending = desiredMap.get(`${date}|${role}`);
          const ids = pending ? pending.memberIds : readIds(date, role);
          for (const id of ids) projectedCore.add(String(id));
        }
        const presentCell = desiredMap.get(`${date}|present`);
        if (presentCell) {
          const conflict = presentCell.memberIds.find((id) => projectedCore.has(String(id)));
          if (conflict) {
            return {
              ok: false,
              status: 409,
              error: `${active.get(conflict)?.displayName || 'Ce membre'} possède déjà un rôle pour cette journée et ne peut pas être également disponible.`
            };
          }
        }
      }

      const writeIds = (date, role, nextIds) => {
        const next = [...new Set((nextIds || []).map(String).filter(Boolean))];
        const old = readIds(date, role);

        if (role === 'present') {
          if (next.length && !Object.hasOwn(s.attendance, date) && Object.keys(s.attendance).length >= 5000) {
            return { ok: false, status: 409, error: 'Limite de dates de disponibilité atteinte.' };
          }
          for (const oldId of old) {
            if (next.includes(oldId)) continue;
            const m = s.members.find((x) => x.id === oldId);
            this.#log(s, 'Administrateur', 'admin_retrait', date, {
              memberId: oldId, name: m?.displayName || '', batched: true
            });
          }
          for (const newId of next) {
            if (old.includes(newId)) continue;
            const m = active.get(newId);
            this.#log(s, 'Administrateur', 'admin_inscription', date, {
              memberId: newId, name: m?.displayName || '', batched: true
            });
          }
          if (next.length) s.attendance[date] = next;
          else delete s.attendance[date];
          return { ok: true, oldIds: old, memberIds: next };
        }

        if (next.length && !Object.hasOwn(s.roleAssignments, date) && Object.keys(s.roleAssignments).length >= 5000) {
          return { ok: false, status: 409, error: 'Limite de dates de rôles atteinte.' };
        }

        if (next.length) {
          const available = readIds(date, 'present');
          const filteredAvailable = available.filter((id) => !next.includes(String(id)));
          if (filteredAvailable.length !== available.length) {
            for (const removedId of available.filter((id) => !filteredAvailable.includes(id))) {
              const m = s.members.find((x) => x.id === removedId);
              this.#log(s, 'Administrateur', 'admin_retrait', date, {
                memberId: removedId,
                name: m?.displayName || '',
                batched: true,
                automatic: true,
                reason: 'role_assignment'
              });
            }
            if (filteredAvailable.length) s.attendance[date] = filteredAvailable;
            else delete s.attendance[date];
          }
        }

        const roles = s.roleAssignments[date] && typeof s.roleAssignments[date] === 'object'
          ? clone(s.roleAssignments[date])
          : {};

        for (const oldId of old) {
          if (next.includes(oldId)) continue;
          const m = s.members.find((x) => x.id === oldId);
          this.#log(s, 'Administrateur', 'admin_role_retrait', date, {
            memberId: oldId, name: m?.displayName || '', role, batched: true
          });
        }
        for (const newId of next) {
          if (old.includes(newId)) continue;
          const m = active.get(newId);
          this.#log(s, 'Administrateur', 'admin_role_inscription', date, {
            memberId: newId, name: m?.displayName || '', role, batched: true
          });
        }

        if (next.length) roles[role] = next;
        else delete roles[role];
        if (Object.keys(roles).length) s.roleAssignments[date] = roles;
        else delete s.roleAssignments[date];

        return { ok: true, oldIds: old, memberIds: next };
      };

      const results = [];
      for (const cell of desired) {
        const r = writeIds(cell.date, cell.role, cell.memberIds);
        if (!r.ok) return r;
        results.push({
          date: cell.date,
          role: cell.role,
          memberIds: r.memberIds,
          changed: JSON.stringify(r.oldIds) !== JSON.stringify(r.memberIds)
        });
      }

      return {
        ok: true,
        batched: true,
        changedCount: results.filter((r) => r.changed).length,
        cells: results
      };
    }, { useCurrentRemote: true });
  }

  async setCellAssignmentAsAdmin(date, role, memberId, memberIds = null) {
    const horizon = validatePlanningHorizonDate(date, this.now());
    if (!horizon.ok) return horizon;
    role = String(role || '').toLowerCase();
    if (!ALL_ROLE_KEYS.includes(role)) return { ok: false, status: 400, error: 'Position invalide.' };
    memberId = String(memberId || '').trim();
    const requestedAvailable = role === 'present'
      ? [...new Set((Array.isArray(memberIds) ? memberIds : (memberId ? [memberId] : [])).map((id) => String(id || '').trim()).filter(Boolean))]
      : [];

    return this.mutate((s) => {
      if (!effectiveIsOpen(s, date)) return { ok: false, status: 409, error: "Le club n'est pas ouvert ce jour-là." };

      const active = new Map(s.members.filter((m) => m.active).map((m) => [m.id, m]));
      if (role === 'present') {
        for (const id of requestedAvailable) {
          if (!active.has(id)) return { ok: false, status: 404, error: 'Membre actif introuvable pour Disponible.' };
        }
      } else if (memberId && !active.has(memberId)) {
        return { ok: false, status: 404, error: 'Membre actif introuvable.' };
      }

      if (role === 'present') {
        const roles = s.roleAssignments?.[date] || {};
        const coreIds = new Set(ROLE_KEYS.flatMap((r) => Array.isArray(roles[r]) ? roles[r].map(String) : []));
        const conflict = requestedAvailable.find((id) => coreIds.has(String(id)));
        if (conflict) {
          return {
            ok: false,
            status: 409,
            error: `${active.get(conflict)?.displayName || 'Ce membre'} possède déjà un rôle pour cette journée et ne peut pas être également disponible.`
          };
        }
      }

      const nextIds = role === 'present' ? requestedAvailable : (memberId ? [memberId] : []);
      let changed = false;

      if (role === 'present') {
        if (nextIds.length && !Object.hasOwn(s.attendance, date) && Object.keys(s.attendance).length >= 5000) {
          return { ok: false, status: 409, error: 'Limite de dates de disponibilité atteinte. Archivez ou nettoyez les anciennes données.' };
        }
        const oldIds = Array.isArray(s.attendance[date]) ? [...new Set(s.attendance[date].map(String))] : [];
        for (const oldId of oldIds) {
          if (nextIds.includes(oldId)) continue;
          const member = s.members.find((m) => m.id === oldId);
          this.#log(s, 'Administrateur', 'admin_retrait', date, { memberId: oldId, name: member?.displayName || '' });
          changed = true;
        }
        for (const newId of nextIds) {
          if (oldIds.includes(newId)) continue;
          const member = active.get(newId);
          this.#log(s, 'Administrateur', 'admin_inscription', date, { memberId: newId, name: member.displayName });
          changed = true;
        }
        if (nextIds.length) s.attendance[date] = nextIds;
        else delete s.attendance[date];
        return { ok: true, changed, role, memberIds: nextIds };
      }

      if (memberId && !Object.hasOwn(s.roleAssignments, date) && Object.keys(s.roleAssignments).length >= 5000) {
        return { ok: false, status: 409, error: 'Limite de dates de rôles atteinte. Archivez ou nettoyez les anciennes données.' };
      }

      if (memberId) {
        const available = new Set(Array.isArray(s.attendance[date]) ? s.attendance[date].map(String) : []);
        if (available.delete(memberId)) {
          if (available.size) s.attendance[date] = [...available];
          else delete s.attendance[date];
          const member = active.get(memberId);
          this.#log(s, 'Administrateur', 'admin_retrait', date, {
            memberId,
            name: member?.displayName || '',
            automatic: true,
            reason: 'role_assignment'
          });
          changed = true;
        }
      }

      const roles = s.roleAssignments[date] && typeof s.roleAssignments[date] === 'object'
        ? clone(s.roleAssignments[date])
        : {};
      const oldIds = Array.isArray(roles[role]) ? [...new Set(roles[role].map(String))] : [];

      for (const oldId of oldIds) {
        if (nextIds.includes(oldId)) continue;
        const member = s.members.find((m) => m.id === oldId);
        this.#log(s, 'Administrateur', 'admin_role_retrait', date, { memberId: oldId, name: member?.displayName || '', role });
        changed = true;
      }
      for (const newId of nextIds) {
        if (oldIds.includes(newId)) continue;
        const member = active.get(newId);
        this.#log(s, 'Administrateur', 'admin_role_inscription', date, { memberId: newId, name: member.displayName, role });
        changed = true;
      }

      if (nextIds.length) roles[role] = nextIds;
      else delete roles[role];

      if (Object.keys(roles).length) s.roleAssignments[date] = roles;
      else delete s.roleAssignments[date];

      return { ok: true, changed, role, memberId };
    }, { useCurrentRemote: true });
  }

  async setDayAssignmentsAsAdmin(date, assignments) {
    const horizon = validatePlanningHorizonDate(date, this.now());
    if (!horizon.ok) return horizon;
    const raw = assignments && typeof assignments === 'object' ? assignments : {};
    const desired = Object.fromEntries(ROLE_KEYS.map((role) => [role, String(raw[role] || '').trim()]));
    desired.present = [...new Set(
      (Array.isArray(raw.present) ? raw.present : (raw.present ? [raw.present] : []))
        .map((id) => String(id || '').trim())
        .filter(Boolean)
    )];

    return this.mutate((s) => {
      if (!effectiveIsOpen(s, date)) return { ok: false, status: 409, error: "Le club n'est pas ouvert ce jour-là." };

      const active = new Map(s.members.filter((m) => m.active).map((m) => [m.id, m]));
      for (const role of ROLE_KEYS) {
        const id = desired[role];
        if (id && !active.has(id)) return { ok: false, status: 404, error: `Membre actif introuvable pour ${role}.` };
      }
      for (const id of desired.present) {
        if (!active.has(id)) return { ok: false, status: 404, error: 'Membre actif introuvable pour Disponible.' };
      }

      const desiredCoreIds = new Set(ROLE_KEYS.map((role) => desired[role]).filter(Boolean));
      const availabilityConflict = desired.present.find((id) => desiredCoreIds.has(String(id)));
      if (availabilityConflict) {
        return {
          ok: false,
          status: 409,
          error: `${active.get(availabilityConflict)?.displayName || 'Ce membre'} possède déjà un rôle pour cette journée et ne peut pas être également disponible.`
        };
      }

      const wantsRoles = ROLE_KEYS.some((role) => desired[role]);
      if (wantsRoles && !Object.hasOwn(s.roleAssignments, date) && Object.keys(s.roleAssignments).length >= 5000) {
        return { ok: false, status: 409, error: 'Limite de dates de rôles atteinte. Archivez ou nettoyez les anciennes données.' };
      }
      if (desired.present.length && !Object.hasOwn(s.attendance, date) && Object.keys(s.attendance).length >= 5000) {
        return { ok: false, status: 409, error: 'Limite de dates de disponibilité atteinte. Archivez ou nettoyez les anciennes données.' };
      }

      let changed = false;
      const previousRoles = s.roleAssignments[date] && typeof s.roleAssignments[date] === 'object' ? clone(s.roleAssignments[date]) : {};
      const nextRoles = { ...previousRoles };

      for (const role of ROLE_KEYS) {
        const oldIds = Array.isArray(previousRoles[role]) ? [...new Set(previousRoles[role].map(String))] : [];
        const newIds = desired[role] ? [desired[role]] : [];

        for (const oldId of oldIds) {
          if (newIds.includes(oldId)) continue;
          const member = s.members.find((m) => m.id === oldId);
          this.#log(s, 'Administrateur', 'admin_role_retrait', date, { memberId: oldId, name: member?.displayName || '', role });
          changed = true;
        }
        for (const newId of newIds) {
          if (oldIds.includes(newId)) continue;
          const member = active.get(newId);
          this.#log(s, 'Administrateur', 'admin_role_inscription', date, { memberId: newId, name: member.displayName, role });
          changed = true;
        }

        if (newIds.length) nextRoles[role] = newIds;
        else delete nextRoles[role];
      }

      if (Object.keys(nextRoles).length) s.roleAssignments[date] = nextRoles;
      else delete s.roleAssignments[date];

      const oldPresent = Array.isArray(s.attendance[date]) ? [...new Set(s.attendance[date].map(String))] : [];
      const newPresent = desired.present;

      for (const oldId of oldPresent) {
        if (newPresent.includes(oldId)) continue;
        const member = s.members.find((m) => m.id === oldId);
        this.#log(s, 'Administrateur', 'admin_retrait', date, { memberId: oldId, name: member?.displayName || '' });
        changed = true;
      }
      for (const newId of newPresent) {
        if (oldPresent.includes(newId)) continue;
        const member = active.get(newId);
        this.#log(s, 'Administrateur', 'admin_inscription', date, { memberId: newId, name: member.displayName });
        changed = true;
      }

      if (newPresent.length) s.attendance[date] = newPresent;
      else delete s.attendance[date];

      return { ok: true, changed, assignments: desired };
    }, { useCurrentRemote: true });
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
    const horizon = validatePlanningHorizonDate(date, this.now());
    if (!horizon.ok) return horizon;
    return this.mutate((s) => {
      const member = s.members.find((m) => m.id === memberId && m.active);
      if (!member) return { ok: false, status: 404, error: 'Membre actif introuvable.' };
      if (!effectiveIsOpen(s, date)) return { ok: false, status: 409, error: "Le club n'est pas ouvert ce jour-là." };
      return this.#setAttendanceInState(s, member, date, present, 'Administrateur', present ? 'admin_inscription' : 'admin_retrait');
    });
  }

  #setAttendanceInState(s, member, date, present, actor, action) {
    if (present) {
      const roles = s.roleAssignments?.[date] || {};
      const assignedRole = ROLE_KEYS.find((role) =>
        Array.isArray(roles[role]) && roles[role].map(String).includes(String(member.id))
      );
      if (assignedRole) {
        return {
          ok: false,
          status: 409,
          error: `${member.displayName} possède déjà un rôle pour cette journée et ne peut pas être également disponible.`
        };
      }
    }
    if (present && !Object.hasOwn(s.attendance, date) && Object.keys(s.attendance).length >= 5000) {
      return { ok: false, status: 409, error: 'Limite de dates de présence atteinte. Archivez ou nettoyez les anciennes données.' };
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

  async createMember(name, email) {
    const clean = sanitizeName(name);
    const cleanEmail = sanitizeEmail(email);
    if (!clean) return { ok: false, status: 400, error: 'Nom invalide.' };
    if (!cleanEmail) return { ok: false, status: 400, error: 'Adresse email invalide.' };
    const raw = randomToken();
    const id = `m_${randomToken(12)}`;
    return this.mutate((s) => {
      if (s.members.length >= 500) return { ok: false, status: 409, error: 'Limite de membres atteinte.' };
      const member = { id, displayName: clean, email: cleanEmail, active: true, adminPrivilege: false, createdAt: this.now().toISOString() };
      s.members.push(member);
      const short = this.#newShortPersonalToken(s, clean);
      s.memberTokens.push({ id: `t_${randomToken(10)}`, memberId: id, tokenHash: tokenHash(raw), shortTokenHash: short.hash, shortTokenEnc: encryptMemberShortToken(short.raw), active: true, createdAt: this.now().toISOString(), revokedAt: null });
      this.#cleanupMemberTokens(s);
      this.#log(s, 'Administrateur', 'membre_cree', null, { memberId: id, name: clean });
      return { ok: true, member: { id, name: clean, email: cleanEmail }, rawToken: raw, shortToken: short.raw };
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

  async setMemberEmail(memberId, email) {
    const clean = sanitizeEmail(email);
    if (!clean) return { ok: false, status: 400, error: 'Adresse email invalide.' };
    return this.mutate((s) => {
      const m = s.members.find((x) => x.id === memberId);
      if (!m) return { ok: false, status: 404, error: 'Membre introuvable.' };
      const before = m.email || '';
      m.email = clean;
      if (before !== clean) this.#log(s, 'Administrateur', 'email_membre_modifie', null, { memberId, name: m.displayName });
      return { ok: true };
    });
  }

  async setMemberAdminPrivilege(memberId, enabled) {
    const requested = enabled === true;
    return this.mutate((s) => {
      const m = s.members.find((x) => x.id === memberId);
      if (!m) return { ok: false, status: 404, error: 'Membre introuvable.' };
      const before = m.adminPrivilege === true;
      if (before === requested) return { ok: true, changed: false };
      m.adminPrivilege = requested;
      let revokedAdminSessions = 0;
      if (!requested) {
        const nowIso = this.now().toISOString();
        for (const rec of s.sessions) {
          if (rec.kind === 'admin' && rec.sourceMemberId === memberId && rec.active) {
            rec.active = false;
            rec.revokedAt = nowIso;
            revokedAdminSessions += 1;
          }
        }
      }
      this.#log(
        s,
        'Administrateur',
        requested ? 'privilege_admin_accorde' : 'privilege_admin_retire',
        null,
        { memberId, name: m.displayName, revokedAdminSessions }
      );
      return { ok: true, changed: true, adminPrivilege: requested, revokedAdminSessions };
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
      let short = null;
      if (requested) {
        short = this.#newShortPersonalToken(s, m.displayName);
        s.memberTokens.push({ id: `t_${randomToken(10)}`, memberId, tokenHash: tokenHash(raw), shortTokenHash: short.hash, shortTokenEnc: encryptMemberShortToken(short.raw), active: true, createdAt: this.now().toISOString(), revokedAt: null });
        this.#cleanupMemberTokens(s);
      }
      this.#log(s, 'Administrateur', requested ? 'membre_reactive' : 'membre_desactive', null, { memberId, name: m.displayName, futureAttendanceRemoved });
      return { ok: true, changed: true, member: { id: m.id, name: m.displayName }, rawToken: requested ? raw : undefined, shortToken: requested ? short.raw : undefined, futureAttendanceRemoved };
    });
  }

  async setMembersActiveBatch(changes) {
    if (!Array.isArray(changes) || !changes.length) return { ok: false, status: 400, error: 'Aucune modification à appliquer.' };
    if (changes.length > 50) return { ok: false, status: 400, error: 'Trop de modifications groupées.' };

    const lastByMember = new Map();
    for (const change of changes) {
      const memberId = String(change?.memberId || '').trim();
      if (!memberId) return { ok: false, status: 400, error: 'Membre invalide.' };
      lastByMember.set(memberId, { memberId, active: !!change.active });
    }
    const normalized = [...lastByMember.values()];

    return this.mutate((s) => {
      for (const change of normalized) {
        if (!s.members.some((m) => m.id === change.memberId)) {
          return { ok: false, status: 404, error: 'Membre introuvable.' };
        }
      }

      const nowIso = this.now().toISOString();
      const today = parisToday(this.now());
      const results = [];
      let generatedLink = false;

      for (const change of normalized) {
        const m = s.members.find((x) => x.id === change.memberId);
        const requested = !!change.active;
        const before = !!m.active;
        if (before === requested) {
          results.push({ memberId: m.id, active: requested, changed: false });
          continue;
        }

        m.active = requested;
        for (const t of s.memberTokens.filter((t) => t.memberId === m.id && t.active)) {
          t.active = false;
          t.revokedAt = nowIso;
        }
        this.#revokeMemberSessions(s, m.id);

        let futureAttendanceRemoved = 0;
        if (!requested) {
          for (const [date, ids] of Object.entries(s.attendance || {})) {
            if (date < today || !Array.isArray(ids) || !ids.includes(m.id)) continue;
            const nextIds = ids.filter((id) => id !== m.id);
            this.#log(s, 'Administrateur', 'presence_retiree_desactivation', date, { memberId: m.id, name: m.displayName });
            if (nextIds.length) s.attendance[date] = nextIds; else delete s.attendance[date];
            futureAttendanceRemoved += 1;
          }
          for (const [date, roles] of Object.entries(s.roleAssignments || {})) {
            if (date < today || !roles || typeof roles !== 'object') continue;
            let changedDay = false;
            for (const role of ROLE_KEYS) {
              const ids = Array.isArray(roles[role]) ? roles[role] : [];
              if (!ids.includes(m.id)) continue;
              const nextIds = ids.filter((id) => id !== m.id);
              this.#log(s, 'Administrateur', 'role_retire_desactivation', date, { memberId: m.id, name: m.displayName, role });
              if (nextIds.length) roles[role] = nextIds; else delete roles[role];
              futureAttendanceRemoved += 1;
              changedDay = true;
            }
            if (changedDay && !Object.keys(roles).length) delete s.roleAssignments[date];
          }
        } else {
          const raw = randomToken();
          const short = this.#newShortPersonalToken(s, m.displayName);
          s.memberTokens.push({
            id: `t_${randomToken(10)}`,
            memberId: m.id,
            tokenHash: tokenHash(raw),
            shortTokenHash: short.hash,
            shortTokenEnc: encryptMemberShortToken(short.raw),
            active: true,
            createdAt: nowIso,
            revokedAt: null
          });
          generatedLink = true;
        }

        this.#log(s, 'Administrateur', requested ? 'membre_reactive' : 'membre_desactive', null, {
          memberId: m.id,
          name: m.displayName,
          futureAttendanceRemoved,
          batched: true
        });
        results.push({ memberId: m.id, active: requested, changed: true, futureAttendanceRemoved });
      }

      if (generatedLink) this.#cleanupMemberTokens(s);
      return { ok: true, changedCount: results.filter((r) => r.changed).length, results };
    }, { useCurrentRemote: true });
  }

  async rotateAllActiveTokens() {
    return this.mutate((s) => {
      const activeMembers = s.members.filter((m) => m.active);
      if (!activeMembers.length) {
        return { ok: false, status: 409, error: 'Aucun membre actif.' };
      }

      const nowIso = this.now().toISOString();
      let sessionsRevoked = 0;
      const results = [];

      /* Un seul commit pour l'ensemble : tous les liens sont renouvelés
         ensemble ou aucun changement n'est persisté. */
      for (const m of activeMembers) {
        for (const t of s.memberTokens.filter((t) => t.memberId === m.id && t.active)) {
          t.active = false;
          t.revokedAt = nowIso;
        }

        sessionsRevoked += this.#revokeMemberSessions(s, m.id);

        const raw = randomToken();
        const short = this.#newShortPersonalToken(s, m.displayName);
        s.memberTokens.push({
          id: `t_${randomToken(10)}`,
          memberId: m.id,
          tokenHash: tokenHash(raw),
          shortTokenHash: short.hash,
          shortTokenEnc: encryptMemberShortToken(short.raw),
          active: true,
          createdAt: nowIso,
          revokedAt: null
        });

        this.#log(s, 'Administrateur', 'lien_regenere', null, {
          memberId: m.id,
          name: m.displayName,
          bulk: true
        });

        results.push({
          memberId: m.id,
          name: m.displayName,
          shortToken: short.raw
        });
      }

      this.#cleanupMemberTokens(s);
      this.#log(s, 'Administrateur', 'liens_regeneres_globalement', null, {
        regenerated: results.length,
        sessionsRevoked,
        inactiveSkipped: s.members.length - activeMembers.length
      });

      return {
        ok: true,
        regenerated: results.length,
        inactiveSkipped: s.members.length - activeMembers.length,
        sessionsRevoked,
        results
      };
    }, { useCurrentRemote: true });
  }

  memberPersonalLinkPayload(memberId) {
    const member = this.state.members.find((m) => m.id === memberId);
    if (!member) return { ok: false, status: 404, error: 'Membre introuvable.' };
    if (!member.active) return { ok: false, status: 409, error: 'Ce membre est inactif.' };
    if (!String(member.email || '').trim()) {
      return { ok: false, status: 409, error: 'Aucune adresse email renseignée pour ce membre.' };
    }

    const token = this.state.memberTokens.find((t) => t.memberId === memberId && t.active) || null;
    const shortToken = token?.shortTokenEnc ? decryptMemberShortToken(token.shortTokenEnc) : null;
    if (!shortToken) {
      return { ok: false, status: 409, error: 'Le lien personnel actuel est indisponible.' };
    }

    return {
      ok: true,
      memberId: member.id,
      memberName: member.displayName,
      email: member.email,
      personalUrl: memberShortPublicUrl(shortToken)
    };
  }

  async rotateToken(memberId) {
    const raw = randomToken();
    return this.mutate((s) => {
      const m = s.members.find((x) => x.id === memberId && x.active);
      if (!m) return { ok: false, status: 404, error: 'Membre actif introuvable.' };
      for (const t of s.memberTokens.filter((t) => t.memberId === memberId && t.active)) { t.active = false; t.revokedAt = this.now().toISOString(); }
      this.#revokeMemberSessions(s, memberId);
      const short = this.#newShortPersonalToken(s, m.displayName);
      s.memberTokens.push({ id: `t_${randomToken(10)}`, memberId, tokenHash: tokenHash(raw), shortTokenHash: short.hash, shortTokenEnc: encryptMemberShortToken(short.raw), active: true, createdAt: this.now().toISOString(), revokedAt: null });
      this.#cleanupMemberTokens(s);
      this.#log(s, 'Administrateur', 'lien_regenere', null, { memberId, name: m.displayName });
      return { ok: true, member: { id: m.id, name: m.displayName, email: m.email }, rawToken: raw, shortToken: short.raw };
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
const APP_VERSION = '0.15.45.3-cleanup-vercel-autodetect-fix';
const demoMode = process.env.DEMO_MODE === '1';
const isVercelRuntime = process.env.VERCEL === '1';
const listenHost = String(process.env.LISTEN_HOST || (demoMode ? '127.0.0.1' : '')).trim();
let demoRootHits = 0;
const trustProxy = isVercelRuntime || ['1', 'true', 'yes'].includes(String(process.env.TRUST_PROXY || '').toLowerCase());
const adminToken = process.env.ADMIN_TOKEN || (demoMode ? 'demo-admin-V1' : '');
const configuredAdminHash = String(process.env.ADMIN_TOKEN_SHA256 || '').trim().toLowerCase();
const adminCode = String(process.env.ADMIN_CODE || '').trim();
const memberShortSecret = String(process.env.MEMBER_SHORT_SECRET || '').trim();

function configurationError(message) {
  if (isMainModule(import.meta.url)) {
    console.error(message);
    process.exit(2);
  }
  throw new Error(message);
}

if (configuredAdminHash && !/^[a-f0-9]{64}$/.test(configuredAdminHash)) {
  configurationError('ADMIN_TOKEN_SHA256 doit être une empreinte SHA-256 hexadécimale de 64 caractères.');
}
if (isVercelRuntime && !process.env.BLOB_READ_WRITE_TOKEN && !process.env.BLOB_STORE_ID) {
  configurationError('Vercel Blob n’est pas connecté : créez un Blob privé dans le projet et connectez-le à CalasOrga.');
}

const adminTokenHash = configuredAdminHash || (adminToken ? tokenHash(adminToken) : '');
if (adminCode && (Array.from(adminCode).length !== 6 || /[\r\n\t]/.test(adminCode))) {
  configurationError('ADMIN_CODE doit contenir exactement 6 caractères visibles.');
}
const adminCodeHash = adminCode ? tokenHash(`admin-code-v1:${adminCode}`) : '';
if (memberShortSecret && memberShortSecret.length < 32) {
  configurationError('MEMBER_SHORT_SECRET doit contenir au moins 32 caractères.');
}
// Depuis V15.7 : les liens courts membres utilisent un secret indépendant des identifiants admin.
// Le pepper historique reste accepté uniquement pour que les liens V15.6 déjà distribués
// continuent de fonctionner pendant la transition.
const legacyMemberShortPepper = crypto.createHash('sha256')
  .update(`member-short-pepper-v1:${adminTokenHash || adminCodeHash}`, 'utf8')
  .digest();
const memberShortPepper = memberShortSecret
  ? crypto.createHash('sha256').update(`member-short-secret-v1:${memberShortSecret}`, 'utf8').digest()
  : legacyMemberShortPepper;
const memberShortSecretMode = memberShortSecret ? 'dedicated' : 'legacy-fallback';
if (!demoMode && !memberShortSecret) {
  console.warn('MEMBER_SHORT_SECRET absent : compatibilité V15.6 active. Configurez un secret dédié d’au moins 32 caractères.');
}
const adminCredentialTag = (adminTokenHash || adminCodeHash)
  ? tokenHash(`admin-credential-v2:${adminTokenHash}:${adminCodeHash}`).slice(0, 32)
  : '';
const now = process.env.NODE_ENV === 'test' && process.env.NOW_OVERRIDE ? () => new Date(process.env.NOW_OVERRIDE) : () => new Date();

if (!adminTokenHash && !adminCodeHash) {
  configurationError('ADMIN_TOKEN/ADMIN_TOKEN_SHA256 ou ADMIN_CODE est obligatoire hors DEMO_MODE.');
}
if (!demoMode && adminTokenHash && !configuredAdminHash && adminToken.length < 24) {
  configurationError('ADMIN_TOKEN est trop court : utilisez au moins 24 caractères, ou de préférence ADMIN_TOKEN_SHA256.');
}

const store = await new FileStore(dataFile, { now }).init(demoMode ? makeDemoSeed(now()) : null);

const rate = new Map();
function limited(key, max = 60, windowMs = 60_000) {
  const t = Date.now(); const row = rate.get(key) || { start: t, n: 0 };
  if (t - row.start > windowMs) { row.start = t; row.n = 0; }
  row.n += 1; rate.set(key, row); return row.n > max;
}
if (!isVercelRuntime) {
  setInterval(() => { const t = Date.now(); for (const [k, v] of rate) if (t - v.start > 5 * 60_000) rate.delete(k); }, 5 * 60_000).unref();
  setInterval(() => { store.maintenance().catch((err) => console.error('Maintenance stockage:', err)); }, 60 * 60_000).unref();
}

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
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
  return /[;"\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
function planningCsv(snapshot, from, to) {
  const dates = isoDateRange(from, to, 366);
  if (!dates) return null;
  const names = Object.fromEntries((snapshot.members || []).map((m) => [m.id, m.name]));
  const rows = [['Date', 'Jour', 'Accueil', 'TPE', 'MEP', 'Arbitrage', 'Disponible', 'Nombre disponibles', 'Postes pourvus', 'Postes requis', 'Couverture', 'Remarque']];
  for (const date of dates) {
    if (!effectiveIsOpen(snapshot, date)) continue;
    const dayAssignments = snapshot.assignments?.[date] || {};
    const presentIds = Array.isArray(dayAssignments.present) ? dayAssignments.present : (Array.isArray(snapshot.attendance?.[date]) ? snapshot.attendance[date] : []);
    const label = (role) => (Array.isArray(dayAssignments[role]) ? dayAssignments[role] : []).map((id) => names[id]).filter(Boolean).join(', ');
    const present = presentIds.map((id) => names[id]).filter(Boolean);
    const filledPosts = ROLE_KEYS.filter((role) => Array.isArray(dayAssignments[role]) && dayAssignments[role].length > 0).length;
    const [y, m, d] = date.split('-').map(Number);
    const day = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)));
    const note = snapshot.scheduleExceptions?.[date]?.note || '';
    rows.push([date, day, label('accueil'), label('tpe'), label('mep'), label('arbitrage'), present.join(', '), present.length, filledPosts, ROLE_KEYS.length, filledPosts === ROLE_KEYS.length ? 'Assurée' : 'À pourvoir', note]);
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

  // Vercel peut déjà avoir décodé le JSON avant d'appeler la fonction.
  if (req.body !== undefined && req.body !== null) {
    if (Buffer.isBuffer(req.body)) {
      if (req.body.length > max) throw Object.assign(new Error('Corps trop volumineux.'), { status: 413 });
      req.body = req.body.toString('utf8');
    }
    if (typeof req.body === 'string') {
      if (Buffer.byteLength(req.body, 'utf8') > max) throw Object.assign(new Error('Corps trop volumineux.'), { status: 413 });
      try { req.body = req.body ? JSON.parse(req.body) : {}; } catch { throw Object.assign(new Error('JSON invalide.'), { status: 400 }); }
    }
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) throw Object.assign(new Error('Objet JSON requis.'), { status: 400 });
    return req.body;
  }

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
  const session = rawSession ? store.adminSessionInfo(rawSession, adminCredentialTag) : null;
  const context = rawSession ? store.adminSessionContext(rawSession, adminCredentialTag) : null;
  return { cookies, rawSession, ok: !!session, session, context };
}
function csrfCookie(name, secure, maxAge) { const token = randomToken(18); return { token, header: cookie(name, token, { httpOnly: false, secure, maxAge }) }; }

// Aucun fichier frontend ne doit être lu à l'import de la fonction Vercel.
 // Les pages et assets sont servis statiquement par Vercel ; Node/Docker les charge
 // uniquement à la demande, avec mise en cache après la première lecture.
 // Cela rend le bundle API autonome par rapport à index.html/styles.css/app.js.
 // Les assets externes ne doivent pas être lus à l'import de la fonction Vercel :
// ils sont servis statiquement par Vercel. En Node/Docker, on les charge à la demande
// et on les met en cache après la première lecture.
const staticAssetCache = new Map();
async function localStaticAsset(filename) {
  if (!staticAssetCache.has(filename)) {
    staticAssetCache.set(filename, fs.readFile(path.join(__dirname, filename)));
  }
  return staticAssetCache.get(filename);
}
function serveStatic(res, body, contentType) {
  securityHeaders(res);
  res.statusCode = 200;
  res.setHeader('Content-Type', contentType);
  res.end(body);
}
async function serveIndex(res) {
  return serveStatic(res, await localStaticAsset('index.html'), 'text/html; charset=utf-8');
}
async function serveLocalStaticFile(res, filename, contentType) {
  return serveStatic(res, await localStaticAsset(filename), contentType);
}

export async function requestHandler(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;
    if (pathname.startsWith('/api/') && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !browserMutationMetadataOk(req)) {
      return json(res, 403, { error: 'Requête intersite refusée.' });
    }
    const secure = requestIsHttps(req, { trustProxy });
    if (secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

    // Le HTML est statique : inutile de réveiller Blob avant même que le navigateur
    // appelle l'API. Cela accélère l'ouverture du lien et économise des opérations.
    if (pathname === '/robots.txt' && req.method === 'GET') { securityHeaders(res); res.statusCode = 200; res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.end('User-agent: *\nDisallow: /\n'); return; }
    if ((pathname === '/styles.css' || pathname === '/admin/styles.css') && req.method === 'GET') return serveLocalStaticFile(res, 'styles.css', 'text/css; charset=utf-8');
    if ((pathname === '/client.js' || pathname === '/admin/client.js') && req.method === 'GET') return serveLocalStaticFile(res, 'client.js', 'text/javascript; charset=utf-8');
    if (pathname === '/' && req.method === 'GET') {
      if (demoMode) demoRootHits += 1;
      return serveIndex(res);
    }
    if (
      (
        ['/calendar','/join','/join-short','/admin-login','/admin','/admin/membres','/admin/historique','/invalid'].includes(pathname)
        || /^\/admin\/(?:membres|historique)\/$/.test(pathname)
      )
      && req.method === 'GET'
    ) return serveIndex(res);


    // Connexions : une seule lecture Blob + une seule écriture principale. Les snapshots
    // auxiliaires ne sont pas réécrits pour une simple création de session.
    if (pathname === '/api/session/member' && req.method === 'POST') {
      if (limited(`member-login:${getIp(req)}`, 40)) return json(res, 429, { error: 'Trop de tentatives.' });
      if (!sameOriginRequestOk(req, { trustProxy })) return json(res, 403, { error: 'Origine de connexion invalide.' });
      const b = await bodyJson(req, 4096); const raw = String(b.token || '');
      const cookies = parseCookies(req.headers.cookie || '');
      const result = raw ? await store.loginMemberByRawToken(raw, cookies.club_session || '', MEMBER_SESSION_TTL_SECONDS, clientDeviceInfo(req)) : { ok: false, status: 401, error: 'Lien personnel invalide ou révoqué.' };
      if (!result.ok) return json(res, result.status, { error: result.error });
      const csrf = csrfCookie('club_member_csrf', secure, MEMBER_SESSION_TTL_SECONDS);
      return json(res, 200, { ok: true, member: result.member }, { 'Set-Cookie': [cookie('club_session', result.rawToken, { secure, maxAge: MEMBER_SESSION_TTL_SECONDS }), csrf.header] });
    }
    if (pathname === '/api/session/member-short' && req.method === 'POST') {
      const ip = getIp(req);
      if (limited(`member-short-login:${ip}`, 8, 15 * 60_000) || limited('member-short-login-global', 240, 15 * 60_000)) {
        return json(res, 429, { error: 'Trop de tentatives. Réessayez dans quelques minutes.' });
      }
      if (!sameOriginRequestOk(req, { trustProxy })) return json(res, 403, { error: 'Origine de connexion invalide.' });
      const b = await bodyJson(req, 4096);
      const raw = String(b.shortToken || '').trim().normalize('NFC');
      if (!/^[\p{L}\p{N}]{1,40}\d{6}$/u.test(raw)) return json(res, 401, { error: 'Lien personnel invalide ou révoqué.' });
      const prefix = raw.slice(0, -6).toLocaleLowerCase('fr-FR');
      if (limited(`member-short-name:${tokenHash(prefix).slice(0, 24)}`, 12, 60 * 60_000)) {
        return json(res, 429, { error: 'Trop de tentatives pour ce lien. Réessayez plus tard.' });
      }
      const cookies = parseCookies(req.headers.cookie || '');
      const result = await store.loginMemberByShortToken(raw, cookies.club_session || '', b.confirmSwitch === true, MEMBER_SESSION_TTL_SECONDS, clientDeviceInfo(req));
      if (!result.ok) return json(res, result.status, { ...result });
      const csrf = csrfCookie('club_member_csrf', secure, MEMBER_SESSION_TTL_SECONDS);
      return json(res, 200, { ok: true, member: result.member }, { 'Set-Cookie': [cookie('club_session', result.rawToken, { secure, maxAge: MEMBER_SESSION_TTL_SECONDS }), csrf.header] });
    }
    if (pathname === '/api/session/admin' && req.method === 'POST') {
      const ip = getIp(req);
      if (limited(`admin-login:${ip}`, 8, 10 * 60_000) || limited('admin-login-global', 80, 10 * 60_000)) {
        return json(res, 429, { error: 'Trop de tentatives. Réessayez dans quelques minutes.' });
      }
      if (!sameOriginRequestOk(req, { trustProxy })) return json(res, 403, { error: 'Origine de connexion invalide.' });
      const b = await bodyJson(req, 4096);
      const raw = String(b.token || '');
      const code = String(b.code || '').trim();
      const tokenOk = !!(raw && adminTokenHash && timingSafeHexEqual(tokenHash(raw), adminTokenHash));
      const codeOk = !!(code && adminCodeHash && timingSafeHexEqual(tokenHash(`admin-code-v1:${code}`), adminCodeHash));
      if (!tokenOk && !codeOk) return json(res, 401, { error: 'Code administrateur incorrect.' });
      const session = await store.createAdminSession(60 * 60 * 8, adminCredentialTag);
      const csrf = csrfCookie('club_admin_csrf', secure, 60 * 60 * 8);
      return json(res, 200, { ok: true, loginMode: codeOk ? 'code' : 'recovery-token' }, { 'Set-Cookie': [cookie('club_admin', session.rawToken, { secure, maxAge: 60 * 60 * 8 }), csrf.header] });
    }

    // Les routes qui lisent ou modifient l'état partagé partent toujours d'une vue
    // récente. Le chemin Blob conservateur courant utilise HEAD + GET.
    await store.refresh();

    if (pathname === '/healthz' && req.method === 'GET') {
      const integrity = store.integrityReport();
      return json(res, 200, { ok: true, appVersion: APP_VERSION, storage: store.remoteBlob ? 'vercel-blob' : 'file', integrity: integrity.ok, memberShortSecretMode });
    }
    if (pathname === '/readyz' && req.method === 'GET') {
      const integrity = store.integrityReport();
      return json(res, integrity.ok ? 200 : 503, { ok: integrity.ok, appVersion: APP_VERSION, storage: store.remoteBlob ? 'vercel-blob' : 'file', memberShortSecretMode });
    }
    if (pathname === '/api/demo/launch-state' && req.method === 'GET' && demoMode) return json(res, 200, { pageHits: demoRootHits });


    if (pathname === '/api/session/admin-from-member' && req.method === 'POST') {
      const m = sessionMember(req);
      if (!m.member) return json(res, 401, { error: 'Session membre invalide.' });
      if (!sameOriginCsrfOk(req, m.cookies, 'club_member_csrf')) {
        return json(res, 403, { error: 'Protection de session invalide.' });
      }
      if (m.member.adminPrivilege !== true) {
        return json(res, 403, { error: 'Privilèges administrateur requis.' });
      }

      /* Si ce navigateur possède déjà une session admin issue du même
         membre, ne rien réécrire dans Blob : on réutilise la session et on
         renvoie directement les données du panneau. */
      const existingAdminRaw = m.cookies.club_admin || '';
      const existingContext = existingAdminRaw
        ? store.adminSessionContext(existingAdminRaw, adminCredentialTag)
        : null;

      if (
        existingContext?.fromMember === true &&
        existingContext.memberId === m.member.id
      ) {
        return json(res, 200, {
          ...store.adminSnapshot(),
          adminContext: existingContext,
          sessionReused: true
        });
      }

      /* L'utilisateur est déjà authentifié comme membre admin : cette limite
         protège seulement contre une boucle accidentelle, pas contre un brute force. */
      if (limited(`member-admin-switch:${m.member.id}`, 120, 60_000)) {
        return json(res, 429, { error: 'Trop de bascules en peu de temps.' });
      }

      const session = await store.createAdminSession(60 * 60 * 8, adminCredentialTag, m.member.id);
      if (!session.ok) {
        return json(res, session.status || 403, {
          error: session.error || 'Privilèges administrateur requis.'
        });
      }

      const adminContext = {
        fromMember: true,
        memberId: m.member.id,
        name: m.member.displayName
      };
      const csrf = csrfCookie('club_admin_csrf', secure, 60 * 60 * 8);

      /* Une seule réponse fournit à la fois les cookies de session et
         l'intégralité du snapshot admin : aucun GET /api/admin supplémentaire. */
      return json(
        res,
        200,
        {
          ...store.adminSnapshot(),
          adminContext,
          sessionReused: false
        },
        {
          'Set-Cookie': [
            cookie('club_admin', session.rawToken, { secure, maxAge: 60 * 60 * 8 }),
            csrf.header
          ]
        }
      );
    }

    if (pathname === '/api/me' && req.method === 'GET') {
      const { member } = sessionMember(req); if (!member) return json(res, 401, { error: 'Lien personnel invalide ou expiré.' });
      return json(res, 200, store.memberSnapshot(member.id));
    }
    if (pathname === '/api/me/attendance' && (req.method === 'POST' || req.method === 'DELETE')) {
      const { member, cookies, rawSession } = sessionMember(req); if (!member) return json(res, 401, { error: 'Session invalide.' });
      if (!sameOriginCsrfOk(req, cookies, 'club_member_csrf')) return json(res, 403, { error: 'Protection de session invalide.' });
      if (limited(`member-write:${member.id}`, 30)) return json(res, 429, { error: 'Trop de modifications en peu de temps. Réessayez dans une minute.' });
      const body = req.method === 'POST' ? await bodyJson(req) : { date: url.searchParams.get('date') };
      const result = await store.setAttendance(member.id, body.date, req.method === 'POST');
      if (!result.ok) return json(res, result.status, { error: result.error });
      return json(res, 200, { ...result, snapshot: store.memberSnapshot(member.id) });
    }
    if (pathname === '/api/me/assignments-batch' && req.method === 'POST') {
      const { member, cookies } = sessionMember(req);
      if (!member) return json(res, 401, { error: 'Session invalide.' });
      if (!sameOriginCsrfOk(req, cookies, 'club_member_csrf')) {
        return json(res, 403, { error: 'Protection de session invalide.' });
      }
      if (limited(`member-write:${member.id}`, 45)) {
        return json(res, 429, { error: 'Trop de modifications en peu de temps. Réessayez dans une minute.' });
      }
      const body = await bodyJson(req, 32_768);
      const result = await store.setMemberAssignmentsBatch(member.id, body.changes);
      if (!result.ok) return json(res, result.status, { error: result.error });
      return json(res, 200, { ...result, snapshot: store.memberSnapshot(member.id) });
    }

    if (pathname === '/api/me/assignment' && req.method === 'POST') {
      const { member, cookies } = sessionMember(req); if (!member) return json(res, 401, { error: 'Session invalide.' });
      if (!sameOriginCsrfOk(req, cookies, 'club_member_csrf')) return json(res, 403, { error: 'Protection de session invalide.' });
      if (limited(`member-write:${member.id}`, 30)) return json(res, 429, { error: 'Trop de modifications en peu de temps. Réessayez dans une minute.' });
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
      return json(res, 200, { ...store.adminSnapshot(), adminContext: a.context || { fromMember: false, memberId: null, name: null } });
    }
    if (pathname === '/api/admin/backup' && req.method === 'GET') {
      const a = adminOk(req); if (!a.ok) return json(res, 401, { error: 'Accès administrateur requis.' });
      const integrity = store.integrityReport();
      if (!integrity.ok) return json(res, 409, { error: 'Sauvegarde restaurable refusée : le stockage est incohérent. Utilisez l’export diagnostic et corrigez d’abord les données.' });
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
    if (pathname === '/api/admin/planning-batch' && req.method === 'POST') {
      const a = adminOk(req);
      if (!a.ok) return json(res, 401, { error: 'Session administrateur invalide.' });
      if (!sameOriginCsrfOk(req, a.cookies, 'club_admin_csrf')) {
        return json(res, 403, { error: 'Protection de session invalide.' });
      }
      if (limited(`admin-write:${tokenHash(a.rawSession).slice(0, 24)}`, 120)) {
        return json(res, 429, { error: 'Trop de modifications en peu de temps.' });
      }
      const body = await bodyJson(req, 65_536);
      const r = await runAdminPlanningMutationWithNotifications(store, () => store.setPlanningCellsAsAdmin(body.cells));
      if (!r.ok) return json(res, r.status, { error: r.error });
      return json(res, 200, { ...r, snapshot: store.adminSnapshot() });
    }

    if (pathname === '/api/admin/day-assignments' && req.method === 'POST') {
      const a = adminOk(req); if (!a.ok) return json(res, 401, { error: 'Session administrateur invalide.' });
      if (!sameOriginCsrfOk(req, a.cookies, 'club_admin_csrf')) return json(res, 403, { error: 'Protection de session invalide.' });
      if (limited(`admin-write:${getIp(req)}`, 120)) return json(res, 429, { error: 'Trop de modifications en peu de temps.' });
      const b = await bodyJson(req);
      const r = await runAdminPlanningMutationWithNotifications(store, () => store.setDayAssignmentsAsAdmin(b.date, b.assignments));
      if (!r.ok) return json(res, r.status, { error: r.error });
      return json(res, 200, r);
    }
    if (pathname === '/api/admin/cell-assignment' && req.method === 'POST') {
      const a = adminOk(req); if (!a.ok) return json(res, 401, { error: 'Session administrateur invalide.' });
      if (!sameOriginCsrfOk(req, a.cookies, 'club_admin_csrf')) return json(res, 403, { error: 'Protection de session invalide.' });
      if (limited(`admin-write:${getIp(req)}`, 120)) return json(res, 429, { error: 'Trop de modifications en peu de temps.' });
      const b = await bodyJson(req);
      const r = await runAdminPlanningMutationWithNotifications(store, () => store.setCellAssignmentAsAdmin(b.date, b.role, b.memberId, b.memberIds));
      if (!r.ok) return json(res, r.status, { error: r.error });
      return json(res, 200, r);
    }    if (pathname === '/api/admin/move-assignment' && req.method === 'POST') {
      const a = adminOk(req); if (!a.ok) return json(res, 401, { error: 'Session administrateur invalide.' });
      if (!sameOriginCsrfOk(req, a.cookies, 'club_admin_csrf')) return json(res, 403, { error: 'Protection de session invalide.' });
      if (limited(`admin-write:${getIp(req)}`, 120)) return json(res, 429, { error: 'Trop de modifications en peu de temps.' });
      const b = await bodyJson(req);
      const r = await runAdminPlanningMutationWithNotifications(store, () => store.moveAssignmentAsAdmin(b));
      if (!r.ok) return json(res, r.status, { error: r.error });
      return json(res, 200, r);
    }


    if (pathname === '/api/admin/assignment' && req.method === 'POST') {
      const a = adminOk(req); if (!a.ok) return json(res, 401, { error: 'Session administrateur invalide.' });
      if (!sameOriginCsrfOk(req, a.cookies, 'club_admin_csrf')) return json(res, 403, { error: 'Protection de session invalide.' });
      if (limited(`admin-write:${getIp(req)}`, 120)) return json(res, 429, { error: 'Trop de modifications en peu de temps.' });
      const b = await bodyJson(req); const r = await runAdminPlanningMutationWithNotifications(store, () => store.setRoleAssignmentAsAdmin(String(b.memberId || ''), b.date, b.role, !!b.present));
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
      if (!r.ok) return json(res, r.status, { ...r });
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
      if (!r.ok) return json(res, r.status, { ...r }); return json(res, 200, { ...r, snapshot: store.adminSnapshot() });
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
      const b = await bodyJson(req); const r = await store.createMember(b.name, b.email);
      if (!r.ok) return json(res, r.status, { error: r.error }); return json(res, 201, { ...r, personalPath: `/join#${r.rawToken}`, snapshot: store.adminSnapshot() });
    }
    if (pathname === '/api/admin/members/batch-active' && req.method === 'POST') {
      const a = adminOk(req); if (!a.ok) return json(res, 401, { error: 'Accès administrateur requis.' });
      if (!sameOriginCsrfOk(req, a.cookies, 'club_admin_csrf')) return json(res, 403, { error: 'Protection de session invalide.' });
      if (limited(`admin-write:${tokenHash(a.rawSession).slice(0, 24)}`, 120)) return json(res, 429, { error: 'Trop de modifications en peu de temps.' });
      const b = await bodyJson(req);
      const r = await store.setMembersActiveBatch(b.changes);
      if (!r.ok) return json(res, r.status, { error: r.error });
      return json(res, 200, { ...r, snapshot: store.adminSnapshot() });
    }
    if (pathname === '/api/admin/members/rotate-all' && req.method === 'POST') {
      const a = adminOk(req);
      if (!a.ok) return json(res, 401, { error: 'Accès administrateur requis.' });
      if (!sameOriginCsrfOk(req, a.cookies, 'club_admin_csrf')) {
        return json(res, 403, { error: 'Protection de session invalide.' });
      }
      if (limited(`admin-write:${tokenHash(a.rawSession).slice(0, 24)}`, 120)) {
        return json(res, 429, { error: 'Trop de modifications en peu de temps.' });
      }

      const r = await store.rotateAllActiveTokens();
      if (!r.ok) return json(res, r.status || 400, { error: r.error });
      return json(res, 200, { ...r, snapshot: store.adminSnapshot() });
    }

    const memberSessionsMatch = pathname.match(/^\/api\/admin\/members\/([^/]+)\/sessions\/revoke$/);
    if (memberSessionsMatch && req.method === 'POST') {
      const a = adminOk(req); if (!a.ok) return json(res, 401, { error: 'Accès administrateur requis.' });
      if (!sameOriginCsrfOk(req, a.cookies, 'club_admin_csrf')) return json(res, 403, { error: 'Protection de session invalide.' });
      if (limited(`admin-write:${tokenHash(a.rawSession).slice(0, 24)}`, 120)) return json(res, 429, { error: 'Trop de modifications en peu de temps.' });
      const memberId = decodeURIComponent(memberSessionsMatch[1]);
      const r = await store.revokeMemberSessionsByAdmin(memberId);
      if (!r.ok) return json(res, r.status, { error: r.error });
      return json(res, 200, { ...r, snapshot: store.adminSnapshot() });
    }
    const memberSendLinkMatch = pathname.match(/^\/api\/admin\/members\/([^/]+)\/send-link$/);
    if (memberSendLinkMatch && req.method === 'POST') {
      const a = adminOk(req);
      if (!a.ok) return json(res, 401, { error: 'Accès administrateur requis.' });
      if (!sameOriginCsrfOk(req, a.cookies, 'club_admin_csrf')) {
        return json(res, 403, { error: 'Protection de session invalide.' });
      }
      if (limited(`admin-write:${tokenHash(a.rawSession).slice(0, 24)}`, 120)) {
        return json(res, 429, { error: 'Trop de modifications en peu de temps.' });
      }

      const memberId = decodeURIComponent(memberSendLinkMatch[1]);
      const payload = store.memberPersonalLinkPayload(memberId);
      if (!payload.ok) return json(res, payload.status || 400, { error: payload.error });

      let delivery;
      try {
        delivery = await sendMemberPersonalLinkEmail(payload);
      } catch (err) {
        return json(res, 502, { error: `Envoi du lien impossible : ${err?.message || err}` });
      }

      return json(res, 200, {
        ok: true,
        sent: delivery.sent === true,
        prepared: delivery.prepared === true,
        reason: delivery.reason || null,
        recipient: payload.email
      });
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
      else if (Object.hasOwn(b, 'email')) r = await store.setMemberEmail(memberId, b.email);
      else if (Object.hasOwn(b, 'adminPrivilege')) r = await store.setMemberAdminPrivilege(memberId, b.adminPrivilege === true);
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
}

const server = http.createServer(requestHandler);

// Bornes défensives adaptées à une petite application interactive exposée sur Internet.
server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 5_000;
server.maxHeadersCount = 100;

// Vercel Node Application Preset : export par défaut explicite d'une fonction HTTP.
// requestHandler reste également exporté par son nom pour api/index.mjs.
export default requestHandler;

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
