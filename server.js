const express = require('express');
const path = require('path');
const crypto = require('crypto');
const Razorpay = require('razorpay');

const app = express();
const PORT = process.env.PORT || 10000;

/* =========================
   HOTEL ROOM INVENTORY
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
   DATA
========================= */

const roomStatus = {};
const bookings = [];
const payments = [];
const adminTokens = new Map();

for (const [category, data] of Object.entries(roomData)) {
  roomStatus[category] = {};
  data.rooms.forEach(room => {
    roomStatus[category][room] = 'available';
  });
}

/* =========================
   MIDDLEWARE
========================= */

app.use(express.json());
app.use(express.static(__dirname));

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
   ADMIN AUTHENTICATION
========================= */

const ADMIN_USERNAME =
  process.env.ADMIN_USERNAME || 'admin';

const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD || 'SBH@2026#Admin';

function createAdminToken() {
  const token = crypto.randomBytes(32).toString('hex');

  adminTokens.set(token, {
    createdAt: Date.now()
  });

  return token;
}

function adminAuth(req, res, next) {
  const auth = req.headers.authorization || '';

  if (!auth.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Admin authentication required.'
    });
  }

  const token = auth.substring(7);

  if (!adminTokens.has(token)) {
    return res.status(401).json({
      error: 'Invalid or expired admin session.'
    });
  }

  req.adminToken = token;
  next();
}

/* =========================
   ADMIN LOGIN
========================= */

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body || {};

  if (
    username !== ADMIN_USERNAME ||
    password !== ADMIN_PASSWORD
  ) {
    return res.status(401).json({
      error: 'Invalid admin username or password.'
    });
  }

  const token = createAdminToken();

  res.json({
    success: true,
    token
  });
});

/* =========================
   ADMIN LOGOUT
========================= */

app.post('/api/admin/logout', adminAuth, (req, res) => {
  adminTokens.delete(req.adminToken);

  res.json({
    success: true
  });
});

/* =========================
   PUBLIC CONFIG
========================= */

app.get('/api/config', (req, res) => {
  res.json({
    paymentConfigured: !!gateway()
  });
});

/* =========================
   PUBLIC ROOM AVAILABILITY
========================= */

app.get('/api/rooms', (req, res) => {
  const out = {};

  for (const [category, data] of Object.entries(roomData)) {
    out[category] = data.rooms.filter(
      room => roomStatus[category][room] === 'available'
    );
  }

  res.json(out);
});

/* =========================
   CREATE RAZORPAY ORDER
========================= */

