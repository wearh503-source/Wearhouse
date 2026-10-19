const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const crypto = require("crypto");
const Razorpay = require("razorpay");
const { Resend } = require("resend");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// Secret Manager Secrets
const RAZORPAY_KEY_ID = defineSecret("RAZORPAY_KEY_ID");
const RAZORPAY_KEY_SECRET = defineSecret("RAZORPAY_KEY_SECRET");
const RAZORPAY_WEBHOOK_SECRET = defineSecret("RAZORPAY_WEBHOOK_SECRET");
const RESEND_API_KEY = defineSecret("RESEND_API_KEY");

const OWNER_EMAIL = process.env.OWNER_EMAIL || "wearh503@gmail.com";

// Simple in-memory IP rate limiter for checkout
const ipRequestWindow = new Map();
function isRateLimited(ip) {
  const now = Date.now();
  const windowMs = 60 * 1000; // 1 minute
  const maxRequests = 20;

  const userRecord = ipRequestWindow.get(ip) || [];
  const recentRequests = userRecord.filter((timestamp) => now - timestamp < windowMs);

  if (recentRequests.length >= maxRequests) {
    return true;
  }

  recentRequests.push(now);
  ipRequestWindow.set(ip, recentRequests);
  return false;
}

// Helper to get Razorpay instance
function getRazorpayClient() {
  const key_id = process.env.RAZORPAY_KEY_ID || (RAZORPAY_KEY_ID.value ? RAZORPAY_KEY_ID.value() : null);
  const key_secret = process.env.RAZORPAY_KEY_SECRET || (RAZORPAY_KEY_SECRET.value ? RAZORPAY_KEY_SECRET.value() : null);

  if (!key_id || !key_secret) {
    throw new Error("Razorpay credentials not configured. Please set Secret Manager secrets.");
  }

  return {
    client: new Razorpay({ key_id, key_secret }),
    keyId: key_id,
    keySecret: key_secret
  };
}

// CORS Helper
function handleCors(req, res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Read-Token");
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return true;
  }
  return false;
}

/**
 * Main API HTTP Cloud Function (2nd Gen)
 * Handles:
 * - POST /api/checkout
 * - POST /api/verify
 * - POST /api/razorpay-webhook
 * - GET  /api/admin/orders
 * - POST /api/admin/orders/status
 */
