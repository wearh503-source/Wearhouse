/**
 * Wearhouse Shared Cart Module (localStorage)
 */

(function () {
  const CART_KEY = "wearhouse_cart";

  const WearhouseCart = {
    get() {
      try {
        const stored = localStorage.getItem(CART_KEY);
        return stored ? JSON.parse(stored) : [];
      } catch (e) {
        console.error("Error reading cart from localStorage:", e);
        return [];
      }
    },

    save(cart) {
      try {
        localStorage.setItem(CART_KEY, JSON.stringify(cart));
        window.dispatchEvent(new CustomEvent("wearhouse:cart-updated", { detail: { cart } }));
      } catch (e) {
        console.error("Error saving cart to localStorage:", e);
      }
    },

    add(item) {
      const cart = this.get();
      // Check if item with same productId and size already exists
      const existingIdx = cart.findIndex(
        (i) => i.productId === item.productId && i.size === item.size
      );

      if (existingIdx > -1) {
        cart[existingIdx].qty = Math.min(10, cart[existingIdx].qty + (item.qty || 1));
      } else {
        cart.push({
          productId: item.productId,
          name: item.name,
          category: item.category,
          size: item.size,
          qty: item.qty || 1,
          price_paise: item.price_paise,
          image: item.image || ""
        });
      }

      this.save(cart);
      this.open();
    },

    updateQty(index, delta) {
      const cart = this.get();
      if (!cart[index]) return;

      cart[index].qty += delta;
      if (cart[index].qty <= 0) {
        cart.splice(index, 1);
      } else if (cart[index].qty > 10) {
        cart[index].qty = 10;
      }

      this.save(cart);
    },

    remove(index) {
      const cart = this.get();
      if (cart[index]) {
        cart.splice(index, 1);
        this.save(cart);
      }
    },

    clear() {
      localStorage.removeItem(CART_KEY);
      window.dispatchEvent(new CustomEvent("wearhouse:cart-updated", { detail: { cart: [] } }));
    },

    count() {
      return this.get().reduce((acc, item) => acc + item.qty, 0);
    },

    totalPaise() {
      return this.get().reduce((acc, item) => acc + (item.price_paise || 0) * item.qty, 0);
    },

    open() {
      const backdrop = document.getElementById("cart-backdrop");
      if (backdrop) {
        backdrop.classList.add("is-open");
        this.render();
      }
    },

    close() {
      const backdrop = document.getElementById("cart-backdrop");
      if (backdrop) {
        backdrop.classList.remove("is-open");
      }
    },

    render() {
      const listEl = document.getElementById("cart-items-list");
      const subtotalEl = document.getElementById("cart-subtotal");
      const checkoutBtn = document.getElementById("cart-checkout-btn");
      const badges = document.querySelectorAll(".cart-badge");

      const cart = this.get();
      const count = this.count();
      const total = this.totalPaise();

      // Update badge counts across page
      badges.forEach((b) => (b.textContent = count));

      if (!listEl) return;

      if (cart.length === 0) {
        listEl.innerHTML = `
          <div style="text-align: center; padding: 48px 16px; color: rgba(253,252,248,0.6);">
            <p style="font-size: 18px; margin-bottom: 8px;">Your bag is empty.</p>
            <p style="font-size: 14px;">Select pieces from the Core line to begin.</p>
          </div>
        `;
        if (subtotalEl) subtotalEl.textContent = "₹0";
        if (checkoutBtn) {
          checkoutBtn.style.opacity = "0.5";
          checkoutBtn.style.pointerEvents = "none";
        }
        return;
      }

      if (checkoutBtn) {
        checkoutBtn.style.opacity = "1";
        checkoutBtn.style.pointerEvents = "auto";
      }

      listEl.innerHTML = cart
        .map(
          (item, idx) => `
          <div class="cart-item">
            <img src="${item.image || 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=200'}" alt="${item.name}" class="cart-item-img" />
            <div class="cart-item-details">
              <div class="cart-item-title">${item.name}</div>
              <div class="cart-item-meta">Size: <strong>${item.size}</strong></div>
              <div class="cart-item-price">₹${((item.price_paise * item.qty) / 100).toLocaleString("en-IN")}</div>
              <div class="cart-item-controls">
                <button class="qty-btn" onclick="WearhouseCart.updateQty(${idx}, -1)" aria-label="Decrease quantity">-</button>
                <span style="font-size: 14px; font-weight: bold; min-width: 20px; text-align: center;">${item.qty}</span>
                <button class="qty-btn" onclick="WearhouseCart.updateQty(${idx}, 1)" aria-label="Increase quantity">+</button>
                <button onclick="WearhouseCart.remove(${idx})" style="margin-left: auto; color: rgba(255,255,255,0.6); font-size: 12px; text-decoration: underline;">Remove</button>
              </div>
            </div>
          </div>
        `
        )
        .join("");

      if (subtotalEl) {
        subtotalEl.textContent = `₹${(total / 100).toLocaleString("en-IN")}`;
      }
    },

    injectDrawer() {
      if (document.getElementById("cart-backdrop")) return;

      const drawerHtml = `
        <div class="cart-backdrop" id="cart-backdrop" onclick="if(event.target === this) WearhouseCart.close()">
          <div class="cart-drawer" role="dialog" aria-modal="true" aria-label="Shopping Bag">
            <div class="cart-drawer-header">
              <span class="cart-drawer-title">BAG</span>
              <button class="cart-close-btn" onclick="WearhouseCart.close()" aria-label="Close Bag">&times;</button>
            </div>
            <div class="cart-items-list" id="cart-items-list"></div>
            <div class="cart-drawer-footer">
              <div class="cart-subtotal-row">
                <span>Subtotal</span>
                <span id="cart-subtotal">₹0</span>
              </div>
              <a href="/checkout" class="cart-checkout-btn" id="cart-checkout-btn">Proceed to Checkout &rarr;</a>
            </div>
          </div>
        </div>
      `;

      document.body.insertAdjacentHTML("beforeend", drawerHtml);
      this.render();
    }
  };

  window.WearhouseCart = WearhouseCart;

  document.addEventListener("DOMContentLoaded", () => {
    WearhouseCart.injectDrawer();
    window.addEventListener("wearhouse:cart-updated", () => WearhouseCart.render());
  });
})();
