const state = {
  token: localStorage.getItem('sbhAdminToken') || '',
  data: null
};

const $ = s => document.querySelector(s);

const fmt = n =>
  `₹${Number(n || 0).toLocaleString('en-IN')}`;

async function api(url, opts = {}) {
  opts.headers = {
    ...(opts.headers || {}),
    'Content-Type': 'application/json'
  };

  if (state.token) {
    opts.headers.Authorization =
      `Bearer ${state.token}`;
  }

  const r = await fetch(url, opts);

  let j = {};
  try {
    j = await r.json();
  } catch {}

  if (r.status === 401) {
    logout(false);
    throw new Error('Session expired. Please login again.');
  }

  if (!r.ok) {
    throw new Error(j.error || 'Request failed');
  }

  return j;
}

/* =========================
   LOGIN / LOGOUT
========================= */

function showApp() {
  $('#loginView')?.classList.add('hidden');
  $('#appView')?.classList.remove('hidden');
  loadAll();
}

function logout(call = true) {
  localStorage.removeItem('sbhAdminToken');
  state.token = '';

  $('#appView')?.classList.add('hidden');
  $('#loginView')?.classList.remove('hidden');

  if (call) location.reload();
}

$('#loginForm')?.addEventListener('submit', async e => {
  e.preventDefault();

  $('#loginError').textContent = '';

  try {
    const j = await api('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({
        username: $('#adminUser').value,
        password: $('#adminPass').value
      })
    });

    state.token = j.token;

    localStorage.setItem(
      'sbhAdminToken',
      state.token
    );

    showApp();

  } catch (err) {
    $('#loginError').textContent =
      err.message;
  }
});

$('#logoutBtn')?.addEventListener(
  'click',
  () => logout()
);

/* =========================
   NAVIGATION
========================= */

function switchView(v) {

  document
    .querySelectorAll('.view')
    .forEach(x =>
      x.classList.add('hidden')
    );

  $(`#${v}View`)?.classList.remove('hidden');

  document
    .querySelectorAll('.nav-item')
    .forEach(b =>
      b.classList.toggle(
        'active',
        b.dataset.view === v
      )
    );

  const titles = {
    dashboard: 'Dashboard',
    rooms: 'Room Inventory',
    bookings: 'Bookings',
    payments: 'Payments',
    settings: 'Settings'
  };

  if ($('#pageTitle')) {
    $('#pageTitle').textContent =
      titles[v] || 'Dashboard';
  }

  if (v === 'bookings')
    renderBookings();

  if (v === 'payments')
    renderPayments();

  if (v === 'rooms')
    renderRooms();
}

document
  .querySelectorAll('.nav-item')
  .forEach(b =>
    b.addEventListener(
      'click',
      () => switchView(b.dataset.view)
    )
  );

document
  .querySelectorAll('[data-jump]')
  .forEach(b =>
    b.addEventListener(
      'click',
      () => switchView(b.dataset.jump)
    )
  );

/* =========================
   LOAD DASHBOARD
========================= */

async function loadAll() {

  try {

    state.data =
      await api('/api/admin/dashboard');

    renderDashboard();
    renderRooms();
    renderBookings();
    renderPayments();

    if ($('#lastUpdated')) {
      $('#lastUpdated').textContent =
        'Updated ' +
        new Date().toLocaleTimeString(
          [],
          {
            hour: '2-digit',
            minute: '2-digit'
          }
        );
    }

    loadSettings();

  } catch (e) {

    if (state.token) {
      alert(e.message);
    }

  }
}

/* =========================
   DASHBOARD
========================= */

function renderDashboard() {

  const d = state.data;

  if (!d) return;

  $('#mTotal').textContent =
    d.totalRooms;

  $('#mAvailable').textContent =
    d.availableRooms;

  $('#mBooked').textContent =
    d.bookedRooms;

  $('#mBookings').textContent =
    d.bookings.length;

  $('#pRevenue').textContent =
    fmt(d.revenue);

  $('#pPaid').textContent =
    d.payments.filter(
      x => x.status === 'paid'
    ).length;

  $('#pPending').textContent =
    d.payments.filter(
      x => x.status !== 'paid'
    ).length;

  if ($('#dashRooms')) {
    $('#dashRooms').innerHTML =
      groupsHtml(d.rooms);
  }

  if ($('#recentBookings')) {

    $('#recentBookings').innerHTML =
      d.bookings
        .slice(0, 6)
        .map(bookingHtml)
        .join('') ||
      '<p class="muted">No bookings yet.</p>';
  }
}

