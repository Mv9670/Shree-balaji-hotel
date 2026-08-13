const express = require('express');
const path = require('path');
const crypto = require('crypto');
const Razorpay = require('razorpay');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json({ limit: '2mb' }));
app.use(express.static(__dirname));

/* =========================
   HOTEL ROOMS
========================= */

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

/* =========================
   POSTGRESQL
========================= */

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is missing.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false
});

/* =========================
   DATABASE INIT
========================= */

async function initDB() {

  await pool.query(`
    CREATE TABLE IF NOT EXISTS rooms (
      category VARCHAR(30) NOT NULL,
      room VARCHAR(20) NOT NULL,
      status VARCHAR(30) DEFAULT 'available',
      PRIMARY KEY(category, room)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bookings (
      id SERIAL PRIMARY KEY,
      booking_id VARCHAR(100) UNIQUE NOT NULL,
      guest_name VARCHAR(200) NOT NULL,
      phone VARCHAR(50),
      category VARCHAR(30) NOT NULL,
      room VARCHAR(20) NOT NULL,
      checkin DATE NOT NULL,
      checkout DATE NOT NULL,
      amount NUMERIC(12,2) DEFAULT 0,
      payment_status VARCHAR(30) DEFAULT 'pending',
      payment_id VARCHAR(200),
      status VARCHAR(30) DEFAULT 'confirmed',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY,
      payment_id VARCHAR(200),
      booking_id VARCHAR(100),
      room VARCHAR(20),
      amount NUMERIC(12,2) DEFAULT 0,
      status VARCHAR(30) DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS hotel_settings (
      id INTEGER PRIMARY KEY,
      name VARCHAR(200),
      whatsapp VARCHAR(50),
      address TEXT,
      checkin_time VARCHAR(20),
      checkout_time VARCHAR(20)
    )
  `);

  for (const [category, data] of Object.entries(roomData)) {

    for (const room of data.rooms) {

      await pool.query(
        `
        INSERT INTO rooms(category, room, status)
        VALUES($1,$2,'available')
        ON CONFLICT(category,room) DO NOTHING
        `,
        [category, room]
      );

    }
  }

  await pool.query(`
    INSERT INTO hotel_settings
    (id,name,whatsapp,address,checkin_time,checkout_time)
    VALUES
    (1,'Shree Balaji Hotel','7987510587',
     '4, Balaji Tower, Near ICICI Bank',
     '12:00','11:00')
    ON CONFLICT(id) DO NOTHING
  `);

  console.log('PostgreSQL database ready.');
}

/* =========================
   RAZORPAY
========================= */

function gateway() {

  if (
    !process.env.RAZORPAY_KEY_ID ||
    !process.env.RAZORPAY_KEY_SECRET
  ) {
    return null;
  }

  return new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
  });
}

/* =========================
   ADMIN AUTH
========================= */

const ADMIN_USERNAME =
  process.env.ADMIN_USERNAME || 'admin';

const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD || 'SBH@2026#Admin';

const adminTokens = new Map();

function createAdminToken() {

  const token =
    crypto.randomBytes(32).toString('hex');

  adminTokens.set(token, {
    createdAt: Date.now()
  });

  return token;
}

function adminAuth(req,res,next) {

  const auth =
    req.headers.authorization || '';

  if (!auth.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Admin authentication required.'
    });
  }

  const token = auth.substring(7);

  if (!adminTokens.has(token)) {
    return res.status(401).json({
      error: 'Invalid admin session.'
    });
  }

  req.adminToken = token;

  next();
}

/* =========================
   ADMIN LOGIN
========================= */

app.post('/api/admin/login',(req,res)=>{

  const {
    username,
    password
  } = req.body || {};

  if (
    username !== ADMIN_USERNAME ||
    password !== ADMIN_PASSWORD
  ) {
    return res.status(401).json({
      error:'Invalid admin username or password.'
    });
  }

  const token =
    createAdminToken();

  res.json({
    success:true,
    token
  });

});

/* =========================
   LOGOUT
========================= */

app.post(
  '/api/admin/logout',
  adminAuth,
  (req,res)=>{

    adminTokens.delete(
      req.adminToken
    );

    res.json({
      success:true
    });

  }
);

