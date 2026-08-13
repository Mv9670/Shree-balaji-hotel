const RAW='./';
const imgFallback='placeholder.svg';
const roomData={
  standard:{name:'Standard Room',price:1000,rooms:['205','206','207','208','301','302','303','304','305','306','307'],images:['standard-1.jpg','standard-2.jpg','standard-3.jpg']},
  deluxe:{name:'Deluxe Room',price:1200,rooms:['201','202','203','204'],images:['deluxe-1.jpg','deluxe-2.jpg','deluxe-3.jpg']},
  super:{name:'Super Deluxe Room',price:1500,rooms:['101','102','103','104','105'],images:['super-1.jpg','super-2.jpg','super-3.jpg']}
};
const hotelGallery=[
  ['lobby-main.jpeg','Lobby'],['lobby-art.jpeg','Lobby'],['reception.jpeg','Reception'],['room-dressing.jpeg','Room Dressing'],['upper-corridor.jpeg','Upper Corridor'],['upper-corridor-2.jpeg','Upper Corridor'],['corridor-1.jpeg','Corridor'],['bathroom-1.jpeg','Bathroom'],['bathroom-2.jpeg','Bathroom']
];
let sold=JSON.parse(localStorage.getItem('sbhSoldRooms')||'[]');
let selectedKey='standard';

function renderAvailability(){
  let totalAvailable=0;
  ['super','deluxe','standard'].forEach(k=>{
    const el=document.getElementById(k+'Rooms'),count=document.getElementById(k+'Count');
    const available=roomData[k].rooms.filter(r=>!sold.includes(r));
    const total=roomData[k].rooms.length;
    totalAvailable += available.length;
    const badge=document.getElementById('badge-'+k);
    if(badge){
      badge.textContent=available.length ? `${available.length} ROOM${available.length===1?'':'S'} AVAILABLE` : 'SOLD OUT';
      badge.classList.toggle('soldout',available.length===0);
    }
    const cardBtn=document.querySelector(`[data-book-category="${k}"]`);
    if(cardBtn){
      cardBtn.disabled=available.length===0;
      cardBtn.classList.toggle('soldout-btn',available.length===0);
      cardBtn.textContent=available.length===0?'SOLD OUT':'BOOK NOW';
    }
    count.innerHTML=available.length ? `<span style="color:#18a64a;font-weight:800">${available.length} of ${total} rooms available</span>` : '<span style="color:#d32f2f;font-weight:800">SOLD OUT</span>';
    el.innerHTML=roomData[k].rooms.map(r=>`<span class="room-number ${sold.includes(r)?'sold':''}">${r}${sold.includes(r)?' • Sold':' • Available'}</span>`).join('');
  });
  const totalBadge=document.getElementById('liveTotalAvailability');
  if(totalBadge){totalBadge.textContent=totalAvailable ? `${totalAvailable} ROOMS AVAILABLE` : 'ALL ROOMS SOLD OUT'; totalBadge.classList.toggle('soldout',totalAvailable===0);}
}

function setupCarousels(){
  document.querySelectorAll('.carousel').forEach(c=>{
    const key=c.dataset.category,imgs=roomData[key].images; c.dataset.index='0';
    const dots=c.querySelector('.dots');
    dots.innerHTML=imgs.map((_,i)=>`<button class="dot ${i===0?'active':''}" data-dot="${i}" aria-label="Photo ${i+1}"></button>`).join('');
    dots.querySelectorAll('.dot').forEach(d=>d.addEventListener('click',()=>showRoomSlide(c,Number(d.dataset.dot))));
    c.querySelector('.prev').addEventListener('click',()=>showRoomSlide(c,(Number(c.dataset.index)-1+imgs.length)%imgs.length));
    c.querySelector('.next').addEventListener('click',()=>showRoomSlide(c,(Number(c.dataset.index)+1)%imgs.length));
    setInterval(()=>showRoomSlide(c,(Number(c.dataset.index)+1)%imgs.length),6500);
    c.addEventListener('touchstart',e=>c.dataset.touchX=e.changedTouches[0].screenX,{passive:true});
    c.addEventListener('touchend',e=>{const dx=e.changedTouches[0].screenX-Number(c.dataset.touchX||0);if(Math.abs(dx)>40)showRoomSlide(c,(Number(c.dataset.index)+(dx<0?1:-1)+imgs.length)%imgs.length);},{passive:true});
  });
}
function showRoomSlide(c,i){const key=c.dataset.category,imgs=roomData[key].images;c.dataset.index=String(i);const img=c.querySelector('img');img.onerror=()=>{img.onerror=null;img.src=imgFallback};img.src=RAW+imgs[i];c.querySelectorAll('.dot').forEach((d,n)=>d.classList.toggle('active',n===i));}