function groupsHtml(groups) {

  return Object.entries(groups)
    .map(([cat, g]) => {

      return `
      <div class="room-group">

        <div class="room-group-head">

          <h4>
            ${g.name}
            · ${fmt(g.price)}/night
          </h4>

          <span class="tag ${
            g.available
              ? 'green'
              : 'red'
          }">
            ${g.available}
            available / ${g.total}
          </span>

        </div>

        <div class="room-badges">

          ${g.rooms.map(r => `
            <span
              class="room-badge ${r.status}"
              title="${r.status}"
              onclick="quickStatus(
                '${cat}',
                '${r.number}'
              )">

              ${r.number}
              · ${r.status}

            </span>
          `).join('')}

        </div>

      </div>
      `;

    })
    .join('');
}

/* =========================
   ROOM INVENTORY
========================= */

function renderRooms() {

  if (!state.data) return;

  $('#roomInventory').innerHTML =
    Object.entries(state.data.rooms)
      .map(([cat, g]) => {

        return `
        <div class="room-group">

          <div class="room-group-head">

            <h4>${g.name}</h4>

            <span class="tag ${
              g.available
                ? 'green'
                : 'red'
            }">

              ${g.available}
              AVAILABLE

            </span>

          </div>

          <table class="room-table">

            <thead>
              <tr>
                <th>Room</th>
                <th>Status</th>
                <th>Rate</th>
                <th>Action</th>
              </tr>
            </thead>

            <tbody>

              ${g.rooms.map(r => `

                <tr>

                  <td>
                    <b>Room ${r.number}</b>
                  </td>

                  <td>

                    <span class="tag ${
                      r.status === 'available'
                        ? 'green'
                        : r.status === 'booked'
                        ? 'red'
                        : 'gold'
                    }">

                      ${r.status.toUpperCase()}

                    </span>

                  </td>

                  <td>
                    ${fmt(g.price)}
                  </td>

                  <td>

                    <select
                      class="status-select"
                      onchange="
                        changeStatus(
                          '${cat}',
                          '${r.number}',
                          this.value
                        )
                      ">

                      <option ${
                        r.status === 'available'
                          ? 'selected'
                          : ''
                      }>
                        available
                      </option>

                      <option ${
                        r.status === 'booked'
                          ? 'selected'
                          : ''
                      }>
                        booked
                      </option>

                      <option ${
                        r.status === 'maintenance'
                          ? 'selected'
                          : ''
                      }>
                        maintenance
                      </option>

                    </select>

                  </td>

                </tr>

              `).join('')}

            </tbody>

          </table>

        </div>
        `;

      })
      .join('');
}

async function changeStatus(
  category,
  room,
  status
) {

  try {

    await api(
      '/api/admin/rooms/status',
      {
        method: 'POST',
        body: JSON.stringify({
          category,
          room,
          status
        })
      }
    );

    await loadAll();

  } catch (e) {

    alert(e.message);

  }
}

async function quickStatus(
  category,
  room
) {

  const s = prompt(
    `Set Room ${room} status:
available / booked / maintenance`,
    'available'
  );

  if (
    !s ||
    ![
      'available',
      'booked',
      'maintenance'
    ].includes(s)
  ) return;

  await changeStatus(
    category,
    room,
    s
  );
}

/* =========================
   BOOKING MINI CARD
========================= */

function bookingHtml(b) {

  return `
  <div class="booking-mini">

    <b>${b.bookingId}</b>

    <div>
      ${b.guestName}
      · Room ${b.room}
      · ${b.category}
    </div>

    <small>
      ${b.checkin}
      →
      ${b.checkout}
      · ${fmt(b.amount)}

      ·

      <span class="tag ${
        b.paymentStatus === 'paid'
          ? 'green'
          : 'gold'
      }">

        ${b.paymentStatus}

      </span>

    </small>

  </div>
  `;
}

/* =========================
   BOOKINGS
========================= */