/* =========================
   PUBLIC CONFIG
========================= */

app.get('/api/config',(req,res)=>{

  res.json({
    paymentConfigured:
      !!gateway()
  });

});

/* =========================
   PUBLIC ROOMS
========================= */

app.get('/api/rooms',async(req,res)=>{

  try {

    const result =
      await pool.query(`
        SELECT category,room,status
        FROM rooms
        ORDER BY category,room
      `);

    const out = {};

    for (const category of Object.keys(roomData)) {

      out[category] =
        result.rows
        .filter(x =>
          x.category === category &&
          x.status === 'available'
        )
        .map(x=>x.room);

    }

    res.json(out);

  } catch(e) {

    console.error(e);

    res.status(500).json({
      error:'Unable to load rooms.'
    });

  }

});

/* =========================
   CREATE PAYMENT ORDER
========================= */

app.post(
  '/api/create-order',
  async(req,res)=>{

    try {

      const rzp = gateway();

      if (!rzp) {
        return res.status(503).json({
          error:
          'Razorpay is not configured.'
        });
      }

      const {
        amount,
        room,
        category,
        checkin,
        checkout,
        nights,
        guestName,
        phone
      } = req.body;

      if (
        !roomData[category] ||
        !roomData[category].rooms.includes(room)
      ) {
        return res.status(400).json({
          error:'Invalid room.'
        });
      }

      const roomResult =
        await pool.query(
          `SELECT status FROM rooms
           WHERE category=$1 AND room=$2`,
          [category,room]
        );

      if (
        !roomResult.rows.length ||
        roomResult.rows[0].status !== 'available'
      ) {
        return res.status(409).json({
          error:'Room is no longer available.'
        });
      }

      const expected =
        roomData[category].price *
        Number(nights);

      if (
        Number(amount) !== expected
      ) {
        return res.status(400).json({
          error:'Booking amount mismatch.'
        });
      }

      const order =
        await rzp.orders.create({

          amount:
            expected * 100,

          currency:'INR',

          receipt:
            `SBH-${Date.now()}-${room}`,

          notes:{
            guestName,
            phone,
            room,
            category,
            checkin,
            checkout
          }

        });

      res.json({

        key:
          process.env.RAZORPAY_KEY_ID,

        orderId:
          order.id,

        amount:
          order.amount,

        currency:
          order.currency

      });

    } catch(e) {

      console.error(e);

      res.status(500).json({
        error:'Unable to create payment order.'
      });

    }

  }
);

/* =========================
   VERIFY PAYMENT
========================= */

app.post(
  '/api/verify-payment',
  async(req,res)=>{

    const client =
      await pool.connect();

    try {

      if (!process.env.RAZORPAY_KEY_SECRET) {
        return res.status(503).json({
          error:'Payment gateway not configured.'
        });
      }

      const {
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
        booking
      } = req.body;

      const expected =
        crypto
        .createHmac(
          'sha256',
          process.env.RAZORPAY_KEY_SECRET
        )
        .update(
          `${razorpay_order_id}|${razorpay_payment_id}`
        )
        .digest('hex');

      if (
        expected !==
        razorpay_signature
      ) {
        return res.status(400).json({
          error:'Payment verification failed.'
        });
      }

      await client.query('BEGIN');

      const room =
        await client.query(
          `SELECT status
           FROM rooms
           WHERE category=$1 AND room=$2
           FOR UPDATE`,
          [
            booking.category,
            booking.room
          ]
        );

      if (
        !room.rows.length ||
        room.rows[0].status !== 'available'
      ) {

        await client.query('ROLLBACK');

        return res.status(409).json({
          error:'Room is no longer available.'
        });

      }

      await client.query(
        `UPDATE rooms
         SET status='booked'
         WHERE category=$1 AND room=$2`,
        [
          booking.category,
          booking.room
        ]
      );

      const bookingId =
        `SBH-${Date.now()}-${booking.room}`;

      await client.query(
        `
        INSERT INTO bookings
        (
          booking_id,
          guest_name,
          phone,
          category,
          room,
          checkin,
          checkout,
          amount,
          payment_status,
          payment_id,
          status
        )
        VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,'paid',$9,'confirmed')
        `,
        [
          bookingId,
          booking.guestName,
          booking.phone,
          booking.category,
          booking.room,
          booking.checkin,
          booking.checkout,
          Number(booking.amount || 0),
          razorpay_payment_id
        ]
      );

      await client.query(
        `
        INSERT INTO payments
        (payment_id,booking_id,room,amount,status)
        VALUES($1,$2,$3,$4,'paid')
        `,
        [
          razorpay_payment_id,
          bookingId,
          booking.room,
          Number(booking.amount || 0)
        ]
      );

      await client.query('COMMIT');

      res.json({
        success:true,
        bookingId
      });

    } catch(e) {

      await client.query('ROLLBACK');

      console.error(e);

      res.status(500).json({
        error:'Payment verification failed.'
      });

    } finally {

      client.release();

    }

  }
);

