export const config = { maxDuration: 15 };

let requestHandlerPromise = null;
let gmailTransportPromise = null;

function safeErrorMessage(error) {
  return String(error?.message || error || 'Erreur inconnue')
    .replace(/sb_secret_[A-Za-z0-9_-]+/g, '[SECRET_REDACTED]')
    .replace(/(?:GMAIL_APP_PASSWORD|SUPABASE_SECRET_KEY)\s*[=:]\s*\S+/gi, '$1=[SECRET_REDACTED]')
    .slice(0, 500);
}

function startupCode(error) {
  const text = [error?.code, error?.name, error?.message]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (text.includes('vercel blob n’est pas connecté') || text.includes('vercel blob n\'est pas connecté')) {
    return 'STARTUP_BLOB_CONFIG';
  }
  if (text.includes('admin_token') || text.includes('admin_code')) {
    return 'STARTUP_ADMIN_CONFIG';
  }
  if (text.includes('member_short_secret')) {
    return 'STARTUP_MEMBER_SECRET_CONFIG';
  }
  if (text.includes('err_module_not_found') || text.includes('cannot find package') || text.includes('cannot find module')) {
    return 'STARTUP_MODULE_MISSING';
  }
  if (text.includes('enoent')) {
    return 'STARTUP_FILE_MISSING';
  }
  if (text.includes('@vercel/blob') || text.includes('blob') || text.includes('fetch failed') || text.includes('econn')) {
    return 'STARTUP_STORAGE';
  }
  if (text.includes('unsupported_schema') || text.includes('stockage créé par une version plus récente')) {
    return 'STARTUP_STORAGE_SCHEMA';
  }
  return 'STARTUP_UNKNOWN';
}

async function getRequestHandler() {
  if (!requestHandlerPromise) {
    requestHandlerPromise = import('../server.mjs')
      .then((module) => {
        if (typeof module.requestHandler !== 'function') {
          throw Object.assign(new Error('requestHandler export absent.'), { code: 'HANDLER_EXPORT_MISSING' });
        }
        return module.requestHandler;
      })
      .catch((error) => {
        // Ne pas mémoriser définitivement un cold-start raté : une invocation ultérieure
        // doit pouvoir retenter après un incident transitoire de stockage/réseau.
        requestHandlerPromise = null;
        throw error;
      });
  }
  return requestHandlerPromise;
}

function startupFailure(res, error) {
  const code = startupCode(error);
  console.error('CALASORGA_STARTUP_ERROR', code, {
    name: String(error?.name || 'Error').slice(0, 80),
    code: String(error?.code || '').slice(0, 80),
    message: safeErrorMessage(error)
  });
  res.statusCode = 500;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify({ ok: false, error: 'Démarrage CalasOrga impossible.', code }));
}

function captureResponse() {
  const headers = new Map();
  let body = '';
  return {
    statusCode: 200,
    headers,
    get body() { return body; },
    setHeader(name, value) { headers.set(String(name), value); },
    getHeader(name) {
      const wanted = String(name).toLowerCase();
      for (const [key, value] of headers) if (key.toLowerCase() === wanted) return value;
      return undefined;
    },
    hasHeader(name) { return this.getHeader(name) !== undefined; },
    removeHeader(name) {
      const wanted = String(name).toLowerCase();
      for (const key of [...headers.keys()]) if (key.toLowerCase() === wanted) headers.delete(key);
    },
    end(value = '') {
      if (Buffer.isBuffer(value)) body += value.toString('utf8');
      else if (value !== undefined && value !== null) body += String(value);
    }
  };
}

async function runCaptured(requestHandler, req, { url, method }) {
  const previousUrl = req.url;
  const previousMethod = req.method;
  const capture = captureResponse();
  try {
    req.url = url;
    req.method = method;
    await requestHandler(req, capture);
    return capture;
  } finally {
    req.url = previousUrl;
    req.method = previousMethod;
  }
}

function parsedJson(capture) {
  try { return JSON.parse(capture.body || '{}'); }
  catch { return null; }
}

function applyCapturedHeaders(res, capture) {
  for (const [name, value] of capture.headers) {
    try { res.setHeader(name, value); } catch {}
  }
}

function relayCaptured(res, capture) {
  applyCapturedHeaders(res, capture);
  res.statusCode = capture.statusCode || 200;
  res.end(capture.body || '');
}

