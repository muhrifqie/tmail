// plugins/tmail_forward.js — Haraka plugin (CommonJS; Haraka loads CJS)
// Forwards accepted mail to Fastify POST /internal/ingest

const http = require('node:http');
const https = require('node:https');
const { URL } = require('node:url');

exports.register = function () {
  this.load_tmail_ini();
  this.register_hook('rcpt', 'hook_rcpt');
  this.register_hook('queue', 'hook_queue');
};

exports.load_tmail_ini = function () {
  const plugin = this;
  plugin.cfg = plugin.config.get(
    'tmail_forward.ini',
    {
      booleans: ['+main.check_exists'],
    },
    () => plugin.load_tmail_ini(),
  ) || {};
  plugin.cfg.main = plugin.cfg.main || {};
  plugin.cfg.main.api_url = plugin.cfg.main.api_url || 'http://127.0.0.1:3000';
  plugin.cfg.main.ingest_key = plugin.cfg.main.ingest_key || process.env.INGEST_KEY || '';
  plugin.cfg.main.check_exists =
    plugin.cfg.main.check_exists === undefined ? true : plugin.cfg.main.check_exists;
};

function requestJson(method, urlStr, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === 'https:' ? https : http;
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = lib.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method,
        headers: {
          ...(headers || {}),
          ...(data
            ? { 'Content-Type': 'application/json', 'Content-Length': data.length }
            : {}),
        },
        timeout: 15000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            /* ignore */
          }
          resolve({ status: res.statusCode || 0, json, text });
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
    if (data) req.write(data);
    req.end();
  });
}

exports.hook_rcpt = function (next, connection, params) {
  const plugin = this;
  const rcpt = params[0];
  const address = rcpt.address();
  const domain = (rcpt.host || '').toLowerCase();

  // Only gate on domain, not address — ingestRaw auto-creates addresses
  const base = plugin.cfg.main.api_url.replace(/\/$/, '');
  const key = plugin.cfg.main.ingest_key;
  const url = `${base}/internal/address-exists?email=${encodeURIComponent(address)}`;

  requestJson('GET', url, { 'X-Ingest-Key': key })
    .then((res) => {
      if (res.status === 200 && res.json && res.json.domainActive === false) {
        return next(DENY, 'domain not accepted here');
      }
      return next();
    })
    .catch((err) => {
      plugin.logerror('address-exists failed: ' + err.message);
      return next(DENYSOFT, 'inbox backend unavailable');
    });
};

exports.hook_queue = function (next, connection) {
  const plugin = this;
  const txn = connection.transaction;
  if (!txn) return next(DENYSOFT, 'no transaction');

  const envelopeTo = txn.rcpt_to.map((r) => r.address());
  const envelopeFrom = txn.mail_from ? txn.mail_from.address() : '';
  const raw = txn.body ? txn.body.bodytext || txn.body.header + txn.body.bodytext : null;

  // Prefer full message stream buffer
  let buf;
  try {
    buf = txn.message_stream ? null : null;
  } catch {
    /* ignore */
  }

  const collect = () =>
    new Promise((resolve, reject) => {
      if (!txn.message_stream) {
        // fallback assemble
        const header = txn.header ? txn.header.toString() : '';
        const body = txn.body && txn.body.bodytext ? txn.body.bodytext : '';
        resolve(Buffer.from(header + '\r\n' + body));
        return;
      }
      const chunks = [];
      txn.message_stream.get_data((data) => {
        resolve(Buffer.isBuffer(data) ? data : Buffer.from(data || ''));
      });
      // Haraka get_data callback style — if stream, accumulate
      if (typeof txn.message_stream.on === 'function') {
        txn.message_stream.on('data', (c) => chunks.push(c));
        txn.message_stream.on('end', () => resolve(Buffer.concat(chunks)));
        txn.message_stream.on('error', reject);
      }
    });

  collect()
    .then((rawBuf) => {
      const base = plugin.cfg.main.api_url.replace(/\/$/, '');
      const key = plugin.cfg.main.ingest_key;
      return requestJson(
        'POST',
        `${base}/internal/ingest`,
        { 'X-Ingest-Key': key },
        {
          envelopeTo,
          envelopeFrom,
          rawBase64: rawBuf.toString('base64'),
        },
      );
    })
    .then((res) => {
      if (res.status >= 200 && res.status < 300) {
        plugin.loginfo('forwarded ok ' + JSON.stringify(res.json));
        return next(OK);
      }
      plugin.logerror('forward failed ' + res.status + ' ' + res.text);
      return next(DENYSOFT, 'store failed');
    })
    .catch((err) => {
      plugin.logerror('forward error ' + err.message);
      return next(DENYSOFT, 'store error');
    });
};