/* =========================
   ADMIN DASHBOARD
========================= */

app.get(
  '/api/admin/dashboard',
  adminAuth,
  async(req,res)=>{

    try {

      const roomsResult =
        await pool.query(`
          SELECT category,room,status
          FROM rooms
          ORDER BY category,room
        `);

      const bookingsResult =
        await pool.query(`
          SELECT *
          FROM bookings
          ORDER BY created_at DESC
        `);

      const paymentsResult =
        await pool.query(`
          SELECT *
          FROM payments
          ORDER BY created_at DESC
        `);

      const rooms = {};

      let totalRooms = 0;
      let availableRooms = 0;
      let bookedRooms = 0;

      for (
        const [category,data]
        of Object.entries(roomData)
      ) {

        const list =
          roomsResult.rows
          .filter(x =>
            x.category === category
          )
          .map(x=>({
            number:x.room,
            status:x.status
          }));

        const available =
          list.filter(
            x=>x.status==='available'
          ).length;

        const booked =
          list.filter(
            x=>x.status==='booked'
          ).length;

        totalRooms += list.length;
        availableRooms += available;
        bookedRooms += booked;

        rooms[category] = {

          name:data.name,

          price:data.price,

          total:list.length,

          available,

          booked,

          rooms:list

        };

      }

      const revenue =
        paymentsResult.rows
        .filter(
          x=>x.status==='paid'
        )
        .reduce(
          (sum,x)=>
            sum+Number(x.amount||0),
          0
        );

      const bookings =
        bookingsResult.rows.map(normalizeBooking);

      const payments =
        paymentsResult.rows.map(normalizePayment);

      res.json({

        totalRooms,

        availableRooms,

        bookedRooms,

        revenue,

        rooms,

        bookings,

        payments

      });

    } catch(e) {

      console.error(e);

      res.status(500).json({
        error:'Unable to load dashboard.'
      });

    }

  }
);

/* =========================
   NORMALIZERS
========================= */

function normalizeBooking(b) {

  return {

    bookingId:b.booking_id,

    guestName:b.guest_name,

    phone:b.phone,

    category:b.category,

    room:b.room,

    checkin:b.checkin,

    checkout:b.checkout,

    amount:Number(b.amount),

    paymentStatus:b.payment_status,

    paymentId:b.payment_id,

    status:b.status,

    createdAt:b.created_at

  };

}

function normalizePayment(p) {

  return {

    paymentId:p.payment_id,

    bookingId:p.booking_id,

    room:p.room,

    amount:Number(p.amount),

    status:p.status,

    createdAt:p.created_at

  };

}

/* =========================
   ROOM STATUS
========================= */

app.post(
  '/api/admin/rooms/status',
  adminAuth,
  async(req,res)=>{

    try {

      const {
        category,
        room,
        status
      } = req.body;

      if (
        !roomData[category] ||
        !roomData[category].rooms.includes(room)
      ) {
        return res.status(400).json({
          error:'Invalid room.'
        });
      }

      if (
        ![
          'available',
          'booked',
          'maintenance'
        ].includes(status)
      ) {
        return res.status(400).json({
          error:'Invalid status.'
        });
      }

      await pool.query(
        `
        UPDATE rooms
        SET status=$1
        WHERE category=$2 AND room=$3
        `,
        [status,category,room]
      );

      res.json({
        success:true
      });

    } catch(e) {

      console.error(e);

      res.status(500).json({
        error:'Unable to update room.'
      });

    }

  }
);

