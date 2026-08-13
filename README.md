# Shree Balaji Hotel — Online Booking + Razorpay

This package adds:
- Date-based room availability
- Standard / Deluxe / Super Deluxe inventory
- Online Razorpay Checkout
- Server-side Razorpay order creation
- Server-side HMAC payment signature verification
- Payment status check
- Razorpay webhook endpoint
- SQLite booking database
- Booking reference generation
- WhatsApp confirmation shortcut
- Existing hotel photos and branding

## Important before going live

1. Create/activate a Razorpay merchant account and complete the required KYC/business setup.
2. Copy `.env.example` to `.env`.
3. Add the Razorpay **Key ID**, **Key Secret**, and **Webhook Secret**.
4. NEVER put the Key Secret in frontend JavaScript.
5. Room allocation is configured directly in `server.js` using the hotel's physical room numbers:
   - Super Deluxe: 101, 102, 103, 104, 105
   - Deluxe: 201, 202, 203, 204
   - Standard: 205, 206, 207, 208, 301, 302, 303, 304, 305, 306, 307
6. Run:
   `npm install`
   `npm start`
7. Test using Razorpay Test Mode first.
8. For production, deploy behind HTTPS and set `BASE_URL` to the real HTTPS domain.
9. In Razorpay Dashboard, configure a webhook URL:
   `https://YOUR-DOMAIN.com/api/razorpay/webhook`
   Subscribe to payment events needed for your workflow, especially `payment.captured` and `payment.failed`.
10. Enable automatic payment capture in Razorpay if that is how the hotel wants successful bookings handled.

## Booking flow

Guest selects dates → availability is checked → server creates a Razorpay Order → Razorpay Checkout opens → payment is verified server-side → booking is stored as confirmed when payment is captured.

The browser never receives or stores the Razorpay Key Secret.

## Current hotel details

Shree Balaji Hotel
4, Balaji Tower, Near ICICI Bank
WhatsApp: 7987510587

Room rates:
Standard ₹1,000/night
Deluxe ₹1,200/night
Super Deluxe ₹1,500/night

## Important business detail

The booking system allocates a specific physical room number when a payment order is created. The room is held while payment is pending and remains reserved after confirmation for the selected stay dates. Overlapping bookings cannot receive the same room number.

Razorpay's current documentation requires server-side order creation, server-side signature verification, and recommends webhooks for reliable payment confirmation.


## Identity verification added

- Maximum 2 guests per room.
- Guest 1: one ID upload required.
- Guest 2: one ID upload required when 2 guests are selected.
- Accepted: Aadhaar Card, Driving Licence, Passport, Voter ID.
- Accepted upload formats: JPG, PNG, PDF, max 8 MB each.
- Identity files are stored outside `public/` so they are not directly web-accessible.
- The package includes a protected admin document route; use a strong `ADMIN_TOKEN` and, in production, replace this with a proper authenticated admin panel.
- Because identity documents are highly sensitive personal data, production use should follow applicable Indian privacy/data-protection, hotel record-retention, access-control, and consent requirements. Avoid collecting more ID information than actually needed.


## Design update
The public page was redesigned to closely follow the supplied reference: black/gold branding, logo header, gold navigation bar, full-width hotel hero, right-side booking widget, room cards, amenities strip, gallery, about section and online booking section.
