/**
 * invoice-nudge — dead-simple freelancer invoice reminder bot
 * Pure Node.js (no dependencies). Run with:  node server.js
 *
 * What it does:
 *  - Serves a tiny web UI to register invoices (client email, amount, due date)
 *  - Stores them in invoices.json (no database needed)
 *  - Once a day, finds unpaid invoices that are due and not reminded recently,
 *    then POSTs them to your n8n webhook, which sends the polite email.
 *
 * Config via environment variables (all optional):
 *  PORT                 default 4000
 *  N8N_WEBHOOK_URL      your n8n "Invoice Reminder Email Sender" webhook URL
 *  SENDER_NAME          shown in the reminder email (default "Your name")
 *  REMIND_EVERY_DAYS    re-send interval while unpaid (default 3)
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 4000;
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || "";
const SENDER_NAME = process.env.SENDER_NAME || "Your name";
const REMIND_EVERY_DAYS = parseInt(process.env.REMIND_EVERY_DAYS || "3", 10);

const DATA_FILE = path.join(__dirname, "invoices.json");
const PUBLIC_DIR = path.join(__dirname, "public");

// ---------- tiny JSON "database" ----------
function loadInvoices() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return [];
  }
}
function saveInvoices(list) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(list, null, 2));
}

function todayStr() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}
function daysBetween(a, b) {
  return Math.floor((new Date(a) - new Date(b)) / 86400000);
}

// ---------- reminder engine ----------
function reminderDue(inv) {
  if (inv.status === "paid") return false;
  const today = todayStr();
  // only on or after the due date
  if (daysBetween(today, inv.dueDate) < 0) return false;
  if (!inv.lastReminded) return true; // never reminded yet
  // re-send every N days while unpaid
  return daysBetween(today, inv.lastReminded) >= REMIND_EVERY_DAYS;
}

function postToN8n(payload) {
  return new Promise((resolve) => {
    if (!N8N_WEBHOOK_URL) {
      console.log("[reminder] N8N_WEBHOOK_URL not set — skipping send for", payload.clientEmail);
      return resolve(false);
    }
    try {
      const url = new URL(N8N_WEBHOOK_URL);
      const body = JSON.stringify(payload);
      const lib = url.protocol === "https:" ? require("https") : require("http");
      const req = lib.request(
        url,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode >= 200 && res.statusCode < 300);
        }
      );
      req.on("error", (e) => {
        console.error("[reminder] webhook error:", e.message);
        resolve(false);
      });
      req.write(body);
      req.end();
    } catch (e) {
      console.error("[reminder] bad webhook url:", e.message);
      resolve(false);
    }
  });
}

async function runReminderCheck() {
  const list = loadInvoices();
  let changed = false;
  for (const inv of list) {
    if (reminderDue(inv)) {
      const ok = await postToN8n({
        invoiceNumber: inv.invoiceNumber || inv.id,
        clientName: inv.clientName,
        clientEmail: inv.clientEmail,
        amount: inv.amount,
        currency: inv.currency || "USD",
        dueDate: inv.dueDate,
        senderName: SENDER_NAME,
        daysOverdue: Math.max(0, daysBetween(todayStr(), inv.dueDate)),
      });
      if (ok) {
        inv.lastReminded = todayStr();
        inv.reminderCount = (inv.reminderCount || 0) + 1;
        changed = true;
        console.log(`[reminder] sent for invoice ${inv.invoiceNumber || inv.id} → ${inv.clientEmail}`);
      }
    }
  }
  if (changed) saveInvoices(list);
}

// ---------- http helpers ----------
function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
  });
}

// ---------- server ----------
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);

  // API: list
  if (req.method === "GET" && u.pathname === "/api/invoices") {
    return sendJson(res, 200, loadInvoices());
  }
  // API: create
  if (req.method === "POST" && u.pathname === "/api/invoices") {
    const b = await readBody(req);
    if (!b.clientEmail || !b.amount || !b.dueDate) {
      return sendJson(res, 400, { error: "clientEmail, amount, dueDate are required" });
    }
    const list = loadInvoices();
    const inv = {
      id: Date.now().toString(36),
      invoiceNumber: b.invoiceNumber || "",
      clientName: b.clientName || "",
      clientEmail: b.clientEmail,
      amount: Number(b.amount),
      currency: b.currency || "USD",
      dueDate: b.dueDate,
      status: "unpaid",
      lastReminded: null,
      reminderCount: 0,
      createdAt: todayStr(),
    };
    list.push(inv);
    saveInvoices(list);
    return sendJson(res, 201, inv);
  }
  // API: update (mark paid / unpaid) or delete
  const m = u.pathname.match(/^\/api\/invoices\/([^/]+)$/);
  if (m) {
    const id = m[1];
    const list = loadInvoices();
    const idx = list.findIndex((x) => x.id === id);
    if (idx === -1) return sendJson(res, 404, { error: "not found" });
    if (req.method === "PATCH") {
      const b = await readBody(req);
      if (b.status) list[idx].status = b.status;
      saveInvoices(list);
      return sendJson(res, 200, list[idx]);
    }
    if (req.method === "DELETE") {
      const removed = list.splice(idx, 1);
      saveInvoices(list);
      return sendJson(res, 200, removed[0]);
    }
  }
  // API: manually trigger a reminder check (handy for testing)
  if (req.method === "POST" && u.pathname === "/api/run-reminders") {
    await runReminderCheck();
    return sendJson(res, 200, { ok: true });
  }

  // static files
  let filePath = u.pathname === "/" ? "/index.html" : u.pathname;
  filePath = path.join(PUBLIC_DIR, path.normalize(filePath).replace(/^(\.\.[/\\])+/, ""));
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      return res.end("Not found");
    }
    const ext = path.extname(filePath);
    const type =
      ext === ".html" ? "text/html" : ext === ".js" ? "text/javascript" : ext === ".css" ? "text/css" : "text/plain";
    res.writeHead(200, { "Content-Type": type + "; charset=utf-8" });
    res.end(content);
  });
});

server.listen(PORT, () => {
  console.log(`\n  invoice-nudge running →  http://localhost:${PORT}\n`);
  console.log(`  n8n webhook: ${N8N_WEBHOOK_URL || "(not set — reminders won't send until you set N8N_WEBHOOK_URL)"}`);
  // run a check now, then once every 24h
  runReminderCheck();
  setInterval(runReminderCheck, 24 * 60 * 60 * 1000);
});