/* =========================
   MANUAL BOOKING
========================= */

app.post(
  '/api/admin/bookings',
  adminAuth,
  async(req,res)=>{

    const client =
      await pool.connect();

    try {

      const {
        guestName,
        phone,
        category,
        room,
        checkin,
        checkout,
        amount,
        paymentStatus
      } = req.body;

      if (
        !guestName ||
        !phone ||
        !category ||
        !room ||
        !checkin ||
        !checkout
      ) {
        return res.status(400).json({
          error:'Please fill all booking details.'
        });
      }

      await client.query('BEGIN');

      const roomResult =
        await client.query(
          `
          SELECT status
          FROM rooms
          WHERE category=$1 AND room=$2
          FOR UPDATE
          `,
          [category,room]
        );

      if (
        !roomResult.rows.length ||
        roomResult.rows[0].status !== 'available'
      ) {

        await client.query('ROLLBACK');

        return res.status(409).json({
          error:'Room is not available.'
        });

      }

      const bookingId =
        `SBH-${Date.now()}-${room}`;

      const finalAmount =
        Number(
          amount ||
          roomData[category].price
        );

      await client.query(
        `
        INSERT INTO bookings
        (
          booking_id,
          guest_name,
          phone,
          category,
          room,
          checkin,
          checkout,
          amount,
          payment_status,
          status
        )
        VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,'confirmed')
        `,
        [
          bookingId,
          guestName,
          phone,
          category,
          room,
          checkin,
          checkout,
          finalAmount,
          paymentStatus || 'pending'
        ]
      );

      await client.query(
        `
        UPDATE rooms
        SET status='booked'
        WHERE category=$1 AND room=$2
        `,
        [category,room]
      );

      if (
        paymentStatus === 'paid'
      ) {

        await client.query(
          `
          INSERT INTO payments
          (payment_id,booking_id,room,amount,status)
          VALUES($1,$2,$3,$4,'paid')
          `,
          [
            `MANUAL-${Date.now()}`,
            bookingId,
            room,
            finalAmount
          ]
        );

      }

      await client.query('COMMIT');

      res.json({
        success:true,
        bookingId
      });

    } catch(e) {

      await client.query('ROLLBACK');

      console.error(e);

      res.status(500).json({
        error:'Unable to create booking.'
      });

    } finally {

      client.release();

    }

  }
);

/* =========================
   BOOKING DETAILS
========================= */

app.get(
  '/api/admin/bookings/:bookingId',
  adminAuth,
  async(req,res)=>{

    try {

      const result =
        await pool.query(
          `
          SELECT *
          FROM bookings
          WHERE booking_id=$1
          `,
          [req.params.bookingId]
        );

      if (!result.rows.length) {
        return res.status(404).json({
          error:'Booking not found.'
        });
      }

      res.json({
        booking:
          normalizeBooking(
            result.rows[0]
          )
      });

    } catch(e) {

      res.status(500).json({
        error:'Unable to load booking.'
      });

    }

  }
);

/* =========================
   GUEST SEARCH
========================= */

app.get(
  '/api/admin/bookings/search',
  adminAuth,
  async(req,res)=>{

    try {

      const q =
        String(req.query.q || '')
        .trim();

      if (!q) {
        return res.json({
          bookings:[]
        });
      }

      const result =
        await pool.query(
          `
          SELECT *
          FROM bookings
          WHERE
            guest_name ILIKE $1
            OR phone ILIKE $1
            OR booking_id ILIKE $1
            OR room ILIKE $1
          ORDER BY created_at DESC
          `,
          [`%${q}%`]
        );

      res.json({
        bookings:
          result.rows.map(
            normalizeBooking
          )
      });

    } catch(e) {

      console.error(e);

      res.status(500).json({
        error:'Search failed.'
      });

    }

  }
);

/* =========================
   CHANGE BOOKING STATUS
========================= */

