require("dotenv").config();

const express = require("express");
const path = require("path");
const crypto = require("crypto");
const Database = require("better-sqlite3");
const Razorpay = require("razorpay");
const multer = require("multer");
const fs = require("fs");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOLD_MINUTES = Number(process.env.PENDING_HOLD_MINUTES || 15);
const ID_DIR = path.join(__dirname, "private_ids");
fs.mkdirSync(ID_DIR, { recursive: true, mode: 0o700 });

const ID_TYPES = new Set(["aadhaar", "driving_license", "passport", "voter_id"]);
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, ID_DIR),
  filename: (req, file, cb) => cb(null, crypto.randomBytes(24).toString("hex") + ".bin")
});
const upload = multer({
  storage,
  limits: { files: 2, fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = new Set(["image/jpeg", "image/png", "application/pdf"]);
    cb(null, allowed.has(file.mimetype));
  }
});

const ROOM_TYPES = {
  standard: { name: "Standard Room", rate: 1000, inventory: Number(process.env.STANDARD_ROOMS || 7) },
  deluxe: { name: "Deluxe Room", rate: 1200, inventory: Number(process.env.DELUXE_ROOMS || 7) },
  super_deluxe: { name: "Super Deluxe Room", rate: 1500, inventory: Number(process.env.SUPER_DELUXE_ROOMS || 6) }
};