exports.api = onRequest(
  {
    cors: true,
    secrets: [RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET, RESEND_API_KEY]
  },
  async (req, res) => {
    if (handleCors(req, res)) return;

    const path = req.path.replace(/^\/api/, "");
    const clientIp = req.ip || req.headers["x-forwarded-for"] || "127.0.0.1";

    try {
      // -------------------------------------------------------------
      // 1. POST /api/checkout
      // -------------------------------------------------------------
      if (req.method === "POST" && (path === "/checkout" || path === "/checkout/")) {
        if (isRateLimited(clientIp)) {
          return res.status(429).json({ error: "Too many requests. Please wait a minute and try again." });
        }

        const { items, customer } = req.body || {};

        // Validation: Customer details
        if (!customer || !customer.name || !customer.email || !customer.phone || !customer.address || !customer.city || !customer.state || !customer.pincode) {
          return res.status(400).json({ error: "All customer delivery fields are required." });
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(customer.email.trim())) {
          return res.status(400).json({ error: "Please provide a valid email address." });
        }

        const phoneClean = customer.phone.toString().replace(/\D/g, "");
        if (phoneClean.length < 10) {
          return res.status(400).json({ error: "Please enter a valid 10-digit Indian phone number." });
        }

        const pinClean = customer.pincode.toString().replace(/\D/g, "");
        if (pinClean.length !== 6) {
          return res.status(400).json({ error: "Please enter a valid 6-digit Indian PIN code." });
        }

        // Validation: Items
        if (!Array.isArray(items) || items.length === 0) {
          return res.status(400).json({ error: "Cart is empty." });
        }

        // Re-read current prices and verify stock from Firestore
        let totalPaise = 0;
        const verifiedItems = [];

        for (const item of items) {
          const { productId, size, qty } = item;
          const quantity = parseInt(qty, 10);

          if (!productId || !size || isNaN(quantity) || quantity < 1 || quantity > 10) {
            return res.status(400).json({ error: `Invalid item or quantity for product ${productId || 'unknown'}` });
          }

          const productDoc = await db.collection("products").doc(productId).get();
          if (!productDoc.exists) {
            return res.status(404).json({ error: `Product not found: ${productId}` });
          }

          const productData = productDoc.data();
          if (!productData.active) {
            return res.status(400).json({ error: `Product is currently unavailable: ${productData.name}` });
          }

          const sizeDoc = await db.collection("products").doc(productId).collection("sizes").doc(size).get();
          if (!sizeDoc.exists) {
            return res.status(400).json({ error: `Size ${size} not available for ${productData.name}` });
          }

          const stock = sizeDoc.data().stock || 0;
          if (stock < quantity) {
            return res.status(400).json({
              error: `Not enough stock for ${productData.name} (Size: ${size}). Only ${stock} left.`
            });
          }

          const itemPricePaise = productData.price_paise;
          totalPaise += itemPricePaise * quantity;

          verifiedItems.push({
            productId: productId,
            slug: productData.slug || productId,
            name: productData.name,
            category: productData.category || "basics",
            size: size,
            qty: quantity,
            price_paise: itemPricePaise,
            image: (productData.images && productData.images[0]) || ""
          });
        }

        if (totalPaise <= 0) {
          return res.status(400).json({ error: "Calculated order total must be greater than zero." });
        }

        // Generate unguessable Order ID and read token
        const orderId = "wh_" + crypto.randomBytes(12).toString("hex");
        const readToken = crypto.randomBytes(16).toString("hex");

        // Call Razorpay Orders API
        const { client: rzp, keyId } = getRazorpayClient();
        const rzpOrder = await rzp.orders.create({
          amount: totalPaise,
          currency: "INR",
          receipt: orderId,
          notes: {
            orderId: orderId,
            customerEmail: customer.email.trim(),
            customerPhone: phoneClean
          }
        });

        // Save order document in Firestore with status 'created'
        await db.collection("orders").doc(orderId).set({
          order_id: orderId,
          read_token: readToken,
          status: "created",
          razorpay_order_id: rzpOrder.id,
          razorpay_payment_id: null,
          items: verifiedItems,
          total_paise: totalPaise,
          currency: "INR",
          customer: {
            name: customer.name.trim(),
            email: customer.email.trim(),
            phone: phoneClean,
            address: customer.address.trim(),
            city: customer.city.trim(),
            state: customer.state.trim(),
            pincode: pinClean
          },
          created_at: admin.firestore.FieldValue.serverTimestamp(),
          paid_at: null
        });

        // Return order info with public key only
        return res.status(200).json({
          success: true,
          orderId: orderId,
          readToken: readToken,
          razorpayOrderId: rzpOrder.id,
          amount: totalPaise,
          currency: "INR",
          keyId: keyId
        });
      }

      // -------------------------------------------------------------
      // 2. POST /api/verify
      // -------------------------------------------------------------
      if (req.method === "POST" && (path === "/verify" || path === "/verify/")) {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature, order_id } = req.body || {};

        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !order_id) {
          return res.status(400).json({ error: "Missing required verification parameters." });
        }

        const { keySecret } = getRazorpayClient();
        const expectedSignature = crypto
          .createHmac("sha256", keySecret)
          .update(`${razorpay_order_id}|${razorpay_payment_id}`)
          .digest("hex");

        if (expectedSignature !== razorpay_signature) {
          console.warn("Invalid payment signature received for order:", order_id);
          return res.status(400).json({ success: false, error: "Payment verification signature mismatch." });
        }

        // Store payment ID on the order document for reference (Webhook remains source of truth for 'paid' status)
        const orderRef = db.collection("orders").doc(order_id);
        const orderDoc = await orderRef.get();
        if (orderDoc.exists) {
          await orderRef.update({
            razorpay_payment_id: razorpay_payment_id
          });
        }

        return res.status(200).json({
          success: true,
          message: "Payment signature verified successfully."
        });
      }

      // -------------------------------------------------------------
      // 3. POST /api/razorpay-webhook
      // -------------------------------------------------------------
      if (req.method === "POST" && (path === "/razorpay-webhook" || path === "/razorpay-webhook/")) {
        const signature = req.headers["x-razorpay-signature"];
        const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || (RAZORPAY_WEBHOOK_SECRET.value ? RAZORPAY_WEBHOOK_SECRET.value() : null);

        if (!webhookSecret) {
          console.error("RAZORPAY_WEBHOOK_SECRET is not configured.");
          return res.status(500).send("Webhook secret not configured");
        }

        // Verify signature against raw request body
        const rawBody = req.rawBody || JSON.stringify(req.body);
        const expectedSignature = crypto
          .createHmac("sha256", webhookSecret)
          .update(rawBody)
          .digest("hex");

        if (signature !== expectedSignature) {
          console.warn("🚨 Razorpay Webhook signature verification failed! Signature header:", signature);
          return res.status(400).send("Invalid webhook signature");
        }

        const event = req.body;
        console.log(`🔔 Received Razorpay webhook event: ${event.event}`);

        // Handle payment.captured
        if (event.event === "payment.captured") {
          const paymentEntity = event.payload?.payment?.entity;
          const rzpOrderId = paymentEntity?.order_id;

          if (!rzpOrderId) {
            console.warn("No order_id present in payment.captured payload.");
            return res.status(200).send("No order_id in payload");
          }

          // Query order by razorpay_order_id
          const ordersQuery = await db.collection("orders").where("razorpay_order_id", "==", rzpOrderId).limit(1).get();
          if (ordersQuery.empty) {
            console.warn(`Order not found for Razorpay order ID: ${rzpOrderId}`);
            return res.status(200).send("Order doc not found");
          }

          const orderDocSnapshot = ordersQuery.docs[0];
          const orderRef = orderDocSnapshot.ref;

          let orderToNotify = null;

          // Transaction: Idempotently mark paid and reduce stock
          await db.runTransaction(async (transaction) => {
            const currentDoc = await transaction.get(orderRef);
            if (!currentDoc.exists) {
              throw new Error("Order doc disappeared during transaction");
            }

            const orderData = currentDoc.data();

            // Idempotent: If already marked paid, do nothing
            if (orderData.status === "paid") {
              console.log(`Order ${orderData.order_id} is already paid. Skipping duplicate webhook.`);
              return;
            }

            // Decrement size stock for each ordered item
            for (const item of orderData.items || []) {
              const sizeRef = db.collection("products").doc(item.productId).collection("sizes").doc(item.size);
              transaction.update(sizeRef, {
                stock: admin.firestore.FieldValue.increment(-item.qty)
              });
            }

            // Update order status
            transaction.update(orderRef, {
              status: "paid",
              razorpay_payment_id: paymentEntity.id,
              paid_at: admin.firestore.FieldValue.serverTimestamp()
            });

            orderToNotify = {
              ...orderData,
              status: "paid",
              razorpay_payment_id: paymentEntity.id
            };
          });

          // Send emails if order was newly marked paid
          if (orderToNotify) {
            await sendOrderNotificationEmails(orderToNotify);
          }

          return res.status(200).json({ status: "ok" });
        }

        // Handle payment.failed
        if (event.event === "payment.failed") {
          const paymentEntity = event.payload?.payment?.entity;
          const rzpOrderId = paymentEntity?.order_id;

          if (rzpOrderId) {
            const ordersQuery = await db.collection("orders").where("razorpay_order_id", "==", rzpOrderId).limit(1).get();
            if (!ordersQuery.empty) {
              const orderDoc = ordersQuery.docs[0];
              await orderDoc.ref.update({
                status: "failed",
                last_failure_reason: paymentEntity.error_description || "Payment failed"
              });
              console.log(`Order ${orderDoc.id} marked failed via webhook.`);
            }
          }

          return res.status(200).json({ status: "ok" });
        }

        return res.status(200).json({ status: "event_ignored" });
      }

      // -------------------------------------------------------------
      // 4. GET /api/admin/orders
      // -------------------------------------------------------------
      if (req.method === "GET" && (path === "/admin/orders" || path === "/admin/orders/")) {
        const decodedToken = await verifyAdminAuth(req, res);
        if (!decodedToken) return;

        const snapshot = await db.collection("orders").orderBy("created_at", "desc").limit(100).get();
        const orders = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data()
        }));

        return res.status(200).json({ orders });
      }

      // -------------------------------------------------------------
      // 5. POST /api/admin/orders/status
      // -------------------------------------------------------------
      if (req.method === "POST" && (path === "/admin/orders/status" || path === "/admin/orders/status/")) {
        const decodedToken = await verifyAdminAuth(req, res);
        if (!decodedToken) return;

        const { orderId, status } = req.body || {};
        if (!orderId || !["shipped", "delivered"].includes(status)) {
          return res.status(400).json({ error: "Invalid order ID or target status. Allowed: shipped, delivered" });
        }

        const orderRef = db.collection("orders").doc(orderId);
        const orderDoc = await orderRef.get();
        if (!orderDoc.exists) {
          return res.status(404).json({ error: "Order not found" });
        }

        await orderRef.update({
          status: status,
          [`${status}_at`]: admin.firestore.FieldValue.serverTimestamp()
        });

        return res.status(200).json({ success: true, orderId, status });
      }

      // 404 for any other path
      return res.status(404).json({ error: `Not found: ${req.method} /api${path}` });
    } catch (err) {
      console.error("Cloud Functions API Error:", err);
      return res.status(500).json({
        error: "Internal Server Error",
        message: err.message
      });
    }
  }
);

