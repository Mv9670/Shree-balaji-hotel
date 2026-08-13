const express = require('express');
const path = require('path');
const crypto = require('crypto');
const Razorpay = require('razorpay');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 10000;

/* =====================================================
   HOTEL ROOM INVENTORY
===================================================== */

const roomData = {
  standard: {
    name: 'Standard Room',
    price: 1000,
    rooms: [
      '205','206','207','208',
      '301','302','303','304','305','306','307'
    ]
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

/* =====================================================
   DATABASE
===================================================== */

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is missing.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

/* =====================================================
   MIDDLEWARE
===================================================== */

app.use(express.json());
app.use(express.static(__dirname));

/* =====================================================
   DATABASE INITIALIZATION
===================================================== */

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS room_status (
      category VARCHAR(50) NOT NULL,
      room VARCHAR(20) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'available',
      PRIMARY KEY (category, room)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bookings (
      id SERIAL PRIMARY KEY,
      booking_id VARCHAR(100) UNIQUE NOT NULL,
      guest_name VARCHAR(200) NOT NULL,
      phone VARCHAR(50) NOT NULL,
      category VARCHAR(50) NOT NULL,
      room VARCHAR(20) NOT NULL,
      checkin DATE NOT NULL,
      checkout DATE NOT NULL,
      amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      payment_status VARCHAR(30) NOT NULL DEFAULT 'pending',
      payment_id VARCHAR(200),
      status VARCHAR(30) NOT NULL DEFAULT 'confirmed',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY,
      payment_id VARCHAR(200) UNIQUE NOT NULL,
      booking_id VARCHAR(100) NOT NULL,
      room VARCHAR(20) NOT NULL,
      amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      status VARCHAR(30) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS payment_orders (
      id SERIAL PRIMARY KEY,
      order_id VARCHAR(200) UNIQUE NOT NULL,
      guest_name VARCHAR(200) NOT NULL,
      phone VARCHAR(50) NOT NULL,
      category VARCHAR(50) NOT NULL,
      room VARCHAR(20) NOT NULL,
      checkin DATE NOT NULL,
      checkout DATE NOT NULL,
      nights INTEGER NOT NULL,
      amount NUMERIC(12,2) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS hotel_settings (
      id INTEGER PRIMARY KEY,
      name VARCHAR(200) NOT NULL,
      whatsapp VARCHAR(50),
      address TEXT,
      checkin_time VARCHAR(20),
      checkout_time VARCHAR(20)
    );
  `);

  for (const [category, data] of Object.entries(roomData)) {
    for (const room of data.rooms) {
      await pool.query(
        `
        INSERT INTO room_status(category, room, status)
        VALUES($1, $2, 'available')
        ON CONFLICT(category, room) DO NOTHING
        `,
        [category, room]
      );
    }
  }

  await pool.query(
    `
    INSERT INTO hotel_settings
      (id, name, whatsapp, address, checkin_time, checkout_time)
    VALUES
      (1, $1, $2, $3, $4, $5)
    ON CONFLICT(id) DO NOTHING
    `,
    [
      'Shree Balaji Hotel',
      '7987510587',
      '4, Balaji Tower, Near ICICI Bank',
      '12:00',
      '11:00'
    ]
  );

  console.log('PostgreSQL database initialized.');
}

/* =====================================================
   RAZORPAY
===================================================== */

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

/* =====================================================
   ADMIN AUTHENTICATION
===================================================== */

const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const adminTokens = new Map();

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

/* =====================================================
   ADMIN LOGIN
===================================================== */

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body || {};

  if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
    return res.status(503).json({
      error: 'Admin credentials are not configured.'
    });
  }

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

/* =====================================================
   ADMIN LOGOUT
===================================================== */

app.post('/api/admin/logout', adminAuth, (req, res) => {
  adminTokens.delete(req.adminToken);

  res.json({
    success: true
  });
});

/* =====================================================
   PUBLIC CONFIG
===================================================== */

app.get('/api/config', (req, res) => {
  res.json({
    paymentConfigured: !!gateway()
  });
});

/* =====================================================
   PUBLIC ROOM AVAILABILITY
===================================================== */

app.get('/api/rooms', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT category, room
      FROM room_status
      WHERE status = 'available'
      ORDER BY room
    `);

    const out = {
      standard: [],
      deluxe: [],
      super: []
    };

    for (const row of result.rows) {
      if (out[row.category]) {
        out[row.category].push(row.room);
      }
    }

    res.json(out);

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: 'Unable to load room availability.'
    });
  }
});