const db = new Database(path.join(__dirname, "hotel.db"));
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_ref TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  room_type TEXT NOT NULL,
  checkin TEXT NOT NULL,
  checkout TEXT NOT NULL,
  guests INTEGER NOT NULL,
  nights INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  razorpay_order_id TEXT,
  razorpay_payment_id TEXT,
  created_at TEXT NOT NULL,
  paid_at TEXT,
  guest1_id_type TEXT,
  guest1_id_file TEXT,
  guest2_id_type TEXT,
  guest2_id_file TEXT
);
CREATE INDEX IF NOT EXISTS idx_booking_dates ON bookings(room_type, checkin, checkout, status);
CREATE INDEX IF NOT EXISTS idx_razorpay_order ON bookings(razorpay_order_id);
`);

try {
  const cols = db.prepare("PRAGMA table_info(bookings)").all().map(x => x.name);
  for (const [name, type] of [["guest1_id_type","TEXT"],["guest1_id_file","TEXT"],["guest2_id_type","TEXT"],["guest2_id_file","TEXT"]]) {
    if (!cols.includes(name)) db.exec(`ALTER TABLE bookings ADD COLUMN ${name} ${type}`);
  }
} catch (e) { console.error("DB migration error:", e); }

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || "",
  key_secret: process.env.RAZORPAY_KEY_SECRET || ""
});

function dateOnly(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}
function parseDate(s) {
  if (!dateOnly(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}
function nightsBetween(checkin, checkout) {
  const a = parseDate(checkin), b = parseDate(checkout);
  if (!a || !b) return 0;
  return Math.round((b - a) / 86400000);
}
function bookingRef() {
  return "SBH-" + Date.now().toString(36).toUpperCase() + "-" + crypto.randomBytes(2).toString("hex").toUpperCase();
}
function expireOldPending() {
  db.prepare(`
    UPDATE bookings
    SET status='expired'
    WHERE status='pending'
      AND created_at < datetime('now', ?)
  `).run(`-${HOLD_MINUTES} minutes`);
}
function overlappingCount(roomType, checkin, checkout) {
  expireOldPending();
  return db.prepare(`
    SELECT COUNT(*) AS count
    FROM bookings
    WHERE room_type = ?
      AND status IN ('pending','paid','confirmed')
      AND checkin < ?
      AND checkout > ?
  `).get(roomType, checkout, checkin).count;
}
function available(roomType, checkin, checkout) {
  const type = ROOM_TYPES[roomType];
  return type.inventory - overlappingCount(roomType, checkin, checkout);
}
function cleanText(v, max=200) {
  return String(v ?? "").trim().slice(0, max);
}

// Razorpay webhook needs the raw request body, so register it before JSON parsing.
app.post("/api/razorpay/webhook", express.raw({ type: "application/json" }), (req, res) => {
  try {
    const signature = req.headers["x-razorpay-signature"];
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret || !signature) return res.status(400).send("Webhook not configured");

    const expected = crypto.createHmac("sha256", secret).update(req.body).digest("hex");
    const ok = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    if (!ok) return res.status(400).send("Invalid signature");

    const event = JSON.parse(req.body.toString("utf8"));

    if (event.event === "payment.captured") {
      const payment = event.payload?.payment?.entity;
      if (payment?.order_id && payment?.id) {
        db.prepare(`
          UPDATE bookings
          SET status='confirmed', razorpay_payment_id=?, paid_at=COALESCE(paid_at, datetime('now'))
          WHERE razorpay_order_id=?
        `).run(payment.id, payment.order_id);
      }
    }

    if (event.event === "payment.failed") {
      const payment = event.payload?.payment?.entity;
      if (payment?.order_id) {
        db.prepare(`UPDATE bookings SET status='payment_failed' WHERE razorpay_order_id=? AND status='pending'`)
          .run(payment.order_id);
      }
    }

    return res.sendStatus(200);
  } catch (e) {
    console.error("Webhook error:", e);
    return res.sendStatus(500);
  }
});

app.use(express.json({ limit: "100kb" }));
app.use(express.static(__dirname));

function cleanupExpiredBookings() {
  const expired = db.prepare(`
    SELECT guest1_id_file, guest2_id_file
    FROM bookings
    WHERE status='pending' AND created_at < datetime('now', ?)
  `).all(`-${HOLD_MINUTES} minutes`);
  for (const row of expired) {
    for (const file of [row.guest1_id_file, row.guest2_id_file]) {
      if (file) { try { fs.unlinkSync(path.join(ID_DIR, file)); } catch (_) {} }
    }
  }
  db.prepare(`
    UPDATE bookings SET status='expired'
    WHERE status='pending' AND created_at < datetime('now', ?)
  `).run(`-${HOLD_MINUTES} minutes`);
}

app.get("/api/config", (req, res) => {
  res.json({
    razorpayKeyId: process.env.RAZORPAY_KEY_ID || "",
    currency: "INR",
    maxGuestsPerRoom: 2,
    acceptedIdTypes: ["aadhaar","driving_license","passport","voter_id"],
    hotel: {
      name: "Shree Balaji Hotel",
      address: "4, Balaji Tower, Near ICICI Bank",
      whatsapp: "7987510587"
    },
    rooms: Object.fromEntries(Object.entries(ROOM_TYPES).map(([k,v]) => [k, {name:v.name, rate:v.rate}]))
  });
});

app.get("/api/availability", (req, res) => {
  const { checkin, checkout } = req.query;
  if (!parseDate(checkin) || !parseDate(checkout) || nightsBetween(checkin, checkout) <= 0) {
    return res.status(400).json({ error: "Please select a valid check-in and check-out date." });
  }
  const result = {};
  for (const [key, type] of Object.entries(ROOM_TYPES)) {
    result[key] = { ...type, available: Math.max(0, available(key, checkin, checkout)) };
  }
  res.json(result);
});

app.post("/api/create-order", upload.fields([
  { name: "guest1Id", maxCount: 1 },
  { name: "guest2Id", maxCount: 1 }
]), async (req, res) => {
  const uploaded = [];
  try {
    cleanupExpiredBookings();

    const name = cleanText(req.body.name, 100);
    const phone = cleanText(req.body.phone, 30);
    const email = cleanText(req.body.email, 120);
    const roomType = cleanText(req.body.roomType, 30);
    const checkin = cleanText(req.body.checkin, 10);
    const checkout = cleanText(req.body.checkout, 10);
    const guests = Number(req.body.guests || 1);
    const guest1IdType = cleanText(req.body.guest1IdType, 30);
    const guest2IdType = cleanText(req.body.guest2IdType, 30);

    const files = req.files || {};
    for (const list of Object.values(files)) for (const f of list) uploaded.push(f.filename);

    if (!name || !phone || !ROOM_TYPES[roomType] || !parseDate(checkin) || !parseDate(checkout)) {
      throw Object.assign(new Error("Please complete all booking details."), { status: 400 });
    }
    if (![1,2].includes(guests)) {
      throw Object.assign(new Error("A maximum of 2 guests is allowed per room."), { status: 400 });
    }
    if (!ID_TYPES.has(guest1IdType) || !files.guest1Id?.[0]) {
      throw Object.assign(new Error("Guest 1 must upload one accepted ID: Aadhaar, Driving Licence, Passport or Voter ID."), { status: 400 });
    }
    if (guests === 2 && (!ID_TYPES.has(guest2IdType) || !files.guest2Id?.[0])) {
      throw Object.assign(new Error("Guest 2 must upload one accepted ID: Aadhaar, Driving Licence, Passport or Voter ID."), { status: 400 });
    }

    const nights = nightsBetween(checkin, checkout);
    if (nights <= 0 || nights > 30) {
      throw Object.assign(new Error("Stay must be between 1 and 30 nights."), { status: 400 });
    }

    const type = ROOM_TYPES[roomType];
    if (available(roomType, checkin, checkout) < 1) {
      throw Object.assign(new Error("That room category is sold out for the selected dates."), { status: 409 });
    }

    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      throw Object.assign(new Error("Online payment is not configured yet. Add Razorpay API keys on the server."), { status: 503 });
    }

    const amountRupees = type.rate * nights;
    const receipt = bookingRef();
    const order = await razorpay.orders.create({
      amount: amountRupees * 100,
      currency: "INR",
      receipt,
      notes: { hotel: "Shree Balaji Hotel", room_type: roomType, checkin, checkout, guests: String(guests) }
    });

    db.prepare(`
      INSERT INTO bookings
      (booking_ref,name,phone,email,room_type,checkin,checkout,guests,nights,amount,status,razorpay_order_id,created_at,
       guest1_id_type,guest1_id_file,guest2_id_type,guest2_id_file)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),?,?,?,?)
    `).run(
      receipt,name,phone,email,roomType,checkin,checkout,guests,nights,amountRupees,"pending",order.id,
      guest1IdType,files.guest1Id[0].filename,
      guests === 2 ? guest2IdType : null,
      guests === 2 ? files.guest2Id[0].filename : null
    );

    res.json({
      keyId: process.env.RAZORPAY_KEY_ID,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      bookingRef: receipt,
      roomName: type.name,
      nights,
      total: amountRupees
    });
  } catch (e) {
    for (const file of uploaded) { try { fs.unlinkSync(path.join(ID_DIR, file)); } catch (_) {} }
    console.error("Create order error:", e);
    res.status(e.status || 500).json({ error: e.message || "Could not create the booking payment order." });
  }
});

app.post("/api/verify-payment", async (req, res) => {
  try {
    const { bookingRef, razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body;
    const booking = db.prepare(`SELECT * FROM bookings WHERE booking_ref=?`).get(bookingRef);

    if (!booking || booking.razorpay_order_id !== razorpay_order_id) {
      return res.status(400).json({ error: "Booking/payment could not be matched." });
    }

    const expected = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(`${booking.razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    const valid = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(razorpay_signature || ""));
    if (!valid) return res.status(400).json({ error: "Payment verification failed." });

    const payment = await razorpay.payments.fetch(razorpay_payment_id);

    if (payment.order_id !== booking.razorpay_order_id) {
      return res.status(400).json({ error: "Payment order mismatch." });
    }

    db.prepare(`
      UPDATE bookings
      SET razorpay_payment_id=?, status=?, paid_at=CASE WHEN ?='confirmed' THEN datetime('now') ELSE paid_at END
      WHERE booking_ref=?
    `).run(razorpay_payment_id, payment.status === "captured" ? "confirmed" : "paid", payment.status === "captured" ? "confirmed" : "paid", bookingRef);

    const updated = db.prepare(`SELECT booking_ref,status,amount,room_type,checkin,checkout FROM bookings WHERE booking_ref=?`).get(bookingRef);

    res.json({
      success: true,
      status: updated.status,
      bookingRef: updated.booking_ref,
      total: updated.amount,
      roomType: updated.room_type,
      checkin: updated.checkin,
      checkout: updated.checkout,
      paymentStatus: payment.status
    });
  } catch (e) {
    console.error("Verify error:", e);
    res.status(500).json({ error: "Payment verification could not be completed." });
  }
});

// Private ID documents are never exposed as public files.
// A production deployment should put this behind a real authenticated admin panel.
app.get("/api/admin/id-document/:bookingRef/:guest", (req, res) => {
  if (process.env.ADMIN_TOKEN && req.headers["x-admin-token"] !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const booking = db.prepare(`SELECT guest1_id_file, guest2_id_file FROM bookings WHERE booking_ref=?`).get(req.params.bookingRef);
  if (!booking) return res.status(404).end();
  const file = req.params.guest === "2" ? booking.guest2_id_file : booking.guest1_id_file;
  if (!file) return res.status(404).end();
  const full = path.join(ID_DIR, file);
  if (!fs.existsSync(full)) return res.status(404).end();
  res.setHeader("Content-Disposition", "attachment; filename=\"identity-document\"");
  res.sendFile(full);
});

app.get(/^(?!\/api\/).*/, (req, res) => res.sendFile(path.join(__dirname, "index.html")));

app.listen(PORT, () => {
  console.log(`Shree Balaji Hotel booking site running on http://localhost:${PORT}`);
});