function renderBookings() {

  if (!state.data) return;

  const q =
    (
      $('#bookingSearch')?.value ||
      ''
    ).toLowerCase();

  const st =
    $('#bookingStatus')?.value ||
    'all';

  let rows =
    state.data.bookings.filter(b => {

      const matchesStatus =
        st === 'all' ||
        b.status === st;

      const matchesSearch =
        !q ||
        JSON.stringify(b)
          .toLowerCase()
          .includes(q);

      return (
        matchesStatus &&
        matchesSearch
      );

    });

  $('#bookingRows').innerHTML =

    rows.map(b => `

      <tr>

        <td>

          <b>${b.bookingId}</b>

          <br>

          <small>
            ${new Date(
              b.createdAt
            ).toLocaleString()}
          </small>

        </td>

        <td>

          ${b.guestName}

          <br>

          <small>
            ${b.phone || ''}
          </small>

        </td>

        <td>

          ${b.room}

          <br>

          <small>
            ${b.category}
          </small>

        </td>

        <td>

          ${b.checkin}

          <br>

          ${b.checkout}

        </td>

        <td>
          ${fmt(b.amount)}
        </td>

        <td>

          <span class="tag ${
            b.paymentStatus === 'paid'
              ? 'green'
              : b.paymentStatus === 'failed'
              ? 'red'
              : 'gold'
          }">

            ${b.paymentStatus}

          </span>

          ${
            b.paymentId
              ? `<br><small>
                   ${b.paymentId}
                 </small>`
              : ''
          }

        </td>

        <td>

          <span class="tag ${
            b.status === 'confirmed'
              ? 'green'
              : b.status === 'cancelled'
              ? 'red'
              : 'gold'
          }">

            ${b.status}

          </span>

        </td>

        <td>

          <div class="booking-actions">

            <button
              onclick="
                viewBooking(
                  '${b.bookingId}'
                )
              ">
              Details
            </button>

            <button
              onclick="
                changeBookingStatus(
                  '${b.bookingId}'
                )
              ">
              Status
            </button>

            <button
              onclick="
                changePaymentStatus(
                  '${b.bookingId}'
                )
              ">
              Payment
            </button>

            ${
              b.status !== 'cancelled'
              ? `
              <button
                onclick="
                  cancelBooking(
                    '${b.bookingId}'
                  )
                ">
                Cancel
              </button>
              `
              : ''
            }

            <button
              onclick="
                openInvoice(
                  '${b.bookingId}'
                )
              ">
              Invoice
            </button>

            <button
              onclick="
                openWhatsApp(
                  '${b.bookingId}'
                )
              ">
              WhatsApp
            </button>

          </div>

        </td>

      </tr>

    `).join('') ||

    `
    <tr>
      <td colspan="8"
          class="muted">
        No matching bookings.
      </td>
    </tr>
    `;
}

/* =========================
   SEARCH
========================= */

$('#bookingSearch')
  ?.addEventListener(
    'input',
    renderBookings
  );

$('#bookingStatus')
  ?.addEventListener(
    'change',
    renderBookings
  );

/* =========================
   BOOKING DETAILS
========================= */

async function viewBooking(
  bookingId
) {

  try {

    const j =
      await api(
        `/api/admin/bookings/${encodeURIComponent(
          bookingId
        )}`
      );

    const b = j.booking;

    alert(`
BOOKING DETAILS

Booking ID:
${b.bookingId}

Guest:
${b.guestName}

Phone:
${b.phone}

Room:
${b.room}

Room Type:
${b.category}

Check-in:
${b.checkin}

Check-out:
${b.checkout}

Amount:
${fmt(b.amount)}

Payment:
${b.paymentStatus}

Booking Status:
${b.status}
    `);

  } catch (e) {

    alert(e.message);

  }
}

/* =========================
   BOOKING STATUS
========================= */

