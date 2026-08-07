import { SMTPServer } from "smtp-server";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// load root env
const envPath = resolve(__dirname, "../.env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const PORT = Number(process.env.SMTP_PORT || 25);
const API = (process.env.PUBLIC_API_URL || "http://127.0.0.1:3100").replace(/\/$/, "") || "http://127.0.0.1:3100";
const KEY = process.env.INGEST_KEY || "";
const MAX = Number(process.env.INBOUND_MAX_BYTES || 5242880);

const server = new SMTPServer({
  authOptional: true,
  disabledCommands: ["AUTH"],
  size: MAX,
  banner: "TMail inbound",
  onConnect(session, cb) {
    cb();
  },
  onMailFrom(address, session, cb) {
    cb();
  },
  onRcptTo(address, session, cb) {
    cb(); // accept; API drops unknown addresses
  },
  onData(stream, session, cb) {
    const chunks = [];
    let size = 0;
    stream.on("data", (c) => {
      size += c.length;
      if (size <= MAX) chunks.push(c);
    });
    stream.on("end", async () => {
      try {
        if (size > MAX) return cb(Object.assign(new Error("Message too large"), { responseCode: 552 }));
        const raw = Buffer.concat(chunks);
        const envelopeTo = (session.envelope.rcptTo || []).map((r) => r.address);
        const envelopeFrom = session.envelope.mailFrom?.address || "";
        const res = await fetch(`${API}/internal/ingest`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-ingest-key": KEY,
          },
          body: JSON.stringify({
            envelopeTo,
            envelopeFrom,
            rawBase64: raw.toString("base64"),
          }),
        });
        const text = await res.text();
        if (!res.ok) {
          console.error("ingest fail", res.status, text);
          return cb(new Error("store failed"));
        }
        console.log(new Date().toISOString(), "stored", text, "to", envelopeTo.join(","));
        cb();
      } catch (e) {
        console.error(e);
        cb(e);
      }
    });
  },
});

server.on("error", (err) => console.error("SMTP error", err));
server.listen(PORT, "0.0.0.0", () => {
  console.log(`TMail SMTP :${PORT} -> ${API}`);
});
