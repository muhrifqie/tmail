/**
 * Dev SMTP (Windows-friendly) — not Haraka.
 * Listens :2525, accepts mail for any RCPT, forwards raw to API ingest.
 * Prod VPS: use Haraka on :25 with plugins/tmail_forward.js
 */
import { SMTPServer } from 'smtp-server';
import { simpleParser } from 'mailparser';

const PORT = Number(process.env.SMTP_DEV_PORT || 2525);
const API = (process.env.PUBLIC_API_URL || 'http://127.0.0.1:3100').replace(/\/$/, '');
const KEY = process.env.INGEST_KEY || 'dev-ingest-key-change-me';

const server = new SMTPServer({
  authOptional: true,
  disabledCommands: ['AUTH'],
  onRcptTo(address, session, cb) {
    cb(); // accept; API drops unknown
  },
  onData(stream, session, cb) {
    const chunks = [];
    stream.on('data', (c) => chunks.push(c));
    stream.on('end', async () => {
      try {
        const raw = Buffer.concat(chunks);
        const envelopeTo = (session.envelope.rcptTo || []).map((r) => r.address);
        const envelopeFrom = session.envelope.mailFrom?.address || '';
        const res = await fetch(`${API}/internal/ingest`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-ingest-key': KEY,
          },
          body: JSON.stringify({
            envelopeTo,
            envelopeFrom,
            rawBase64: raw.toString('base64'),
          }),
        });
        const text = await res.text();
        if (!res.ok) {
          console.error('ingest fail', res.status, text);
          return cb(new Error('ingest failed'));
        }
        console.log('stored', text);
        cb();
      } catch (e) {
        console.error(e);
        cb(e);
      }
    });
  },
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`TMail dev SMTP :${PORT} → ${API}`);
});
