const state={
  token:localStorage.getItem('sbhAdminToken')||'',
  data:null
};

const $=s=>document.querySelector(s);

const fmt=n=>
`₹${Number(n||0).toLocaleString('en-IN')}`;

async function api(url,opts={}){
  opts.headers={
    ...(opts.headers||{}),
    'Content-Type':'application/json'
  };

  if(state.token){
    opts.headers.Authorization=`Bearer ${state.token}`;
  }

  const r=await fetch(url,opts);

  let j={};
  try{j=await r.json()}catch{}

  if(r.status===401){
    logout(false);
    throw new Error('Session expired. Please login again.');
  }

  if(!r.ok){
    throw new Error(j.error||'Request failed');
  }

  return j;
}

function showApp(){
  $('#loginView').classList.add('hidden');
  $('#appView').classList.remove('hidden');
  loadAll();
}

function logout(call=true){
  localStorage.removeItem('sbhAdminToken');
  state.token='';

  $('#appView').classList.add('hidden');
  $('#loginView').classList.remove('hidden');

  if(call)location.reload();
}

/* LOGIN */

$('#loginForm')?.addEventListener('submit',async e=>{
  e.preventDefault();

  $('#loginError').textContent='';

  try{
    const j=await api('/api/admin/login',{
      method:'POST',
      body:JSON.stringify({
        username:$('#adminUser').value,
        password:$('#adminPass').value
      })
    });

    state.token=j.token;

    localStorage.setItem(
      'sbhAdminToken',
      state.token
    );

    showApp();

  }catch(err){
    $('#loginError').textContent=err.message;
  }
});

$('#logoutBtn')?.addEventListener(
  'click',
  ()=>logout()
);

/* NAVIGATION */

function switchView(v){

  document.querySelectorAll('.view')
    .forEach(x=>x.classList.add('hidden'));

  $(`#${v}View`)?.classList.remove('hidden');

  document.querySelectorAll('.nav-item')
    .forEach(b=>
      b.classList.toggle(
        'active',
        b.dataset.view===v
      )
    );

  if($('#pageTitle')){
    $('#pageTitle').textContent={
      dashboard:'Dashboard',
      rooms:'Room Inventory',
      bookings:'Bookings',
      payments:'Payments',
      settings:'Settings'
    }[v]||'Dashboard';
  }

  if(v==='bookings')renderBookings();
  if(v==='payments')renderPayments();
  if(v==='settings')loadSettings();
}

document.querySelectorAll('.nav-item')
.forEach(b=>
  b.addEventListener(
    'click',
    ()=>switchView(b.dataset.view)
  )
);

document.querySelectorAll('[data-jump]')
.forEach(b=>
  b.addEventListener(
    'click',
    ()=>switchView(b.dataset.jump)
  )
);

/* LOAD */

async function loadAll(){

  try{

    state.data=
      await api('/api/admin/dashboard');

    renderDashboard();
    renderRooms();
    renderBookings();
    renderPayments();

    if($('#lastUpdated')){
      $('#lastUpdated').textContent=
        'Updated '+
        new Date().toLocaleTimeString(
          [],
          {
            hour:'2-digit',
            minute:'2-digit'
          }
        );
    }

  }catch(e){

    if(state.token){
      alert(e.message);
    }
  }
}

/* DASHBOARD */

function renderDashboard(){

  const d=state.data;

  $('#mTotal').textContent=d.totalRooms;
  $('#mAvailable').textContent=d.availableRooms;
  $('#mBooked').textContent=d.bookedRooms;
  $('#mBookings').textContent=d.bookings.length;

  $('#pRevenue').textContent=
    fmt(d.revenue);

  $('#pPaid').textContent=
    d.payments.filter(
      x=>x.status==='paid'
    ).length;

  $('#pPending').textContent=
    d.payments.filter(
      x=>x.status!=='paid'
    ).length;

  $('#dashRooms').innerHTML=
    groupsHtml(d.rooms);

  $('#recentBookings').innerHTML=
    d.bookings
      .slice(-6)
      .reverse()
      .map(bookingHtml)
      .join('')
      ||
      '<p class="muted">No bookings yet.</p>';
}

/* ROOMS */

function groupsHtml(groups){

  return Object.entries(groups)
    .map(([cat,g])=>`

<div class="room-group">

<div class="room-group-head">

<h4>
${g.name} · ${fmt(g.price)}/night
</h4>

<span class="tag ${g.available?'green':'red'}">
${g.available} available / ${g.total}
</span>

</div>

<div class="room-badges">

${g.rooms.map(r=>`

<span
class="room-badge ${r.status}"
title="${r.status}"
onclick="quickStatus('${cat}','${r.number}')"
>
${r.number} · ${r.status}
</span>

`).join('')}

</div>
</div>

`).join('');
}

