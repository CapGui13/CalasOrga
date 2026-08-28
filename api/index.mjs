import { requestHandler } from '../server.mjs';

export const config = { maxDuration: 15 };

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
  return requestHandler(req, res);
}
