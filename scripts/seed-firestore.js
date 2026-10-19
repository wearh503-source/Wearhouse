/**
 * Wearhouse Firestore Seeding Script
 * Run with: node scripts/seed-firestore.js
 */

const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp({
    projectId: "wear-house-6d810"
  });
}

const db = admin.firestore();

const SAMPLE_PRODUCTS = [
  {
    id: "tees-boxy-240",
    slug: "the-240-gsm-boxy-tee",
    name: "The 240 GSM Boxy Tee [Placeholder]",
    category: "tees",
    price_paise: 149900,
    active: true,
    description: "Sample Placeholder — Custom combed heavyweight organic cotton with reinforced collar ribbing that never sags.",
    images: [
      "https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=900&auto=format&fit=crop&q=80",
      "https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?w=900&auto=format&fit=crop&q=80"
    ],
    sizes: {
      S: 15,
      M: 30,
      L: 20,
      XL: 6
    }
  },
  {
    id: "tees-minimalist-relaxed",
    slug: "the-relaxed-minimalist-tee",
    name: "The Relaxed Minimalist Tee [Placeholder]",
    category: "tees",
    price_paise: 129900,
    active: true,
    description: "Sample Placeholder — Breathable drape with dropped shoulders for effortless day-to-night styling.",
    images: [
      "https://images.unsplash.com/photo-1581655353564-df123a1eb820?w=900&auto=format&fit=crop&q=80",
      "https://images.unsplash.com/photo-1503342217505-b0a15ec3261c?w=900&auto=format&fit=crop&q=80"
    ],
    sizes: {
      S: 10,
      M: 18,
      L: 12,
      XL: 0 // Sold out test
    }
  },
  {
    id: "pants-pleated-trouser",
    slug: "everyday-pleated-trouser",
    name: "Everyday Pleated Trouser [Placeholder]",
    category: "pants",
    price_paise: 249900,
    active: true,
    description: "Sample Placeholder — Tailored wide-leg drape with double front pleats and concealed waistband elastic.",
    images: [
      "https://images.unsplash.com/photo-1624378439575-d8705ad7ae80?w=900&auto=format&fit=crop&q=80",
      "https://images.unsplash.com/photo-1473966968600-fa801b869a1a?w=900&auto=format&fit=crop&q=80"
    ],
    sizes: {
      S: 8,
      M: 22,
      L: 14,
      XL: 5
    }
  },
  {
    id: "pants-heavy-twill",
    slug: "relaxed-heavy-twill-pant",
    name: "Relaxed Heavy Twill Pant [Placeholder]",
    category: "pants",
    price_paise: 229900,
    active: true,
    description: "Sample Placeholder — Dense cotton twill cut with relaxed tapered leg and heavy-duty bar-tack stitching.",
    images: [
      "https://images.unsplash.com/photo-1541099649105-f69ad21f3246?w=900&auto=format&fit=crop&q=80",
      "https://images.unsplash.com/photo-1552902865-b72c031ac5ea?w=900&auto=format&fit=crop&q=80"
    ],
    sizes: {
      S: 5,
      M: 15,
      L: 10,
      XL: 0 // Sold out test
    }
  }
];

async function seed() {
  console.log("🌱 Seeding Wearhouse sample products into Firestore...");

  for (const prod of SAMPLE_PRODUCTS) {
    const { sizes, ...prodData } = prod;
    const prodRef = db.collection("products").doc(prod.id);

    await prodRef.set({
      ...prodData,
      updated_at: admin.firestore.FieldValue.serverTimestamp()
    });

    console.log(`✓ Product created: ${prod.name} (${prod.id})`);

    // Seed sizes subcollection
    for (const [sizeName, stockCount] of Object.entries(sizes)) {
      await prodRef.collection("sizes").doc(sizeName).set({
        stock: stockCount
      });
      console.log(`  - Size ${sizeName}: ${stockCount} in stock`);
    }
  }

  console.log("🎉 Seeding completed successfully!");
}

if (require.main === module) {
  seed().catch((err) => {
    console.error("Seeding failed:", err);
    process.exit(1);
  });
}

module.exports = { SAMPLE_PRODUCTS, seed };