async function changeBookingStatus(bookingId) {
    // Create overlay
    const overlay = document.createElement('div');

    overlay.style.cssText = `
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.45);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 99999;
        padding: 20px;
    `;

    // Create box
    const box = document.createElement('div');

    box.style.cssText = `
        background: #fff;
        width: min(420px, 100%);
        border-radius: 18px;
        padding: 24px;
        box-shadow: 0 20px 60px rgba(0,0,0,0.25);
        font-family: Arial, sans-serif;
    `;

    box.innerHTML = `
        <h2 style="margin:0 0 18px 0;">
            Booking Status
        </h2>

        <label style="
            display:block;
            margin-bottom:8px;
            font-weight:600;
        ">
            Select booking status
        </label>

        <select id="bookingStatusSelect" style="
            width:100%;
            padding:14px;
            font-size:16px;
            border:1px solid #ccc;
            border-radius:10px;
            background:#fff;
            margin-bottom:20px;
        ">
            <option value="confirmed">Confirmed</option>
            <option value="checked-in">Checked-in</option>
            <option value="checked-out">Checked-out</option>
            <option value="cancelled">Cancelled</option>
            <option value="no-show">No-show</option>
        </select>

        <div style="
            display:flex;
            gap:10px;
            justify-content:flex-end;
        ">
            <button id="statusCancelBtn" style="
                padding:12px 18px;
                border:1px solid #ccc;
                border-radius:10px;
                background:#fff;
                font-size:15px;
            ">
                Cancel
            </button>

            <button id="statusSaveBtn" style="
                padding:12px 20px;
                border:0;
                border-radius:10px;
                background:#b08a2e;
                color:#fff;
                font-size:15px;
                font-weight:600;
            ">
                Update Status
            </button>
        </div>
    `;

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const select = box.querySelector('#bookingStatusSelect');
    const cancelBtn = box.querySelector('#statusCancelBtn');
    const saveBtn = box.querySelector('#statusSaveBtn');

    // Close popup
    cancelBtn.onclick = () => {
        overlay.remove();
    };

    // Update status
    saveBtn.onclick = async () => {
        const status = select.value;

        saveBtn.disabled = true;
        saveBtn.textContent = 'Updating...';

        try {
            await api(`/api/admin/bookings/${bookingId}/status`, {
                method: 'PATCH',
                body: JSON.stringify({
                    status: status
                })
            });

            overlay.remove();

            alert(`Booking status updated to: ${status}`);

            await loadAll();

        } catch (e) {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Update Status';

            alert(
                e.message ||
                'Unable to update booking status.'
            );
        }
    };
}

/* =========================
   PAYMENT STATUS
========================= */

