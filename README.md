# Wearhouse Online Store (Firebase & Razorpay Standard Checkout)

Production online store for **Wearhouse** (Indian basics & themed drops). Built on **Firebase Hosting**, **Cloud Functions (2nd Gen, Node 20)**, **Firestore Database**, and **Razorpay Standard Checkout**. Online payment only (no Cash on Delivery).

---

## Architecture Overview

```
Frontend (Firebase Hosting)
  ├── / (Landing Page - index.html)
  ├── /core (Core line - core.html)
  ├── /core/tees & /core/pants (Category Listings - category.html)
  ├── /product?id=... (Garment Details & Stock Picker - product.html)
  ├── /checkout (Guest Delivery & Razorpay Checkout - checkout.html)
  ├── /order?id=...&token=... (Live Real-time Order Tracker - order.html)
  ├── /admin (Store Management & Status Dispatch - admin.html)
  └── /policies (Terms, Privacy, Refund, Shipping - policies.html)

Backend (Cloud Functions 2nd Gen - Node 20)
  ├── POST /api/checkout (Server-side price computation & Razorpay order creation)
  ├── POST /api/verify (Signature validation for client feedback)
  ├── POST /api/razorpay-webhook (Source of truth: payment.captured, transaction stock deduction, email dispatch)
  └── GET & POST /api/admin/orders (Authenticated admin logistics fulfillment)
```

---

## 1. Firebase Project Setup

### A. Blaze Plan Requirement
> ⚠️ **Important**: Google Cloud Functions 2nd gen requires the **Firebase Blaze (Pay-as-you-go) plan** to call outbound external APIs (Razorpay API and Resend email API). The free Spark plan restricts outbound networking to Google services only.
> - Go to [Firebase Console](https://console.firebase.google.com/project/wear-house-6d810/usage/details) and upgrade to Blaze.

### B. Firestore Database Setup
1. Open the [Firebase Console Firestore tab](https://console.firebase.google.com/project/wear-house-6d810/firestore).
2. Click **Create Database**, select **Production Mode**, and choose your location (e.g. `asia-south1` Mumbai).
3. Deploy Firestore rules and indexes:
   ```powershell
   firebase deploy --only firestore
   ```

### C. Seed Sample Products into Firestore
Run the automated seed script to populate sample Tees and Pants with size stock:
```powershell
node scripts/seed-firestore.js
```

### D. Enable Google Sign-In in Firebase Auth
1. Go to [Firebase Console Authentication Tab](https://console.firebase.google.com/project/wear-house-6d810/authentication/providers).
2. Click **Get Started** (if not already enabled) and navigate to **Sign-in method**.
3. Click **Add new provider** &rarr; select **Google** &rarr; toggle **Enable**.
4. Set the support email (e.g. `wearh503@gmail.com`) and click **Save**.
5. Both 1-click **Admin Sign In** and **Checkout Express Autofill** will now work with Google accounts.

---

## 2. Setting Secret Manager Secrets

Cloud Functions 2nd Gen utilizes Google Cloud Secret Manager via `defineSecret`. Never store API keys or secrets in source code or client bundles.

Run each of these commands in your terminal and enter the corresponding values when prompted:

```powershell
# 1. Razorpay Public Key ID (e.g., rzp_test_...)
firebase functions:secrets:set RAZORPAY_KEY_ID

# 2. Razorpay Secret Key (from Razorpay Dashboard > Settings > API Keys)
firebase functions:secrets:set RAZORPAY_KEY_SECRET

# 3. Razorpay Webhook Secret (defined when creating webhook in Razorpay)
firebase functions:secrets:set RAZORPAY_WEBHOOK_SECRET

# 4. Resend API Key (from resend.com for automated order notification emails)
firebase functions:secrets:set RESEND_API_KEY
```

---

## 3. Configuring the Razorpay Webhook

The webhook is the **source of truth** for marking orders paid, preventing client spoofing, and triggering transactional emails.

1. Log in to your [Razorpay Dashboard](https://dashboard.razorpay.com/) (Switch to **Test Mode**).
2. Navigate to **Settings** &rarr; **Webhooks** &rarr; **Add New Webhook**.
3. **Webhook URL**:
   ```
   https://wear-house-6d810.web.app/api/razorpay-webhook
   ```
4. **Secret**: Enter a strong secret string (and set the same string in `RAZORPAY_WEBHOOK_SECRET` above).
5. **Active Events**:
   - `payment.captured`
   - `payment.failed`
6. Click **Save Webhook**.

---

## 4. Deploying to Firebase Production

Deploy all Hosting assets, Cloud Functions, and Firestore security rules in one command:

```powershell
firebase deploy
```

Or deploy components independently:
```powershell
# Deploy frontend pages
firebase deploy --only hosting

# Deploy backend functions
firebase deploy --only functions

# Deploy database security rules
firebase deploy --only firestore:rules
```

---

## 5. Testing with Razorpay Test Cards & UPI

Razorpay provides standard sandbox instruments in Test Mode:

### A. Test UPI
- In Razorpay Checkout, select **UPI**.
- Enter any virtual payment address (VPA) such as `success@razorpay`.
- Razorpay simulates instant bank approval.

### B. Test Cards
- **Card Number**: `4111 1111 1111 1111`
- **Expiry**: Any future date (e.g. `12/30`)
- **CVV**: `123`
- **OTP**: Enter `123456` or click **Success** on the Razorpay bank simulator screen.

---

## 6. Store Administrator Portal (`/admin`)

- Access the management dashboard at: `https://wear-house-6d810.web.app/admin`
- Authorized Admin Email: `wearh503@gmail.com`
- Create an Admin user in [Firebase Auth](https://console.firebase.google.com/project/wear-house-6d810/authentication/users) with this email.
- The Admin dashboard allows you to view all customer orders, filter by payment status, and mark orders as **Shipped** or **Delivered**.
