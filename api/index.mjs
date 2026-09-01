export const config = { maxDuration: 15 };

let requestHandlerPromise = null;

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
  console.error('CALASORGA_STARTUP_ERROR', code, error);
  res.statusCode = 500;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify({ ok: false, error: 'Démarrage CalasOrga impossible.', code }));
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
    return await requestHandler(req, res);
  } catch (error) {
    return startupFailure(res, error);
  }
}