function renderRooms(){

  $('#roomInventory').innerHTML=
    Object.entries(state.data.rooms)
    .map(([cat,g])=>`

<div class="room-group">

<div class="room-group-head">

<h4>${g.name}</h4>

<span class="tag ${g.available?'green':'red'}">
${g.available} AVAILABLE
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

${g.rooms.map(r=>`

<tr>

<td>
<b>Room ${r.number}</b>
</td>

<td>
<span class="tag ${
r.status==='available'
?'green'
:r.status==='booked'
?'red'
:'gold'
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
onchange="changeStatus(
'${cat}',
'${r.number}',
this.value
)"
>

<option value="available"
${r.status==='available'?'selected':''}>
available
</option>

<option value="booked"
${r.status==='booked'?'selected':''}>
booked
</option>

<option value="maintenance"
${r.status==='maintenance'?'selected':''}>
maintenance
</option>

</select>

</td>

</tr>

`).join('')}

</tbody>
</table>
</div>

`).join('');
}

/* ROOM STATUS */

async function changeStatus(
  cat,
  room,
  status
){

  try{

    await api(
      '/api/admin/rooms/status',
      {
        method:'POST',
        body:JSON.stringify({
          category:cat,
          room,
          status
        })
      }
    );

    await loadAll();

  }catch(e){
    alert(e.message);
  }
}

async function quickStatus(cat,room){

  const s=prompt(
    `Set Room ${room} status:\navailable / booked / maintenance`,
    'available'
  );

  if(
    !s ||
    ![
      'available',
      'booked',
      'maintenance'
    ].includes(s)
  )return;

  await changeStatus(
    cat,
    room,
    s
  );
}

/* BOOKING CARD */

function bookingHtml(b){

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
b.paymentStatus==='paid'
?'green'
:b.paymentStatus==='refunded'
?'red'
:'gold'
}">
${b.paymentStatus}
</span>

·

<span class="tag ${
b.status==='confirmed'
?'green'
:b.status==='cancelled'
?'red'
:'gold'
}">
${b.status}
</span>

</small>

</div>

`;
}

/* BOOKINGS */

function renderBookings(){

  if(!state.data)return;

  const q=
    ($('#bookingSearch')?.value||'')
    .toLowerCase();

  const st=
    $('#bookingStatus')?.value||'all';

  const rows=
    state.data.bookings.filter(b=>
      (st==='all'||b.status===st) &&
      (
        !q ||
        JSON.stringify(b)
          .toLowerCase()
          .includes(q)
      )
    );

  $('#bookingRows').innerHTML=

    rows
    .slice()
    .reverse()
    .map(b=>`

<tr>

<td>
<b>${b.bookingId}</b>
<br>
<small>
${new Date(b.createdAt)
.toLocaleString('en-IN')}
</small>
</td>

<td>
${b.guestName}
<br>
<small>${b.phone}</small>
</td>

<td>
${b.room}
<br>
<small>${b.category}</small>
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

<select
onchange="
updatePayment(
'${b.bookingId}',
this.value
)
">

<option value="pending"
${b.paymentStatus==='pending'?'selected':''}>
Pending
</option>

<option value="paid"
${b.paymentStatus==='paid'?'selected':''}>
Paid
</option>

<option value="refunded"
${b.paymentStatus==='refunded'?'selected':''}>
Refunded
</option>

</select>

${b.paymentId
?`<br><small>${b.paymentId}</small>`
:''}

</td>

<td>

<select
onchange="
updateBookingStatus(
'${b.bookingId}',
this.value
)
">

<option value="confirmed"
${b.status==='confirmed'?'selected':''}>
Confirmed
</option>

<option value="cancelled"
${b.status==='cancelled'?'selected':''}>
Cancelled
</option>

</select>

</td>

<td>

<button
onclick="
bookingDetails('${b.bookingId}')
">
Details
</button>

<button
onclick="
printInvoice('${b.bookingId}')
">
Invoice
</button>

<button
onclick="
sendWhatsApp('${b.bookingId}')
">
WhatsApp
</button>

</td>

</tr>

`).join('')

||

'<tr><td colspan="8" class="muted">No matching bookings.</td></tr>';
}

/* SEARCH */

$('#bookingSearch')?.addEventListener(
  'input',
  renderBookings
);

$('#bookingStatus')?.addEventListener(
  'change',
  renderBookings
);

/* DETAILS */

async function bookingDetails(id){

  try{

    const j=
      await api(
        `/api/admin/bookings/${encodeURIComponent(id)}`
      );

    const b=j.booking;

    alert(

`BOOKING DETAILS

Booking ID: ${b.bookingId}

Guest: ${b.guestName}

Phone: ${b.phone}

Room: ${b.room}

Room Type: ${b.category}

Check-in: ${b.checkin}

Check-out: ${b.checkout}

Amount: ${fmt(b.amount)}

Payment: ${b.paymentStatus}

Booking Status: ${b.status}

Payment ID: ${b.paymentId||'—'}

