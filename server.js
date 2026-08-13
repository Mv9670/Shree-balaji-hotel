const express = require('express');
const path = require('path');
const crypto = require('crypto');
const Razorpay = require('razorpay');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 10000;

const db = new Database(path.join(__dirname, 'hotel.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS rooms (
  category TEXT NOT NULL,
  room TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available',
  PRIMARY KEY(category, room)
);

CREATE TABLE IF NOT EXISTS bookings (
  bookingId TEXT PRIMARY KEY,
  guestName TEXT NOT NULL,
  phone TEXT NOT NULL,
  category TEXT NOT NULL,
  room TEXT NOT NULL,
  checkin TEXT NOT NULL,
  checkout TEXT NOT NULL,
  amount REAL NOT NULL,
  paymentStatus TEXT NOT NULL DEFAULT 'pending',
  paymentId TEXT,
  status TEXT NOT NULL DEFAULT 'confirmed',
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  paymentId TEXT PRIMARY KEY,
  bookingId TEXT NOT NULL,
  room TEXT NOT NULL,
  amount REAL NOT NULL,
  status TEXT NOT NULL,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK(id=1),
  name TEXT,
  whatsapp TEXT,
  address TEXT,
  checkinTime TEXT,
  checkoutTime TEXT
);
`);

const roomData = {
  standard: {
    name: 'Standard Room',
    price: 1000,
    rooms: ['205','206','207','208','301','302','303','304','305','306','307']
  },
  deluxe: {
    name: 'Deluxe Room',
    price: 1200,
    rooms: ['201','202','203','204']
  },
  super: {
    name: 'Super Deluxe Room',
    price: 1500,
    rooms: ['101','102','103','104','105']
  }
};

for (const [category, data] of Object.entries(roomData)) {
  for (const room of data.rooms) {
    db.prepare(`
      INSERT OR IGNORE INTO rooms(category,room,status)
      VALUES(?,?,?)
    `).run(category, room, 'available');
  }
}

db.prepare(`
INSERT OR IGNORE INTO settings
(id,name,whatsapp,address,checkinTime,checkoutTime)
VALUES(1,?,?,?,?,?)
`).run(
  'Shree Balaji Hotel',
  '7987510587',
  '4, Balaji Tower, Near ICICI Bank',
  '12:00',
  '11:00'
);

app.use(express.json());
app.use(express.static(__dirname));

/* ================= RAZORPAY ================= */

function gateway() {
  if (!process.env.RAZORPAY_KEY_ID ||
      !process.env.RAZORPAY_KEY_SECRET) return null;

  return new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
  });
}

/* ================= ADMIN AUTH ================= */

const ADMIN_USERNAME =
  process.env.ADMIN_USERNAME || 'admin';

const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD || 'SBH@2026#Admin';

const adminTokens = new Map();

function createToken() {
  const token = crypto.randomBytes(32).toString('hex');
  adminTokens.set(token, Date.now());
  return token;
}

function adminAuth(req,res,next) {
  const auth = req.headers.authorization || '';

  if (!auth.startsWith('Bearer ')) {
    return res.status(401).json({
      error:'Admin authentication required.'
    });
  }

  const token = auth.substring(7);

  if (!adminTokens.has(token)) {
    return res.status(401).json({
      error:'Invalid or expired admin session.'
    });
  }

  req.adminToken = token;
  next();
}

/* ================= LOGIN ================= */

app.post('/api/admin/login',(req,res)=>{
  const {username,password}=req.body||{};

  if(username!==ADMIN_USERNAME ||
     password!==ADMIN_PASSWORD) {
    return res.status(401).json({
      error:'Invalid admin username or password.'
    });
  }

  res.json({
    success:true,
    token:createToken()
  });
});

app.post('/api/admin/logout',adminAuth,(req,res)=>{
  adminTokens.delete(req.adminToken);
  res.json({success:true});
});

/* ================= PUBLIC CONFIG ================= */

app.get('/api/config',(req,res)=>{
  res.json({
    paymentConfigured:!!gateway()
  });
});

/* ================= PUBLIC ROOMS ================= */

app.get('/api/rooms',(req,res)=>{
  const out={};

  for(const [category,data] of Object.entries(roomData)){
    out[category]=db.prepare(`
      SELECT room FROM rooms
      WHERE category=? AND status='available'
    `).all(category).map(x=>x.room);
  }

  res.json(out);
});

/* ================= CREATE ORDER ================= */

app.post('/api/create-order',async(req,res)=>{
  try{
    const rzp=gateway();

    if(!rzp){
      return res.status(503).json({
        error:'Razorpay is not configured.'
      });
    }

    const {
      amount,room,category,checkin,
      checkout,nights,guestName,phone
    }=req.body;

    if(!roomData[category] ||
       !roomData[category].rooms.includes(room)){
      return res.status(400).json({
        error:'Invalid room.'
      });
    }

    const current=db.prepare(`
      SELECT status FROM rooms
      WHERE category=? AND room=?
    `).get(category,room);

    if(!current || current.status!=='available'){
      return res.status(409).json({
        error:'Selected room is no longer available.'
      });
    }

    const expected =
      roomData[category].price * Number(nights);

    if(Number(amount)!==expected){
      return res.status(400).json({
        error:'Booking amount mismatch.'
      });
    }

    const order=await rzp.orders.create({
      amount:expected*100,
      currency:'INR',
      receipt:`SBH-${Date.now()}-${room}`,
      notes:{
        guestName,phone,room,category,
        checkin,checkout
      }
    });

    res.json({
      key:process.env.RAZORPAY_KEY_ID,
      orderId:order.id,
      amount:order.amount,
      currency:order.currency
    });

  }catch(e){
    console.error(e);
    res.status(500).json({
      error:'Unable to create payment order.'
    });
  }
});

/* ================= VERIFY PAYMENT ================= */

app.post('/api/verify-payment',(req,res)=>{
  try{
    if(!process.env.RAZORPAY_KEY_SECRET){
      return res.status(503).json({
        error:'Payment gateway is not configured.'
      });
    }

    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      booking
    }=req.body;

    const expected=crypto
      .createHmac(
        'sha256',
        process.env.RAZORPAY_KEY_SECRET
      )
      .update(
        `${razorpay_order_id}|${razorpay_payment_id}`
      )
      .digest('hex');

    if(expected!==razorpay_signature){
      return res.status(400).json({
        error:'Payment signature verification failed.'
      });
    }

    const room=db.prepare(`
      SELECT status FROM rooms
      WHERE category=? AND room=?
    `).get(booking.category,booking.room);

    if(!room || room.status!=='available'){
      return res.status(409).json({
        error:'Room is no longer available.'
      });
    }

    const bookingId =
      `SBH-${Date.now()}-${booking.room}`;

    const createdAt=new Date().toISOString();

    const insertBooking=db.prepare(`
      INSERT INTO bookings
      (bookingId,guestName,phone,category,room,
       checkin,checkout,amount,paymentStatus,
       paymentId,status,createdAt)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
    `);

    const insertPayment=db.prepare(`
      INSERT INTO payments
      (paymentId,bookingId,room,amount,status,createdAt)
      VALUES(?,?,?,?,?,?)
    `);

    const transaction=db.transaction(()=>{
      insertBooking.run(
        bookingId,
        booking.guestName,
        booking.phone,
        booking.category,
        booking.room,
        booking.checkin,
        booking.checkout,
        Number(booking.amount||0),
        'paid',
        razorpay_payment_id,
        'confirmed',
        createdAt
      );

      insertPayment.run(
        razorpay_payment_id,
        bookingId,
        booking.room,
        Number(booking.amount||0),
        'paid',
        createdAt
      );

      db.prepare(`
        UPDATE rooms SET status='booked'
        WHERE category=? AND room=?
      `).run(booking.category,booking.room);
    });

    transaction();

    res.json({
      success:true,
      bookingId
    });

  }catch(e){
    console.error(e);
    res.status(500).json({
      error:'Payment verification failed.'
    });
  }
});

/* ================= DASHBOARD ================= */

app.get('/api/admin/dashboard',adminAuth,(req,res)=>{

  const rooms={};
  let totalRooms=0;
  let availableRooms=0;
  let bookedRooms=0;

  for(const [category,data] of Object.entries(roomData)){

    const list=db.prepare(`
      SELECT room,status FROM rooms
      WHERE category=?
      ORDER BY room
    `).all(category);

    const available=list.filter(
      r=>r.status==='available'
    ).length;

    const booked=list.filter(
      r=>r.status==='booked'
    ).length;

    totalRooms+=list.length;
    availableRooms+=available;
    bookedRooms+=booked;

    rooms[category]={
      name:data.name,
      price:data.price,
      total:list.length,
      available,
      booked,
      rooms:list.map(r=>({
        number:r.room,
        status:r.status
      }))
    };
  }

  const bookings=db.prepare(`
    SELECT * FROM bookings
    ORDER BY createdAt ASC
  `).all();

  const payments=db.prepare(`
    SELECT * FROM payments
    ORDER BY createdAt ASC
  `).all();

  const revenue=payments
    .filter(p=>p.status==='paid')
    .reduce(
      (sum,p)=>sum+Number(p.amount||0),0
    );

  res.json({
    totalRooms,
    availableRooms,
    bookedRooms,
    revenue,
    rooms,
    bookings,
    payments
  });
});

/* ================= ROOM STATUS ================= */

app.post('/api/admin/rooms/status',adminAuth,(req,res)=>{
  const {category,room,status}=req.body||{};

  if(!roomData[category] ||
     !roomData[category].rooms.includes(room)){
    return res.status(400).json({
      error:'Invalid room.'
    });
  }

  if(!['available','booked','maintenance']
    .includes(status)){
    return res.status(400).json({
      error:'Invalid room status.'
    });
  }

  db.prepare(`
    UPDATE rooms SET status=?
    WHERE category=? AND room=?
  `).run(status,category,room);

  res.json({
    success:true,
    category,
    room,
    status
  });
});

/* ================= BOOKING DETAILS ================= */

app.get(
  '/api/admin/bookings/:id',
  adminAuth,
  (req,res)=>{
    const booking=db.prepare(`
      SELECT * FROM bookings
      WHERE bookingId=?
    `).get(req.params.id);

    if(!booking){
      return res.status(404).json({
        error:'Booking not found.'
      });
    }

    res.json({booking});
  }
);

/* ================= BOOKING STATUS ================= */

app.post(
  '/api/admin/bookings/:id/status',
  adminAuth,
  (req,res)=>{

    const {status}=req.body||{};

    if(!['confirmed','cancelled']
      .includes(status)){
      return res.status(400).json({
        error:'Invalid booking status.'
      });
    }

    const booking=db.prepare(`
      SELECT * FROM bookings
      WHERE bookingId=?
    `).get(req.params.id);

    if(!booking){
      return res.status(404).json({
        error:'Booking not found.'
      });
    }

    if(booking.status===status){
      return res.json({
        success:true,
        booking
      });
    }

    const tx=db.transaction(()=>{

      db.prepare(`
        UPDATE bookings
        SET status=?
        WHERE bookingId=?
      `).run(status,req.params.id);

      if(status==='cancelled'){
        db.prepare(`
          UPDATE rooms SET status='available'
          WHERE category=? AND room=?
        `).run(
          booking.category,
          booking.room
        );
      }

      if(status==='confirmed'){
        db.prepare(`
          UPDATE rooms SET status='booked'
          WHERE category=? AND room=?
        `).run(
          booking.category,
          booking.room
        );
      }
    });

    tx();

    res.json({
      success:true
    });
  }
);

/* ================= PAYMENT STATUS ================= */

app.post(
  '/api/admin/bookings/:id/payment',
  adminAuth,
  (req,res)=>{

    const {paymentStatus}=req.body||{};

    if(!['pending','paid','refunded']
      .includes(paymentStatus)){
      return res.status(400).json({
        error:'Invalid payment status.'
      });
    }

    const booking=db.prepare(`
      SELECT * FROM bookings
      WHERE bookingId=?
    `).get(req.params.id);

    if(!booking){
      return res.status(404).json({
        error:'Booking not found.'
      });
    }

    db.prepare(`
      UPDATE bookings
      SET paymentStatus=?
      WHERE bookingId=?
    `).run(paymentStatus,req.params.id);

    if(paymentStatus==='paid'){
      const existing=db.prepare(`
        SELECT paymentId FROM payments
        WHERE bookingId=?
      `).get(req.params.id);

      if(!existing){
        db.prepare(`
          INSERT INTO payments
          (paymentId,bookingId,room,amount,status,createdAt)
          VALUES(?,?,?,?,?,?)
        `).run(
          `MANUAL-${Date.now()}`,
          booking.bookingId,
          booking.room,
          booking.amount,
          'paid',
          new Date().toISOString()
        );
      }
    }

    if(paymentStatus==='refunded'){
      db.prepare(`
        UPDATE payments
        SET status='refunded'
        WHERE bookingId=?
      `).run(req.params.id);
    }

    res.json({success:true});
  }
);

/* ================= MANUAL BOOKING ================= */

app.post(
  '/api/admin/bookings',
  adminAuth,
  (req,res)=>{

    const {
      guestName,
      phone,
      category,
      room,
      checkin,
      checkout,
      amount,
      paymentStatus
    }=req.body||{};

    if(!guestName ||
       !phone ||
       !category ||
       !room ||
       !checkin ||
       !checkout){
      return res.status(400).json({
        error:'Please fill all booking details.'
      });
    }

    const current=db.prepare(`
      SELECT status FROM rooms
      WHERE category=? AND room=?
    `).get(category,room);

    if(!current){
      return res.status(400).json({
        error:'Invalid room.'
      });
    }

    if(current.status!=='available'){
      return res.status(409).json({
        error:'Room is not available.'
      });
    }

    const bookingId=
      `SBH-${Date.now()}-${room}`;

    const createdAt=new Date().toISOString();
    const pay=paymentStatus||'pending';
    const finalAmount=
      Number(amount||roomData[category].price);

    const tx=db.transaction(()=>{

      db.prepare(`
        INSERT INTO bookings
        (bookingId,guestName,phone,category,room,
         checkin,checkout,amount,paymentStatus,
         paymentId,status,createdAt)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        bookingId,
        guestName,
        phone,
        category,
        room,
        checkin,
        checkout,
        finalAmount,
        pay,
        pay==='paid'
          ?`MANUAL-${Date.now()}`
          :null,
        'confirmed',
        createdAt
      );

      db.prepare(`
        UPDATE rooms SET status='booked'
        WHERE category=? AND room=?
      `).run(category,room);

      if(pay==='paid'){
        db.prepare(`
          INSERT INTO payments
          (paymentId,bookingId,room,amount,status,createdAt)
          VALUES(?,?,?,?,?,?)
        `).run(
          `MANUAL-${Date.now()}`,
          bookingId,
          room,
          finalAmount,
          'paid',
          createdAt
        );
      }
    });

    tx();

    res.json({
      success:true,
      bookingId
    });
  }
);