let hotelIndex=0;
function setupHotelGallery(){
  const wrap=document.querySelector('[data-gallery="hotel"]');
  const img=wrap.querySelector('.gallery-image');
  const dots=document.getElementById('hotelGalleryDots');
  dots.innerHTML=hotelGallery.map((_,i)=>`<button class="gallery-dot ${i===0?'active':''}" data-i="${i}" aria-label="Hotel photo ${i+1}"></button>`).join('');
  dots.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>showHotelSlide(Number(b.dataset.i))));
  wrap.querySelectorAll('[data-gallery-dir]').forEach(b=>b.addEventListener('click',()=>showHotelSlide((hotelIndex+Number(b.dataset.galleryDir)+hotelGallery.length)%hotelGallery.length)));
  wrap.addEventListener('touchstart',e=>wrap.dataset.touchX=e.changedTouches[0].screenX,{passive:true});
  wrap.addEventListener('touchend',e=>{const dx=e.changedTouches[0].screenX-Number(wrap.dataset.touchX||0);if(Math.abs(dx)>40)showHotelSlide((hotelIndex+(dx<0?1:-1)+hotelGallery.length)%hotelGallery.length);},{passive:true});
  setInterval(()=>showHotelSlide((hotelIndex+1)%hotelGallery.length),6000);
}
function showHotelSlide(i){hotelIndex=i;const [file,title]=hotelGallery[i];const wrap=document.querySelector('[data-gallery="hotel"]');const img=wrap.querySelector('.gallery-image');img.onerror=()=>{img.onerror=null;img.src=imgFallback};img.src=RAW+file;img.alt=title;document.getElementById('hotelGalleryTitle').textContent=title;document.getElementById('hotelGalleryCount').textContent=`${i+1} / ${hotelGallery.length}`;document.querySelectorAll('.gallery-dot').forEach((d,n)=>d.classList.toggle('active',n===i));}

let heroIndex=0;
function setupHeroCarousel(){
  const root=document.getElementById('heroCarousel'); if(!root)return;
  const slides=[...root.querySelectorAll('.hero-slide')]; const dots=document.getElementById('heroDots');
  slides.forEach(slide=>{const img=slide.querySelector('img'); img.onerror=()=>{img.onerror=null;img.src=imgFallback};});
  dots.innerHTML=slides.map((_,i)=>`<button class="hero-dot ${i===0?'active':''}" data-hero="${i}" aria-label="Hotel slide ${i+1}"></button>`).join('');
  dots.querySelectorAll('.hero-dot').forEach(d=>d.addEventListener('click',()=>showHeroSlide(Number(d.dataset.hero))));
  setInterval(()=>showHeroSlide((heroIndex+1)%slides.length),5000);
}
function showHeroSlide(i){
  const slides=document.querySelectorAll('.hero-slide');
  heroIndex=i;
  slides.forEach((s,n)=>s.classList.toggle('active',n===i));
  document.querySelectorAll('.hero-dot').forEach((d,n)=>d.classList.toggle('active',n===i));
}

function localDate(d){return new Date(d+'T00:00:00');}
function nightsBetween(a,b){if(!a||!b)return 1;return Math.max(1,Math.round((localDate(b)-localDate(a))/86400000));}
function setDateLimits(){
  const now=new Date();const today=new Date(now.getFullYear(),now.getMonth(),now.getDate());const iso=d=>d.toISOString().slice(0,10);const tomorrow=new Date(today);tomorrow.setDate(tomorrow.getDate()+1);
  document.getElementById('checkin').min=iso(today);document.getElementById('checkout').min=iso(tomorrow);
}
function populateRooms(){const select=document.getElementById('roomNumber');const available=roomData[selectedKey].rooms.filter(r=>!sold.includes(r));select.innerHTML=available.length?available.map(r=>`<option value="${r}">Room ${r}</option>`).join(''):'<option value="">No rooms available</option>';}
function updateTotals(){const nights=nightsBetween(document.getElementById('checkin').value,document.getElementById('checkout').value);const price=roomData[selectedKey].price;document.getElementById('nights').textContent=nights;document.getElementById('modalRate').textContent=`₹${price.toLocaleString('en-IN')}`;document.getElementById('modalTotal').textContent=`₹${(price*nights).toLocaleString('en-IN')}`;}
function openBooking(key){selectedKey=key;document.getElementById('modalTitle').textContent=`Book ${roomData[key].name}`;populateRooms();setDateLimits();const ci=document.getElementById('checkin'),co=document.getElementById('checkout');if(!ci.value){const d=new Date();ci.value=d.toISOString().slice(0,10);}const next=new Date(localDate(ci.value));next.setDate(next.getDate()+1);co.min=next.toISOString().slice(0,10);if(!co.value||co.value<=ci.value)co.value=co.min;updateTotals();document.getElementById('bookingModal').classList.add('show');document.getElementById('bookingModal').setAttribute('aria-hidden','false');}
function closeBooking(){document.getElementById('bookingModal').classList.remove('show');document.getElementById('bookingModal').setAttribute('aria-hidden','true');}