// Admin Auth Token Verifier
async function verifyAdminAuth(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized: Missing or invalid Authorization header." });
    return null;
  }

  const idToken = authHeader.split("Bearer ")[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    if (decodedToken.email !== OWNER_EMAIL) {
      res.status(403).json({ error: "Forbidden: You are not authorized to access Wearhouse admin." });
      return null;
    }
    return decodedToken;
  } catch (err) {
    res.status(401).json({ error: "Unauthorized: Invalid token", details: err.message });
    return null;
  }
}

// Transactional Emails Handler (Resend)
async function sendOrderNotificationEmails(order) {
  const resendApiKey = process.env.RESEND_API_KEY || (RESEND_API_KEY.value ? RESEND_API_KEY.value() : null);
  if (!resendApiKey) {
    console.warn("⚠️ RESEND_API_KEY not configured. Skipping email dispatch.");
    return;
  }

  const resend = new Resend(resendApiKey);
  const totalRupees = (order.total_paise / 100).toLocaleString("en-IN", {
    style: "currency",
    currency: "INR"
  });

  const itemsHtml = (order.items || [])
    .map(
      (item) => `
      <tr>
        <td style="padding: 8px 12px; border-bottom: 1px solid #eee;">
          <strong>${item.name}</strong><br>
          <span style="color: #666; font-size: 13px;">Size: ${item.size} | Qty: ${item.qty}</span>
        </td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #eee; text-align: right;">
          ₹${((item.price_paise * item.qty) / 100).toLocaleString("en-IN")}
        </td>
      </tr>
    `
    )
    .join("");

  const trackingUrl = `https://wear-house-6d810.web.app/order?id=${order.order_id}&token=${order.read_token}`;

  // 1. Email to Owner
  try {
    await resend.emails.send({
      from: "Wearhouse Store <orders@wear-house-6d810.web.app>",
      to: [OWNER_EMAIL],
      subject: `🚨 [NEW PAID ORDER] ${order.order_id} — ${totalRupees}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #222;">
          <h2 style="color: #6b1030;">New Paid Order: ${order.order_id}</h2>
          <p><strong>Total:</strong> ${totalRupees}</p>
          <p><strong>Razorpay Payment ID:</strong> ${order.razorpay_payment_id || "N/A"}</p>
          
          <h3 style="border-bottom: 2px solid #6b1030; padding-bottom: 6px;">Customer & Shipping Info</h3>
          <p>
            <strong>Name:</strong> ${order.customer.name}<br>
            <strong>Email:</strong> ${order.customer.email}<br>
            <strong>Phone:</strong> ${order.customer.phone}<br>
            <strong>Address:</strong><br>
            ${order.customer.address}<br>
            ${order.customer.city}, ${order.customer.state} - ${order.customer.pincode}
          </p>

          <h3 style="border-bottom: 2px solid #6b1030; padding-bottom: 6px;">Order Items</h3>
          <table style="width: 100%; border-collapse: collapse;">
            ${itemsHtml}
          </table>
        </div>
      `
    });
    console.log(`✉️ Notification email sent to owner: ${OWNER_EMAIL}`);
  } catch (err) {
    console.error("Failed to send owner notification email:", err);
  }

  // 2. Email to Customer
  try {
    await resend.emails.send({
      from: "Wearhouse <orders@wear-house-6d810.web.app>",
      to: [order.customer.email],
      subject: `Order Confirmed: ${order.order_id} — Wearhouse`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #222;">
          <h2 style="color: #6b1030;">Thanks for your order, ${order.customer.name}!</h2>
          <p>Your payment has been received and order <strong>${order.order_id}</strong> is being prepared.</p>

          <h3 style="border-bottom: 2px solid #6b1030; padding-bottom: 6px;">Order Summary</h3>
          <table style="width: 100%; border-collapse: collapse;">
            ${itemsHtml}
            <tr>
              <td style="padding: 12px; font-weight: bold;">Total Paid</td>
              <td style="padding: 12px; font-weight: bold; text-align: right; color: #6b1030;">${totalRupees}</td>
            </tr>
          </table>

          <p style="margin-top: 24px;">
            <a href="${trackingUrl}" style="background-color: #6b1030; color: #fdfcf8; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">
              View Live Order Status
            </a>
          </p>

          <p style="color: #777; font-size: 13px; margin-top: 32px;">
            Wearhouse Co. | Basics that stay. Drops that don't.
          </p>
        </div>
      `
    });
    console.log(`✉️ Confirmation email sent to customer: ${order.customer.email}`);
  } catch (err) {
    console.error("Failed to send customer confirmation email:", err);
  }
}