function replyJson(res, capture, status, payload) {
  applyCapturedHeaders(res, capture);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function gmailConfig() {
  const user = String(process.env.GMAIL_USER || '').trim();
  // Google affiche souvent le mot de passe d'application par groupes de 4.
  // Les espaces sont décoratifs et ne doivent pas empêcher l'authentification SMTP.
  const pass = String(process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
  const fromName = String(process.env.GMAIL_FROM_NAME || 'Planning Bridge').trim().slice(0, 80) || 'Planning Bridge';
  return { user, pass, fromName };
}

async function gmailTransport() {
  if (!gmailTransportPromise) {
    gmailTransportPromise = (async () => {
      const { user, pass } = gmailConfig();
      if (!user || !pass) {
        throw Object.assign(new Error('Configuration Gmail incomplète.'), { code: 'GMAIL_NOT_CONFIGURED' });
      }
      const module = await import('nodemailer');
      const nodemailer = module.default || module;
      return nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: { user, pass },
        connectionTimeout: 8_000,
        greetingTimeout: 8_000,
        socketTimeout: 12_000
      });
    })().catch((error) => {
      gmailTransportPromise = null;
      throw error;
    });
  }
  return gmailTransportPromise;
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function sendMemberLinkWithGmail({ memberName, email, personalUrl }) {
  const { user, fromName } = gmailConfig();
  if (!user) throw Object.assign(new Error('Configuration Gmail incomplète.'), { code: 'GMAIL_NOT_CONFIGURED' });

  const transporter = await gmailTransport();
  const cleanName = String(memberName || '').trim() || 'Membre';
  const subject = 'Planning Bridge — Votre lien personnel';
  const text = `Bonjour ${cleanName},\n\nVoici votre lien personnel pour accéder au planning du club :\n${personalUrl}\n\nConservez ce lien : il vous permet d'accéder directement à votre planning.\n\nPlanning Bridge`;
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;line-height:1.5;color:#17251e"><p>Bonjour ${escapeHtml(cleanName)},</p><p>Voici votre lien personnel pour accéder au planning du club :</p><p><a href="${escapeHtml(personalUrl)}">Accéder à mon planning</a></p><p style="font-size:13px;color:#5b665f">Conservez ce lien : il vous permet d'accéder directement à votre planning.</p><p>Planning Bridge</p></body></html>`;

  return transporter.sendMail({
    from: { name: fromName, address: user },
    to: email,
    replyTo: user,
    subject,
    text,
    html
  });
}

async function handleGmailMemberLink(requestHandler, req, res, originalUrl) {
  // 1) Laisse la route CalasOrga existante valider session admin, CSRF,
  // rate-limit, membre actif, email et existence du lien personnel.
  const prepared = await runCaptured(requestHandler, req, { url: originalUrl, method: 'POST' });
  const preparedJson = parsedJson(prepared);
  if ((prepared.statusCode || 200) >= 400 || !preparedJson?.ok) {
    return relayCaptured(res, prepared);
  }
  if (preparedJson.sent === true) {
    return relayCaptured(res, prepared);
  }

  const match = originalUrl.match(/^\/api\/admin\/members\/([^/?]+)\/send-link(?:\?|$)/);
  const memberId = match ? decodeURIComponent(match[1]) : '';
  if (!memberId) {
    return replyJson(res, prepared, 400, { error: 'Membre invalide.' });
  }

  // 2) Réutilise le snapshot admin déjà protégé pour récupérer le token
  // affichable courant. Aucun secret/token n'est envoyé au navigateur ici.
  const adminCapture = await runCaptured(requestHandler, req, { url: '/api/admin', method: 'GET' });
  const adminJson = parsedJson(adminCapture);
  if ((adminCapture.statusCode || 200) >= 400 || !adminJson) {
    return replyJson(res, prepared, 502, { error: 'Impossible de préparer le lien à envoyer.' });
  }

  const member = (adminJson.membersAdmin || []).find((item) => String(item?.id || '') === memberId);
  const shortToken = String(member?.currentShortToken || '').trim().normalize('NFC');
  const recipient = String(preparedJson.recipient || member?.email || '').trim();
  if (!member || !shortToken || !recipient) {
    return replyJson(res, prepared, 409, { error: 'Le lien personnel actuel est indisponible.' });
  }

  const publicHome = String(
    process.env.MEMBER_LINK_PUBLIC_HOME || 'https://capgui13.github.io/CalasOrga/'
  ).trim().replace(/\/?$/, '/');
  const personalUrl = `${publicHome}#${shortToken}`;

  try {
    const info = await sendMemberLinkWithGmail({
      memberName: member.name || '',
      email: recipient,
      personalUrl
    });
    return replyJson(res, prepared, 200, {
      ok: true,
      sent: true,
      prepared: true,
      reason: null,
      recipient,
      messageId: String(info?.messageId || '')
    });
  } catch (error) {
    console.error('CALASORGA_GMAIL_SEND_ERROR', {
      code: String(error?.code || '').slice(0, 80),
      responseCode: Number(error?.responseCode || 0) || undefined,
      command: String(error?.command || '').slice(0, 40),
      message: safeErrorMessage(error)
    });
    const code = String(error?.code || '');
    const userMessage = code === 'GMAIL_NOT_CONFIGURED'
      ? 'Envoi Gmail non configuré sur le serveur.'
      : code === 'EAUTH'
        ? 'Gmail a refusé l’authentification. Vérifiez le mot de passe d’application CalasOrga.'
        : 'Envoi Gmail impossible pour le moment.';
    return replyJson(res, prepared, 502, { error: userMessage });
  }
}

export default async function handler(req, res) {
  let originalPath = req.query?.__path ?? '';
  if (Array.isArray(originalPath)) originalPath = originalPath[0] || '';
  originalPath = String(originalPath).replace(/^\/+/, '');

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(req.query || {})) {
    if (key === '__path') continue;
    if (Array.isArray(value)) for (const v of value) query.append(key, String(v));
    else if (value !== undefined) query.append(key, String(value));
  }
  req.url = `/${originalPath}${query.size ? `?${query.toString()}` : ''}`;

  try {
    const requestHandler = await getRequestHandler();
    if (
      req.method === 'POST' &&
      /^\/api\/admin\/members\/[^/?]+\/send-link(?:\?|$)/.test(req.url)
    ) {
      return await handleGmailMemberLink(requestHandler, req, res, req.url);
    }
    return await requestHandler(req, res);
  } catch (error) {
    return startupFailure(res, error);
  }
}