async function createPayment(){
  const guestName=document.getElementById('guestName').value.trim(),phone=document.getElementById('guestPhone').value.trim(),checkin=document.getElementById('checkin').value,checkout=document.getElementById('checkout').value,room=document.getElementById('roomNumber').value;
  if(!guestName||!phone||!checkin||!checkout||!room||checkout<=checkin){alert('Please complete the booking details and select a valid check-out date.');return;}
  const nights=nightsBetween(checkin,checkout),amount=roomData[selectedKey].price*nights;
  const btn=document.querySelector('.pay-btn');btn.disabled=true;btn.textContent='CREATING SECURE PAYMENT…';
  try{
    const orderRes=await fetch('/api/create-order',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({amount,room,category:selectedKey,guestName,phone,checkin,checkout,nights})});
    const order=await orderRes.json();if(!orderRes.ok)throw new Error(order.error||'Payment gateway is not configured.');
    const options={key:order.key,amount:order.amount,currency:'INR',name:'Shree Balaji Hotel',description:`${roomData[selectedKey].name} • Room ${room} • ${nights} night(s)`,order_id:order.orderId,prefill:{name:guestName,contact:phone},theme:{color:'#c9a85a'},handler:async response=>{try{const verify=await fetch('/api/verify-payment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...response,booking:{guestName,phone,room,category:selectedKey,checkin,checkout,nights,amount}})});const result=await verify.json();if(!verify.ok||!result.success)throw new Error(result.error||'Payment verification failed.');sold=[...new Set([...sold,room])];localStorage.setItem('sbhSoldRooms',JSON.stringify(sold));renderAvailability();closeBooking();document.getElementById('successText').textContent=`Payment received. Room ${room} is reserved from ${checkin} to ${checkout}. Booking ID: ${result.bookingId||'Confirmed'}.`;document.getElementById('successModal').classList.add('show');document.getElementById('successModal').setAttribute('aria-hidden','false');}catch(err){alert(err.message);}},modal:{ondismiss:()=>{btn.disabled=false;btn.textContent='PAY SECURELY & CONFIRM';}}};
    const rzp=new Razorpay(options);rzp.on('payment.failed',r=>alert(r.error?.description||'Payment failed. Please try again.'));rzp.open();
  }catch(err){alert(err.message);btn.disabled=false;btn.textContent='PAY SECURELY & CONFIRM';}
}

document.querySelectorAll('[data-book-category]').forEach(b=>b.addEventListener('click',()=>openBooking(b.dataset.bookCategory)));
document.getElementById('closeBooking').addEventListener('click',closeBooking);document.getElementById('successClose').addEventListener('click',()=>document.getElementById('successModal').classList.remove('show'));
document.getElementById('bookingModal').addEventListener('click',e=>{if(e.target.id==='bookingModal')closeBooking();});
document.getElementById('checkin').addEventListener('change',()=>{const ci=document.getElementById('checkin'),co=document.getElementById('checkout');const next=new Date(localDate(ci.value));next.setDate(next.getDate()+1);co.min=next.toISOString().slice(0,10);if(!co.value||co.value<=ci.value)co.value=co.min;updateTotals();});document.getElementById('checkout').addEventListener('change',updateTotals);document.getElementById('bookingForm').addEventListener('submit',e=>{e.preventDefault();createPayment();});
setupCarousels();setupHotelGallery();setupHeroCarousel();renderAvailability();

function setupHeroBooking(){const ci=document.getElementById('heroCheckin'),co=document.getElementById('heroCheckout'),cat=document.getElementById('heroCategory'),btn=document.getElementById('heroAvailability');if(!ci||!co||!btn)return;const d=new Date();const iso=x=>x.toISOString().slice(0,10);const today=new Date(d.getFullYear(),d.getMonth(),d.getDate());const tomorrow=new Date(today);tomorrow.setDate(tomorrow.getDate()+1);ci.min=iso(today);co.min=iso(tomorrow);ci.value=iso(today);co.value=iso(tomorrow);ci.addEventListener('change',()=>{const n=new Date(ci.value+'T00:00:00');n.setDate(n.getDate()+1);co.min=iso(n);if(!co.value||co.value<=ci.value)co.value=iso(n)});btn.addEventListener('click',()=>{openBooking(cat.value);document.getElementById('checkin').value=ci.value;document.getElementById('checkout').value=co.value;updateTotals();});}
setupHeroBooking();