async function changePaymentStatus(bookingId) {

  const overlay = document.createElement('div');

  overlay.style.cssText =
    'position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:99999';

  overlay.innerHTML = `
    <div style="
      background:white;
      padding:25px;
      border-radius:16px;
      width:360px;
      max-width:90%;
    ">

      <h2>Payment Status</h2>

      <select id="paymentStatusSelect"
        style="
          width:100%;
          padding:12px;
          font-size:16px;
          border-radius:8px;
          margin:15px 0;
        ">

        <option value="paid">Paid</option>
        <option value="pending">Pending</option>
        <option value="failed">Failed</option>
        <option value="refunded">Refunded</option>

      </select>

      <div style="display:flex;gap:10px">

        <button
          id="paymentCancel"
          style="flex:1;padding:12px">
          Cancel
        </button>

        <button
          id="paymentSave"
          style="flex:1;padding:12px">
          Update Payment
        </button>

      </div>

    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector('#paymentCancel').onclick =
    () => overlay.remove();

  overlay.querySelector('#paymentSave').onclick =
    async () => {

      const paymentStatus =
        overlay.querySelector(
          '#paymentStatusSelect'
        ).value;

      try {

        await api(
          `/api/admin/payments/status`,
          {
            method:'POST',
            body:JSON.stringify({
              bookingId,
              status:paymentStatus
            })
          }
        );

        overlay.remove();

        alert(
          `Payment status updated to ${paymentStatus}`
        );

        await loadAll();

      } catch(e) {

        alert(e.message);

      }
    };
}

/* =========================
   CANCEL BOOKING
========================= */

async function cancelBooking(
  bookingId
) {

  if (
    !confirm(
      `Cancel booking ${bookingId}?`
    )
  ) return;

  try {

    await api(
      '/api/admin/bookings/cancel',
      {
        method: 'POST',
        body: JSON.stringify({
          bookingId
        })
      }
    );

    alert(
      'Booking cancelled successfully.'
    );

    await loadAll();

  } catch (e) {

    alert(e.message);

  }
}

/* =========================
   INVOICE
========================= */

function openInvoice(
  bookingId
) {

  const token =
    encodeURIComponent(
      state.token
    );

  const url =
    `/api/admin/bookings/${
      encodeURIComponent(bookingId)
    }/invoice`;

  /*
    Invoice endpoint needs
    Authorization header.
    Open a temporary window
    using fetch and Blob.
  */

  fetch(url, {
    headers: {
      Authorization:
        `Bearer ${state.token}`
    }
  })
  .then(r => {

    if (!r.ok)
      throw new Error(
        'Unable to generate invoice.'
      );

    return r.text();

  })
  .then(html => {

    const blob =
      new Blob(
        [html],
        { type: 'text/html' }
      );

    const blobUrl =
      URL.createObjectURL(blob);

    window.open(
      blobUrl,
      '_blank'
    );

  })
  .catch(e =>
    alert(e.message)
  );
}

/* =========================
   WHATSAPP
========================= */

async function openWhatsApp(
  bookingId
) {

  try {

    const j =
      await api(
        `/api/admin/bookings/${
          encodeURIComponent(
            bookingId
          )
        }/whatsapp`
      );

    window.open(
      j.whatsappUrl,
      '_blank'
    );

  } catch (e) {

    alert(e.message);

  }
}

/* =========================
   PAYMENTS
========================= */

function renderPayments() {

  if (!state.data) return;

  const p =
    state.data.payments || [];

  $('#paymentRows').innerHTML =

    p.map(x => `

      <tr>

        <td>
          ${x.paymentId || '—'}
        </td>

        <td>
          ${x.bookingId}
        </td>

        <td>
          ${x.room}
        </td>

        <td>
          ${fmt(x.amount)}
        </td>

        <td>

          <span class="tag ${
            x.status === 'paid'
              ? 'green'
              : x.status === 'failed'
              ? 'red'
              : 'gold'
          }">

            ${x.status}

          </span>

        </td>

        <td>
          ${new Date(
            x.createdAt
          ).toLocaleString()}
        </td>

      </tr>

    `).join('') ||

    `
    <tr>
      <td colspan="6"
          class="muted">
        No payment records.
      </td>
    </tr>
    `;
}

/* =========================
   MANUAL BOOKING
========================= */

$('#newBookingBtn')
  ?.addEventListener(
    'click',
    () => {

      $('#bookingModal')
        ?.classList
        .remove('hidden');

      populateManualRooms();

    }
  );

document
  .querySelectorAll('[data-close]')
  .forEach(b =>
    b.addEventListener(
      'click',
      () =>
        $('#bookingModal')
          ?.classList
          .add('hidden')
    )
  );

function populateManualRooms() {

  if (!state.data) return;

  const cat =
    $('#bCat').value;

  const g =
    state.data.rooms[cat];

  if (!g) return;

  $('#bRoom').innerHTML =

    g.rooms
      .filter(
        r => r.status === 'available'
      )
      .map(
        r =>
          `<option value="${r.number}">
             ${r.number}
           </option>`
      )
      .join('') ||

    '<option value="">No available rooms</option>';

  $('#bAmount').value =
    g.price;
}

$('#bCat')
  ?.addEventListener(
    'change',
    populateManualRooms
  );

$('#manualBooking')
  ?.addEventListener(
    'submit',
    async e => {

      e.preventDefault();

      try {

        await api(
          '/api/admin/bookings',
          {
            method: 'POST',

            body: JSON.stringify({

              guestName:
                $('#bGuest').value,

              phone:
                $('#bPhone').value,

              category:
                $('#bCat').value,

              room:
                $('#bRoom').value,

              checkin:
                $('#bIn').value,

              checkout:
                $('#bOut').value,

              amount:
                Number(
                  $('#bAmount').value
                ),

              paymentStatus:
                $('#bPay').value

            })
          }
        );

        $('#bookingModal')
          ?.classList
          .add('hidden');

        e.target.reset();

        alert(
          'Booking created successfully.'
        );

        await loadAll();

        switchView('bookings');

      } catch (err) {

        alert(err.message);

      }

    }
  );

/* =========================
   SETTINGS
========================= */

async function loadSettings() {

  try {

    const s =
      await api(
        '/api/admin/settings'
      );

    if ($('#setName'))
      $('#setName').value =
        s.name || '';

    if ($('#setWa'))
      $('#setWa').value =
        s.whatsapp || '';

    if ($('#setAddress'))
      $('#setAddress').value =
        s.address || '';

    if ($('#setCheckin'))
      $('#setCheckin').value =
        s.checkin_time || '';

    if ($('#setCheckout'))
      $('#setCheckout').value =
        s.checkout_time || '';

  } catch (e) {

    console.error(e);

  }
}

$('#saveSettings')
  ?.addEventListener(
    'click',
    async () => {

      try {

        await api(
          '/api/admin/settings',
          {
            method: 'POST',

            body: JSON.stringify({

              name:
                $('#setName').value,

              whatsapp:
                $('#setWa').value,

              address:
                $('#setAddress').value,

              checkinTime:
                $('#setCheckin').value,

              checkoutTime:
                $('#setCheckout').value

            })
          }
        );

        alert(
          'Settings saved successfully.'
        );

      } catch (e) {

        alert(e.message);

      }

    }
  );

/* =========================
   AUTO LOGIN
========================= */

if (state.token) {
  showApp();
}