Created:
${new Date(b.createdAt).toLocaleString('en-IN')}`

    );

  }catch(e){
    alert(e.message);
  }
}

/* CANCEL / STATUS */

async function updateBookingStatus(
  id,
  status
){

  if(
    status==='cancelled' &&
    !confirm(
      'Cancel this booking and release the room?'
    )
  ){
    renderBookings();
    return;
  }

  try{

    await api(
      `/api/admin/bookings/${encodeURIComponent(id)}/status`,
      {
        method:'POST',
        body:JSON.stringify({status})
      }
    );

    await loadAll();
    switchView('bookings');

  }catch(e){

    alert(e.message);
    await loadAll();
  }
}

/* PAYMENT */

async function updatePayment(
  id,
  paymentStatus
){

  try{

    await api(
      `/api/admin/bookings/${encodeURIComponent(id)}/payment`,
      {
        method:'POST',
        body:JSON.stringify({
          paymentStatus
        })
      }
    );

    await loadAll();
    switchView('bookings');

  }catch(e){

    alert(e.message);
    await loadAll();
  }
}

/* INVOICE */

async function printInvoice(id){

  try{

    const j=
      await api(
        `/api/admin/bookings/${encodeURIComponent(id)}/invoice`
      );

    const w=window.open(
      '',
      '_blank'
    );

    if(!w){
      alert(
        'Please allow pop-ups for invoice printing.'
      );
      return;
    }

    w.document.open();
    w.document.write(j.html);
    w.document.close();

  }catch(e){
    alert(e.message);
  }
}

/* WHATSAPP */

async function sendWhatsApp(id){

  try{

    const j=
      await api(
        `/api/admin/bookings/${encodeURIComponent(id)}`
      );

    const b=j.booking;

    let phone=
      String(b.phone||'')
      .replace(/\D/g,'');

    if(phone.length===10){
      phone='91'+phone;
    }

    const message=
`Namaste ${b.guestName},

Your booking at Shree Balaji Hotel is ${b.status}.

Booking ID: ${b.bookingId}
Room: ${b.room} (${b.category})
Check-in: ${b.checkin}
Check-out: ${b.checkout}
Amount: ${fmt(b.amount)}
Payment: ${b.paymentStatus}

Thank you for choosing Shree Balaji Hotel.`;

    const url=
      `https://wa.me/${phone}?text=${
        encodeURIComponent(message)
      }`;

    window.open(
      url,
      '_blank'
    );

  }catch(e){
    alert(e.message);
  }
}

/* PAYMENTS */

function renderPayments(){

  const p=
    state.data.payments||[];

  $('#paymentRows').innerHTML=

    p
    .slice()
    .reverse()
    .map(x=>`

<tr>

<td>
${x.paymentId||'—'}
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
x.status==='paid'
?'green'
:x.status==='refunded'
?'red'
:'gold'
}">
${x.status}
</span>

</td>

<td>
${new Date(x.createdAt)
.toLocaleString('en-IN')}
</td>

</tr>

`).join('')

||

'<tr><td colspan="6" class="muted">No payment records.</td></tr>';
}

/* MANUAL BOOKING */

$('#newBookingBtn')?.addEventListener(
  'click',
  ()=>{
    $('#bookingModal')
      .classList
      .remove('hidden');

    populateManualRooms();
  }
);

document
.querySelectorAll('[data-close]')
.forEach(b=>
  b.addEventListener(
    'click',
    ()=>$('#bookingModal')
      .classList
      .add('hidden')
  )
);

function populateManualRooms(){

  const cat=$('#bCat').value;

  const g=state.data.rooms[cat];

  $('#bRoom').innerHTML=

    g.rooms
    .filter(r=>
      r.status==='available'
    )
    .map(r=>
      `<option value="${r.number}">
        ${r.number}
      </option>`
    )
    .join('')

    ||

    '<option value="">No available rooms</option>';

  $('#bAmount').value=
    g.price;
}

$('#bCat')?.addEventListener(
  'change',
  populateManualRooms
);

$('#manualBooking')?.addEventListener(
  'submit',
  async e=>{

    e.preventDefault();

    try{

      await api(
        '/api/admin/bookings',
        {
          method:'POST',
          body:JSON.stringify({

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
              Number($('#bAmount').value),

            paymentStatus:
              $('#bPay').value

          })
        }
      );

      $('#bookingModal')
        .classList
        .add('hidden');

      e.target.reset();

      await loadAll();

      switchView('bookings');

    }catch(err){

      alert(err.message);
    }
  }
);

/* SETTINGS */

async function loadSettings(){

  try{

    const s=
      await api('/api/admin/settings');

    if($('#setName'))
      $('#setName').value=s.name||'';

    if($('#setWa'))
      $('#setWa').value=s.whatsapp||'';

    if($('#setAddress'))
      $('#setAddress').value=s.address||'';

    if($('#setCheckin'))
      $('#setCheckin').value=s.checkinTime||'12:00';

    if($('#setCheckout'))
      $('#setCheckout').value=s.checkoutTime||'11:00';

  }catch(e){
    console.error(e);
  }
}

$('#saveSettings')?.addEventListener(
  'click',
  async()=>{

    try{

      await api(
        '/api/admin/settings',
        {
          method:'POST',
          body:JSON.stringify({

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

      alert('Settings saved successfully.');

    }catch(e){
      alert(e.message);
    }
  }
);

/* AUTO LOGIN */

if(state.token){
  showApp();
}