app.post(
  '/api/admin/bookings/status',
  adminAuth,
  async(req,res)=>{

    try {

      const {
        bookingId,
        status
      } = req.body;

      const allowed = [
        'confirmed',
        'checked-in',
        'checked-out',
        'cancelled',
        'no-show'
      ];

      if (!allowed.includes(status)) {
        return res.status(400).json({
          error:'Invalid booking status.'
        });
      }

      const result =
        await pool.query(
          `
          UPDATE bookings
          SET status=$1
          WHERE booking_id=$2
          RETURNING *
          `,
          [status,bookingId]
        );

      if (!result.rows.length) {
        return res.status(404).json({
          error:'Booking not found.'
        });
      }

      if (status === 'cancelled') {

        const b =
          result.rows[0];

        await pool.query(
          `
          UPDATE rooms
          SET status='available'
          WHERE category=$1 AND room=$2
          `,
          [b.category,b.room]
        );

      }

      res.json({
        success:true,
        booking:
          normalizeBooking(
            result.rows[0]
          )
      });

    } catch(e) {

      console.error(e);

      res.status(500).json({
        error:'Unable to change booking status.'
      });

    }

  }
);

/* =========================
   PAYMENT STATUS
========================= */

app.post(
  '/api/admin/payments/status',
  adminAuth,
  async(req,res)=>{

    try {

      const {
        bookingId,
        status
      } = req.body;

      if (
        ![
          'paid',
          'pending',
          'failed',
          'refunded'
        ].includes(status)
      ) {
        return res.status(400).json({
          error:'Invalid payment status.'
        });
      }

      const booking =
        await pool.query(
          `
          SELECT *
          FROM bookings
          WHERE booking_id=$1
          `,
          [bookingId]
        );

      if (!booking.rows.length) {
        return res.status(404).json({
          error:'Booking not found.'
        });
      }

      await pool.query(
        `
        UPDATE bookings
        SET payment_status=$1
        WHERE booking_id=$2
        `,
        [status,bookingId]
      );

      await pool.query(
        `
        UPDATE payments
        SET status=$1
        WHERE booking_id=$2
        `,
        [status,bookingId]
      );

      res.json({
        success:true,
        status
      });

    } catch(e) {

      console.error(e);

      res.status(500).json({
        error:'Unable to update payment.'
      });

    }

  }
);

/* =========================
   CANCEL BOOKING
========================= */

app.post(
  '/api/admin/bookings/cancel',
  adminAuth,
  async(req,res)=>{

    try {

      const {
        bookingId
      } = req.body;

      const result =
        await pool.query(
          `
          UPDATE bookings
          SET status='cancelled'
          WHERE booking_id=$1
          RETURNING *
          `,
          [bookingId]
        );

      if (!result.rows.length) {
        return res.status(404).json({
          error:'Booking not found.'
        });
      }

      const b =
        result.rows[0];

      await pool.query(
        `
        UPDATE rooms
        SET status='available'
        WHERE category=$1 AND room=$2
        `,
        [b.category,b.room]
      );

      res.json({
        success:true
      });

    } catch(e) {

      console.error(e);

      res.status(500).json({
        error:'Unable to cancel booking.'
      });

    }

  }
);

/* =========================
   INVOICE / RECEIPT
========================= */