/* =====================================================
   CREATE RAZORPAY ORDER
===================================================== */

app.post('/api/create-order', async (req, res) => {
  try {
    const rzp = gateway();

    if (!rzp) {
      return res.status(503).json({
        error:
          'Razorpay is not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in Render Environment Variables.'
      });
    }

    const {
      room,
      category,
      checkin,
      checkout,
      nights,
      guestName,
      phone
    } = req.body || {};

    if (
      !guestName ||
      !phone ||
      !checkin ||
      !checkout ||
      !room ||
      !category ||
      !nights
    ) {
      return res.status(400).json({
        error: 'Invalid booking details.'
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

    const roomResult = await pool.query(
      `
      SELECT status
      FROM room_status
      WHERE category = $1 AND room = $2
      `,
      [category, room]
    );

    if (
      !roomResult.rows.length ||
      roomResult.rows[0].status !== 'available'
    ) {
      return res.status(409).json({
        error:
          'Selected room is no longer available.'
      });
    }

    const numberOfNights = Number(nights);

    if (
      !Number.isInteger(numberOfNights) ||
      numberOfNights < 1
    ) {
      return res.status(400).json({
        error: 'Invalid number of nights.'
      });
    }

    const expectedAmount =
      roomData[category].price * numberOfNights;

    const order = await rzp.orders.create({
      amount: expectedAmount * 100,
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

    await pool.query(
      `
      INSERT INTO payment_orders
      (
        order_id,
        guest_name,
        phone,
        category,
        room,
        checkin,
        checkout,
        nights,
        amount
      )
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
      `,
      [
        order.id,
        guestName,
        phone,
        category,
        room,
        checkin,
        checkout,
        numberOfNights,
        expectedAmount
      ]
    );

    res.json({
      key: process.env.RAZORPAY_KEY_ID,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: 'Unable to create payment order.'
    });
  }
});

/* =====================================================
   VERIFY RAZORPAY PAYMENT
===================================================== */

app.post('/api/verify-payment', async (req, res) => {
  const client = await pool.connect();

  try {
    if (!process.env.RAZORPAY_KEY_SECRET) {
      return res.status(503).json({
        error: 'Payment gateway is not configured.'
      });
    }

    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature
    } = req.body || {};

    if (
      !razorpay_order_id ||
      !razorpay_payment_id ||
      !razorpay_signature
    ) {
      return res.status(400).json({
        error: 'Incomplete payment response.'
      });
    }

    const expectedSignature = crypto
      .createHmac(
        'sha256',
        process.env.RAZORPAY_KEY_SECRET
      )
      .update(
        `${razorpay_order_id}|${razorpay_payment_id}`
      )
      .digest('hex');

    if (
      expectedSignature !== razorpay_signature
    ) {
      return res.status(400).json({
        error:
          'Payment signature verification failed.'
      });
    }

    const orderResult = await client.query(
      `
      SELECT *
      FROM payment_orders
      WHERE order_id = $1
      `,
      [razorpay_order_id]
    );

    if (!orderResult.rows.length) {
      return res.status(404).json({
        error: 'Payment order not found.'
      });
    }

    const order = orderResult.rows[0];

    await client.query('BEGIN');

    const existingPayment = await client.query(
      `
      SELECT booking_id
      FROM payments
      WHERE payment_id = $1
      `,
      [razorpay_payment_id]
    );

    if (existingPayment.rows.length) {
      await client.query('ROLLBACK');

      return res.json({
        success: true,
        bookingId: existingPayment.rows[0].booking_id
      });
    }

    const roomResult = await client.query(
      `
      SELECT status
      FROM room_status
      WHERE category = $1
        AND room = $2
      FOR UPDATE
      `,
      [order.category, order.room]
    );

    if (
      !roomResult.rows.length ||
      roomResult.rows[0].status !== 'available'
    ) {
      await client.query('ROLLBACK');

      return res.status(409).json({
        error: 'Room is no longer available.'
      });
    }

    const bookingId =
      `SBH-${Date.now()}-${order.room}`;

    await client.query(
      `
      UPDATE room_status
      SET status = 'booked'
      WHERE category = $1
        AND room = $2
      `,
      [order.category, order.room]
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
        payment_id,
        status
      )
      VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,'paid',$9,'confirmed')
      `,
      [
        bookingId,
        order.guest_name,
        order.phone,
        order.category,
        order.room,
        order.checkin,
        order.checkout,
        order.amount,
        razorpay_payment_id
      ]
    );

    await client.query(
      `
      INSERT INTO payments
      (
        payment_id,
        booking_id,
        room,
        amount,
        status
      )
      VALUES($1,$2,$3,$4,'paid')
      `,
      [
        razorpay_payment_id,
        bookingId,
        order.room,
        order.amount
      ]
    );

    await client.query('COMMIT');

    res.json({
      success: true,
      bookingId
    });

  } catch (error) {
    await client.query('ROLLBACK');

    console.error(error);

    res.status(500).json({
      error: 'Payment verification failed.'
    });

  } finally {
    client.release();
  }
});

/* =====================================================
   ADMIN DASHBOARD
===================================================== */

app.get(
  '/api/admin/dashboard',
  adminAuth,
  async (req, res) => {
    try {
      const roomResult = await pool.query(`
        SELECT category, room, status
        FROM room_status
        ORDER BY category, room
      `);

      const bookingResult = await pool.query(`
        SELECT
          booking_id AS "bookingId",
          guest_name AS "guestName",
          phone,
          category,
          room,
          checkin,
          checkout,
          amount,
          payment_status AS "paymentStatus",
          payment_id AS "paymentId",
          status,
          created_at AS "createdAt"
        FROM bookings
        ORDER BY created_at ASC
      `);

      const paymentResult = await pool.query(`
        SELECT
          payment_id AS "paymentId",
          booking_id AS "bookingId",
          room,
          amount,
          status,
          created_at AS "createdAt"
        FROM payments
        ORDER BY created_at ASC
      `);

      const rooms = {};

      let totalRooms = 0;
      let availableRooms = 0;
      let bookedRooms = 0;

      for (const [category, data] of Object.entries(roomData)) {
        const categoryRooms = roomResult.rows
          .filter(r => r.category === category)
          .map(r => ({
            number: r.room,
            status: r.status
          }));

        const available =
          categoryRooms.filter(
            r => r.status === 'available'
          ).length;

        const booked =
          categoryRooms.filter(
            r => r.status === 'booked'
          ).length;

        totalRooms += categoryRooms.length;
        availableRooms += available;
        bookedRooms += booked;

        rooms[category] = {
          name: data.name,
          price: data.price,
          total: categoryRooms.length,
          available,
          booked,
          rooms: categoryRooms
        };
      }

      const revenue = paymentResult.rows
        .filter(p => p.status === 'paid')
        .reduce(
          (sum, p) =>
            sum + Number(p.amount || 0),
          0
        );

      res.json({
        totalRooms,
        availableRooms,
        bookedRooms,
        bookings: bookingResult.rows,
        payments: paymentResult.rows,
        revenue,
        rooms
      });

    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: 'Unable to load admin dashboard.'
      });
    }
  }
);

/* =====================================================
   ADMIN ROOM STATUS
===================================================== */

app.post(
  '/api/admin/rooms/status',
  adminAuth,
  async (req, res) => {
    try {
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
        ![
          'available',
          'booked',
          'maintenance'
        ].includes(status)
      ) {
        return res.status(400).json({
          error: 'Invalid room status.'
        });
      }

      await pool.query(
        `
        UPDATE room_status
        SET status = $1
        WHERE category = $2
          AND room = $3
        `,
        [status, category, room]
      );

      res.json({
        success: true,
        category,
        room,
        status
      });

    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: 'Unable to update room status.'
      });
    }
  }
);

/* =====================================================
   ADMIN MANUAL BOOKING
===================================================== */

app.post(
  '/api/admin/bookings',
  adminAuth,
  async (req, res) => {
    const client = await pool.connect();

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
          error:
            'Please fill all booking details.'
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

      await client.query('BEGIN');

      const roomResult = await client.query(
        `
        SELECT status
        FROM room_status
        WHERE category = $1
          AND room = $2
        FOR UPDATE
        `,
        [category, room]
      );

      if (
        !roomResult.rows.length ||
        roomResult.rows[0].status !== 'available'
      ) {
        await client.query('ROLLBACK');

        return res.status(409).json({
          error: 'Room is not available.'
        });
      }

      const bookingId =
        `SBH-${Date.now()}-${room}`;

      const finalAmount =
        Number(amount) ||
        roomData[category].price;

      const finalPaymentStatus =
        paymentStatus || 'pending';

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
          finalPaymentStatus
        ]
      );

      await client.query(
        `
        UPDATE room_status
        SET status = 'booked'
        WHERE category = $1
          AND room = $2
        `,
        [category, room]
      );

      if (finalPaymentStatus === 'paid') {
        await client.query(
          `
          INSERT INTO payments
          (
            payment_id,
            booking_id,
            room,
            amount,
            status
          )
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
        success: true,
        bookingId
      });

    } catch (error) {
      await client.query('ROLLBACK');

      console.error(error);

      res.status(500).json({
        error: 'Unable to create manual booking.'
      });

    } finally {
      client.release();
    }
  }
);

/* =====================================================
   ADMIN SETTINGS SAVE
===================================================== */

app.post(
  '/api/admin/settings',
  adminAuth,
  async (req, res) => {
    try {
      const {
        name,
        whatsapp,
        address,
        checkinTime,
        checkoutTime
      } = req.body || {};

      const result = await pool.query(
        `
        UPDATE hotel_settings
        SET
          name = COALESCE($1, name),
          whatsapp = COALESCE($2, whatsapp),
          address = COALESCE($3, address),
          checkin_time = COALESCE($4, checkin_time),
          checkout_time = COALESCE($5, checkout_time)
        WHERE id = 1
        RETURNING
          name,
          whatsapp,
          address,
          checkin_time AS "checkinTime",
          checkout_time AS "checkoutTime"
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
        success: true,
        settings: result.rows[0]
      });

    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: 'Unable to save settings.'
      });
    }
  }
);

/* =====================================================
   ADMIN SETTINGS GET
===================================================== */

app.get(
  '/api/admin/settings',
  adminAuth,
  async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT
          name,
          whatsapp,
          address,
          checkin_time AS "checkinTime",
          checkout_time AS "checkoutTime"
        FROM hotel_settings
        WHERE id = 1
      `);

      res.json(
        result.rows[0] || {}
      );

    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: 'Unable to load settings.'
      });
    }
  }
);

/* =====================================================
   WEBSITE FALLBACK
===================================================== */

app.use((req, res) => {
  res.sendFile(
    path.join(__dirname, 'index.html')
  );
});

/* =====================================================
   START SERVER
===================================================== */

async function startServer() {
  try {
    await initDatabase();

    app.listen(PORT, () => {
      console.log(
        `Shree Balaji Hotel running on port ${PORT}`
      );
    });

  } catch (error) {
    console.error(
      'Database initialization failed:',
      error
    );

    process.exit(1);
  }
}

startServer();