/* ================= INVOICE ================= */

app.get(
  '/api/admin/bookings/:id/invoice',
  adminAuth,
  (req,res)=>{

    const b=db.prepare(`
      SELECT * FROM bookings
      WHERE bookingId=?
    `).get(req.params.id);

    if(!b){
      return res.status(404).json({
        error:'Booking not found.'
      });
    }

    const money=n =>
      `₹${Number(n||0).toLocaleString('en-IN')}`;

    const html=`
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Invoice ${b.bookingId}</title>
<style>
body{
  font-family:Arial,sans-serif;
  padding:40px;
  max-width:800px;
  margin:auto;
  color:#222
}
h1{margin-bottom:4px}
.gold{color:#b08a32}
.box{
  border:1px solid #ddd;
  padding:20px;
  margin-top:20px;
  border-radius:10px
}
table{
  width:100%;
  border-collapse:collapse;
  margin-top:20px
}
td,th{
  border-bottom:1px solid #ddd;
  padding:12px;
  text-align:left
}
.total{
  font-size:22px;
  font-weight:bold;
  text-align:right;
  margin-top:20px
}
button{
  padding:12px 20px;
  border:0;
  border-radius:6px;
  cursor:pointer
}
@media print{
  button{display:none}
}
</style>
</head>
<body>

<button onclick="window.print()">Print / Save PDF</button>

<h1>SHREE BALAJI HOTEL</h1>
<div class="gold">INVOICE / BOOKING RECEIPT</div>

<div class="box">
<b>Booking ID:</b> ${b.bookingId}<br>
<b>Date:</b> ${new Date(b.createdAt).toLocaleString('en-IN')}<br>
<b>Status:</b> ${b.status}<br>
<b>Payment:</b> ${b.paymentStatus}
</div>

<div class="box">
<b>Guest:</b> ${b.guestName}<br>
<b>Phone:</b> ${b.phone}<br>
<b>Room:</b> ${b.room}<br>
<b>Room Type:</b> ${b.category}<br>
<b>Check-in:</b> ${b.checkin}<br>
<b>Check-out:</b> ${b.checkout}
</div>

<table>
<tr>
<th>Description</th>
<th>Amount</th>
</tr>
<tr>
<td>${b.category} Room - Stay</td>
<td>${money(b.amount)}</td>
</tr>
</table>

<div class="total">
Total: ${money(b.amount)}
</div>

<p style="margin-top:50px">
Thank you for choosing Shree Balaji Hotel.
</p>

</body>
</html>`;

    res.json({html});
  }
);

/* ================= SETTINGS ================= */

app.get(
  '/api/admin/settings',
  adminAuth,
  (req,res)=>{
    res.json(
      db.prepare(`
        SELECT name,whatsapp,address,
        checkinTime,checkoutTime
        FROM settings WHERE id=1
      `).get()
    );
  }
);

app.post(
  '/api/admin/settings',
  adminAuth,
  (req,res)=>{

    const old=db.prepare(`
      SELECT * FROM settings WHERE id=1
    `).get();

    const s={
      ...old,
      ...req.body
    };

    db.prepare(`
      UPDATE settings
      SET name=?,
          whatsapp=?,
          address=?,
          checkinTime=?,
          checkoutTime=?
      WHERE id=1
    `).run(
      s.name,
      s.whatsapp,
      s.address,
      s.checkinTime,
      s.checkoutTime
    );

    res.json({
      success:true,
      settings:s
    });
  }
);

/* ================= FALLBACK ================= */

app.use((req,res)=>{
  res.sendFile(
    path.join(__dirname,'index.html')
  );
});

app.listen(PORT,()=>{
  console.log(
    `Shree Balaji Hotel running on port ${PORT}`
  );
});