app.get(
  '/api/admin/bookings/:bookingId/invoice',
  adminAuth,
  async(req,res)=>{

    try {

      const result =
        await pool.query(
          `
          SELECT *
          FROM bookings
          WHERE booking_id=$1
          `,
          [req.params.bookingId]
        );

      if (!result.rows.length) {
        return res.status(404).send(
          'Booking not found.'
        );
      }

      const b =
        normalizeBooking(
          result.rows[0]
        );

      const settings =
        await pool.query(
          `SELECT * FROM hotel_settings
           WHERE id=1`
        );

      const s =
        settings.rows[0];

      res.setHeader(
        'Content-Type',
        'text/html'
      );

      res.send(`
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Invoice ${b.bookingId}</title>
<style>
body{
font-family:Arial,sans-serif;
padding:40px;
max-width:800px;
margin:auto;
}
h1{margin-bottom:5px}
.header{
display:flex;
justify-content:space-between;
border-bottom:2px solid #c9a64b;
padding-bottom:20px;
}
table{
width:100%;
border-collapse:collapse;
margin-top:30px;
}
td,th{
padding:12px;
border:1px solid #ddd;
text-align:left;
}
.total{
font-size:20px;
font-weight:bold;
}
button{
padding:12px 20px;
background:#c9a64b;
border:0;
cursor:pointer;
}
@media print{
button{display:none}
}
</style>
</head>
<body>

<div class="header">
<div>
<h1>${s.name}</h1>
<p>${s.address}</p>
<p>WhatsApp: ${s.whatsapp}</p>
</div>
<div>
<h2>INVOICE</h2>
<p>${b.bookingId}</p>
</div>
</div>

<h3>Guest Details</h3>

<table>
<tr>
<th>Guest</th>
<td>${b.guestName}</td>
</tr>
<tr>
<th>Phone</th>
<td>${b.phone}</td>
</tr>
<tr>
<th>Room</th>
<td>${b.room} - ${b.category}</td>
</tr>
<tr>
<th>Check-in</th>
<td>${b.checkin}</td>
</tr>
<tr>
<th>Check-out</th>
<td>${b.checkout}</td>
</tr>
<tr>
<th>Payment</th>
<td>${b.paymentStatus}</td>
</tr>
<tr>
<th>Status</th>
<td>${b.status}</td>
</tr>
<tr>
<th class="total">Total</th>
<td class="total">₹${b.amount.toLocaleString('en-IN')}</td>
</tr>
</table>

<br>

<button onclick="window.print()">
Print / Save PDF
</button>

</body>
</html>
      `);

    } catch(e) {

      console.error(e);

      res.status(500).send(
        'Unable to generate invoice.'
      );

    }

  }
);

/* =========================
   WHATSAPP CONFIRMATION
========================= */

app.get(
  '/api/admin/bookings/:bookingId/whatsapp',
  adminAuth,
  async(req,res)=>{

    try {

      const result =
        await pool.query(
          `
          SELECT *
          FROM bookings
          WHERE booking_id=$1
          `,
          [req.params.bookingId]
        );

      if (!result.rows.length) {
        return res.status(404).json({
          error:'Booking not found.'
        });
      }

      const b =
        normalizeBooking(
          result.rows[0]
        );

      const message =
`Namaste ${b.guestName},

Your booking at Shree Balaji Hotel is confirmed.

Booking ID: ${b.bookingId}
Room: ${b.room}
Room Type: ${b.category}
Check-in: ${b.checkin}
Check-out: ${b.checkout}
Amount: ₹${b.amount.toLocaleString('en-IN')}
Payment: ${b.paymentStatus}

Thank you for choosing Shree Balaji Hotel.`;

      const phone =
        String(b.phone || '')
        .replace(/\D/g,'');

      const whatsappUrl =
        `https://wa.me/${phone}?text=` +
        encodeURIComponent(message);

      res.json({
        success:true,
        whatsappUrl
      });

    } catch(e) {

      res.status(500).json({
        error:'Unable to create WhatsApp link.'
      });

    }

  }
);

/* =========================
   SETTINGS
========================= */

app.get(
  '/api/admin/settings',
  adminAuth,
  async(req,res)=>{

    const result =
      await pool.query(
        `SELECT * FROM hotel_settings
         WHERE id=1`
      );

    res.json(
      result.rows[0]
    );

  }
);

app.post(
  '/api/admin/settings',
  adminAuth,
  async(req,res)=>{

    try {

      const {
        name,
        whatsapp,
        address,
        checkinTime,
        checkoutTime
      } = req.body;

      await pool.query(
        `
        UPDATE hotel_settings
        SET
          name=$1,
          whatsapp=$2,
          address=$3,
          checkin_time=$4,
          checkout_time=$5
        WHERE id=1
        `,
        [
          name,
          whatsapp,
          address,
          checkinTime,
          checkoutTime
        ]
      );

      res.json({
        success:true
      });

    } catch(e) {

      res.status(500).json({
        error:'Unable to save settings.'
      });

    }

  }
);

/* =========================
   FALLBACK
========================= */

app.use((req,res)=>{
  res.sendFile(
    path.join(
      __dirname,
      'index.html'
    )
  );
});

/* =========================
   START
========================= */

async function start(){

  try {

    await initDB();

    app.listen(
      PORT,
      ()=>{
        console.log(
          `Shree Balaji Hotel running on port ${PORT}`
        );
      }
    );

  } catch(e) {

    console.error(
      'DATABASE STARTUP ERROR:',
      e
    );

    process.exit(1);

  }

}

start();
