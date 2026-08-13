const roomData={
  standard:{name:"Standard Room",rooms:["205","206","207","208","301","302","303","304","305","306","307"],images:["rooms/standard-1.jpg","rooms/standard-2.jpg","rooms/standard-3.jpg"]},
  deluxe:{name:"Deluxe Room",rooms:["201","202","203","204"],images:["rooms/deluxe-1.jpg","rooms/deluxe-2.jpg","rooms/deluxe-3.jpg"]},
  super:{name:"Super Deluxe Room",rooms:["101","102","103","104","105"],images:["rooms/super-1.jpg","rooms/super-2.jpg","rooms/super-3.jpg"]}
};

const sold=JSON.parse(localStorage.getItem("sbhSoldRooms")||"[]");

function renderAvailability(){
  ["super","deluxe","standard"].forEach(k=>{
    const el=document.getElementById(k+"Rooms"), count=document.getElementById(k+"Count");
    const available=roomData[k].rooms.filter(r=>!sold.includes(r));
    count.textContent=`${available.length} of ${roomData[k].rooms.length} rooms available`;
    el.innerHTML=roomData[k].rooms.map(r=>`<span class="room-number ${sold.includes(r)?"sold":""}">${r}${sold.includes(r)?" • Sold":" "}</span>`).join("");
  });
}

document.querySelectorAll(".carousel").forEach(c=>{
  const key=c.dataset.category, imgs=roomData[key].images;
  c.dataset.index="0"; c.dataset.images=JSON.stringify(imgs);
  const dots=c.querySelector(".dots");
  dots.innerHTML=imgs.map((_,i)=>`<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${i===0?"#fff":"#999"};margin:3px"></span>`).join("");
  dots.style.cssText="position:absolute;bottom:10px;left:50%;transform:translateX(-50%);";
});

function moveSlide(btn,dir){
  const c=btn.closest(".carousel"), key=c.dataset.category, imgs=roomData[key].images;
  let i=Number(c.dataset.index)+dir;if(i<0)i=imgs.length-1;if(i>=imgs.length)i=0;
  c.dataset.index=i;c.querySelector("img").src=imgs[i];
  c.querySelector("img").onerror=()=>c.querySelector("img").src="placeholder.svg";
}

let selectedCategory="",selectedPrice=0;
function openBooking(category,price){
  selectedCategory=category;selectedPrice=price;
  document.getElementById("modalTitle").textContent=`Book ${category}`;
  document.getElementById("modalPrice").textContent=`₹${price.toLocaleString("en-IN")}`;
  const key=category.startsWith("Super")?"super":category.startsWith("Deluxe")?"deluxe":"standard";
  const select=document.getElementById("roomNumber");
  const available=roomData[key].rooms.filter(r=>!sold.includes(r));
  select.innerHTML=available.length?available.map(r=>`<option value="${r}">Room ${r}</option>`).join(""):`<option>No rooms available</option>`;
  document.getElementById("bookingModal").classList.add("show");
}
function closeBooking(){document.getElementById("bookingModal").classList.remove("show")}

document.getElementById("bookingForm").addEventListener("submit",e=>{
  e.preventDefault();
  const room=document.getElementById("roomNumber").value;
  if(!room || room.includes("No rooms")) return;
  sold.push(room);localStorage.setItem("sbhSoldRooms",JSON.stringify([...new Set(sold)]));
  const msg=`Hello Shree Balaji Hotel,%0A%0AI want to book a room.%0A%0AGuest: ${encodeURIComponent(document.getElementById("guestName").value)}%0AWhatsApp: ${encodeURIComponent(document.getElementById("guestPhone").value)}%0ARoom Category: ${encodeURIComponent(selectedCategory)}%0ARoom No.: ${room}%0ACheck-in: ${document.getElementById("checkin").value}%0ACheck-out: ${document.getElementById("checkout").value}%0ARate: ₹${selectedPrice}/night`;
  window.open(`https://wa.me/917987510587?text=${msg}`,"_blank");
  closeBooking();renderAvailability();
});

renderAvailability();