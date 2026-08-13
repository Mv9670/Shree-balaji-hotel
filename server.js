const express=require('express');
const path=require('path');
const crypto=require('crypto');
const Razorpay=require('razorpay');
const app=express();
const PORT=process.env.PORT||10000;
const roomData={standard:{price:1000,rooms:['205','206','207','208','301','302','303','304','305','306','307']},deluxe:{price:1200,rooms:['201','202','203','204']},super:{price:1500,rooms:['101','102','103','104','105']}};
const paidRooms=new Set();
app.use(express.json());app.use(express.static(__dirname));
function gateway(){if(!process.env.RAZORPAY_KEY_ID||!process.env.RAZORPAY_KEY_SECRET)return null;return new Razorpay({key_id:process.env.RAZORPAY_KEY_ID,key_secret:process.env.RAZORPAY_KEY_SECRET});}
app.get('/api/config',(req,res)=>res.json({paymentConfigured:!!gateway()}));
app.get('/api/rooms',(req,res)=>{const out={};for(const [k,v] of Object.entries(roomData))out[k]=v.rooms.filter(r=>!paidRooms.has(r));res.json(out);});
app.post('/api/create-order',async(req,res)=>{try{const rzp=gateway();if(!rzp)return res.status(503).json({error:'Razorpay is not configured yet. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in Render Environment Variables.'});const {amount,room,category,checkin,checkout,nights,guestName,phone}=req.body;if(!roomData[category]||!roomData[category].rooms.includes(room)||paidRooms.has(room))return res.status(409).json({error:'Selected room is no longer available. Please choose another room.'});if(!guestName||!phone||!checkin||!checkout||!nights||Number(nights)<1)return res.status(400).json({error:'Invalid booking details.'});const expected=roomData[category].price*Number(nights);if(Number(amount)!==expected)return res.status(400).json({error:'Booking amount mismatch.'});const order=await rzp.orders.create({amount:expected*100,currency:'INR',receipt:`SBH-${Date.now()}-${room}`,notes:{guestName,phone,room,category,checkin,checkout}});res.json({key:process.env.RAZORPAY_KEY_ID,orderId:order.id,amount:order.amount,currency:order.currency});}catch(e){console.error(e);res.status(500).json({error:'Unable to create payment order.'});}});
app.post('/api/verify-payment',(req,res)=>{try{if(!process.env.RAZORPAY_KEY_SECRET)return res.status(503).json({error:'Payment gateway is not configured.'});const {razorpay_order_id,razorpay_payment_id,razorpay_signature,booking}=req.body;if(!razorpay_order_id||!razorpay_payment_id||!razorpay_signature)return res.status(400).json({error:'Incomplete payment response.'});const expected=crypto.createHmac('sha256',process.env.RAZORPAY_KEY_SECRET).update(`${razorpay_order_id}|${razorpay_payment_id}`).digest('hex');if(expected!==razorpay_signature)return res.status(400).json({error:'Payment signature verification failed.'});if(!roomData[booking.category]||!roomData[booking.category].rooms.includes(booking.room))return res.status(400).json({error:'Invalid room.'});paidRooms.add(booking.room);const bookingId=`SBH-${Date.now()}-${booking.room}`;res.json({success:true,bookingId});}catch(e){console.error(e);res.status(500).json({error:'Payment verification failed.'});}});
app.use((req,res)=>res.sendFile(path.join(__dirname,'index.html')));
app.listen(PORT,()=>console.log(`Shree Balaji Hotel running on port ${PORT}`));