app.post('/api/create-order', async (req, res) => {
  try {
    const rzp = gateway();

    if (!rzp) {
      return res.status(503).json({
        error:
          'Razorpay is not configured yet. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in Render Environment Variables.'
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
      !roomData[category].rooms.includes(room) ||
      roomStatus[category][room] !== 'available'
    ) {
      return res.status(409).json({
        error:
          'Selected room is no longer available. Please choose another room.'
      });
    }

    if (
      !guestName ||
      !phone ||
      !checkin ||
      !checkout ||
      !nights ||
      Number(nights) < 1
    ) {
      return res.status(400).json({
        error: 'Invalid booking details.'
      });
    }

    const expected =
      roomData[category].price * Number(nights);

    if (Number(amount) !== expected) {
      return res.status(400).json({
        error: 'Booking amount mismatch.'
      });
    }

    const order = await rzp.orders.create({
      amount: expected * 100,
      currency: 'INR',
      receipt: `SBH-${Date.now()}-${room}`,
      notes: {
        guestName,
        phone,
        room,
        category,
        checkin,
        checkout
      }
    });

    res.json({
      key: process.env.RAZORPAY_KEY_ID,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency
    });

  } catch (e) {
    console.error(e);

    res.status(500).json({
      error: 'Unable to create payment order.'
    });
  }
});

/* =========================
   VERIFY PAYMENT
========================= */

app.post('/api/verify-payment', (req, res) => {
  try {
    if (!process.env.RAZORPAY_KEY_SECRET) {
      return res.status(503).json({
        error: 'Payment gateway is not configured.'
      });
    }

    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      booking
    } = req.body;

    if (
      !razorpay_order_id ||
      !razorpay_payment_id ||
      !razorpay_signature
    ) {
      return res.status(400).json({
        error: 'Incomplete payment response.'
      });
    }

    const expected = crypto
      .createHmac(
        'sha256',
        process.env.RAZORPAY_KEY_SECRET
      )
      .update(
        `${razorpay_order_id}|${razorpay_payment_id}`
      )
      .digest('hex');

    if (expected !== razorpay_signature) {
      return res.status(400).json({
        error: 'Payment signature verification failed.'
      });
    }

    if (
      !booking ||
      !roomData[booking.category] ||
      !roomData[booking.category].rooms.includes(
        booking.room
      )
    ) {
      return res.status(400).json({
        error: 'Invalid room.'
      });
    }

    if (
      roomStatus[booking.category][booking.room] !==
      'available'
    ) {
      return res.status(409).json({
        error: 'Room is no longer available.'
      });
    }

    roomStatus[booking.category][booking.room] =
      'booked';

    const bookingId =
      `SBH-${Date.now()}-${booking.room}`;

    const record = {
      bookingId,
      guestName: booking.guestName,
      phone: booking.phone,
      category: booking.category,
      room: booking.room,
      checkin: booking.checkin,
      checkout: booking.checkout,
      amount: Number(booking.amount || 0),
      paymentStatus: 'paid',
      paymentId: razorpay_payment_id,
      status: 'confirmed',
      createdAt: new Date().toISOString()
    };

    bookings.push(record);

    payments.push({
      paymentId: razorpay_payment_id,
      bookingId,
      room: booking.room,
      amount: record.amount,
      status: 'paid',
      createdAt: record.createdAt
    });

    res.json({
      success: true,
      bookingId
    });

  } catch (e) {
    console.error(e);

    res.status(500).json({
      error: 'Payment verification failed.'
    });
  }
});

/* =========================
   ADMIN DASHBOARD
========================= */

app.get(
  '/api/admin/dashboard',
  adminAuth,
  (req, res) => {

    const rooms = {};

    let totalRooms = 0;
    let availableRooms = 0;
    let bookedRooms = 0;

    for (const [category, data] of Object.entries(roomData)) {

      const roomList = data.rooms.map(room => ({
        number: room,
        status: roomStatus[category][room]
      }));

      const available = roomList.filter(
        r => r.status === 'available'
      ).length;

      const booked = roomList.filter(
        r => r.status === 'booked'
      ).length;

      totalRooms += roomList.length;
      availableRooms += available;
      bookedRooms += booked;

      rooms[category] = {
        name: data.name,
        price: data.price,
        total: roomList.length,
        available,
        booked,
        rooms: roomList
      };
    }

    const revenue = payments
      .filter(p => p.status === 'paid')
      .reduce(
        (sum, p) => sum + Number(p.amount || 0),
        0
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
  }
);

/* =========================
   ADMIN ROOM STATUS
========================= */

app.post(
  '/api/admin/rooms/status',
  adminAuth,
  (req, res) => {

    const {
      category,
      room,
      status
    } = req.body || {};

    if (
      !roomData[category] ||
      !roomData[category].rooms.includes(room)
    ) {
      return res.status(400).json({
        error: 'Invalid room.'
      });
    }

    if (
      !['available', 'booked', 'maintenance']
        .includes(status)
    ) {
      return res.status(400).json({
        error: 'Invalid room status.'
      });
    }

    roomStatus[category][room] = status;

    res.json({
      success: true,
      category,
      room,
      status
    });
  }
);

/* =========================
   ADMIN MANUAL BOOKING
========================= */

app.post(
  '/api/admin/bookings',
  adminAuth,
  (req, res) => {

    const {
      guestName,
      phone,
      category,
      room,
      checkin,
      checkout,
      amount,
      paymentStatus
    } = req.body || {};

    if (
      !guestName ||
      !phone ||
      !category ||
      !room ||
      !checkin ||
      !checkout
    ) {
      return res.status(400).json({
        error: 'Please fill all booking details.'
      });
    }

    if (
      !roomData[category] ||
      !roomData[category].rooms.includes(room)
    ) {
      return res.status(400).json({
        error: 'Invalid room.'
      });
    }

    if (
      roomStatus[category][room] !==
      'available'
    ) {
      return res.status(409).json({
        error: 'Room is not available.'
      });
    }

    const bookingId =
      `SBH-${Date.now()}-${room}`;

    const record = {
      bookingId,
      guestName,
      phone,
      category,
      room,
      checkin,
      checkout,
      amount: Number(amount || roomData[category].price),
      paymentStatus:
        paymentStatus || 'pending',
      status: 'confirmed',
      createdAt: new Date().toISOString()
    };

    bookings.push(record);

    roomStatus[category][room] =
      'booked';

    if (record.paymentStatus === 'paid') {
      payments.push({
        paymentId: `MANUAL-${Date.now()}`,
        bookingId,
        room,
        amount: record.amount,
        status: 'paid',
        createdAt: record.createdAt
      });
    }

    res.json({
      success: true,
      bookingId
    });
  }
);

/* =========================
   ADMIN SETTINGS
========================= */

let hotelSettings = {
  name: 'Shree Balaji Hotel',
  whatsapp: '7987510587',
  address: '4, Balaji Tower, Near ICICI Bank',
  checkinTime: '12:00',
  checkoutTime: '11:00'
};

app.post(
  '/api/admin/settings',
  adminAuth,
  (req, res) => {

    hotelSettings = {
      ...hotelSettings,
      ...req.body
    };

    res.json({
      success: true,
      settings: hotelSettings
    });
  }
);

/* =========================
   ADMIN SETTINGS GET
========================= */

app.get(
  '/api/admin/settings',
  adminAuth,
  (req, res) => {
    res.json(hotelSettings);
  }
);

/* =========================
   WEBSITE FALLBACK
========================= */

app.use((req, res) => {
  res.sendFile(
    path.join(__dirname, 'index.html')
  );
});

/* =========================
   START SERVER
========================= */

app.listen(PORT, () => {
  console.log(
    `Shree Balaji Hotel running on port ${PORT}`
  );
});
