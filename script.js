/**
 * Flora by Kriti - Client Script & E-Commerce Module
 * Handcrafted Luxury Flowers & Floral Lamps - Guwahati
 */

// ============================================================================
// 1. CONFIGURATION
// ============================================================================
const FLORA_CONFIG = {
  brandName: "Flora by Kriti",
  location: "Guwahati, Assam",
  instagramUrl: "https://www.instagram.com/flora_by_kriti/",
  
  // Set owner's 10-digit WhatsApp number (with 91 country code, no + or dashes)
  whatsappNumber: "918638223082",
  storageKey: "flora_by_kriti_cart_v1"
};
const PRODUCTS_PER_PAGE = 12;

let floraProducts = [];
let activeProductFilter = 'all';
let visibleProductCount = PRODUCTS_PER_PAGE;
let checkoutCaptchaToken = '';
let checkoutTurnstileWidgetId = null;
let turnstileScriptPromise = null;
let orderSubmissionInProgress = false;
const CHECKOUT_IDEMPOTENCY_STORAGE_KEY = 'flora_checkout_idempotency_v1';

const PLACEHOLDER_IMG = "data:image/svg+xml;charset=UTF-8,%3Csvg%20width%3D%22400%22%20height%3D%22340%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%20400%20340%22%3E%3Crect%20fill%3D%22%23F8EDEB%22%20width%3D%22400%22%20height%3D%22340%22%2F%3E%3Ctext%20fill%3D%22%23BD7C83%22%20font-family%3D%22sans-serif%22%20font-size%3D%2220%22%20x%3D%2250%25%22%20y%3D%2250%25%22%20text-anchor%3D%22middle%22%20dominant-baseline%3D%22middle%22%3EFlora%20by%20Kriti%3C%2Ftext%3E%3C%2Fsvg%3E";

// ============================================================================
// 2. CURRENCY & FORMATTING UTILITIES
// ============================================================================
function formatINR(number) {
  return "₹" + Number(number).toLocaleString('en-IN');
}

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function showCheckoutError(message) {
  const errorElement = document.getElementById('checkoutError');
  if (!errorElement) return;
  errorElement.textContent = message;
  errorElement.style.display = 'block';
}

function clearCheckoutError() {
  const errorElement = document.getElementById('checkoutError');
  if (!errorElement) return;
  errorElement.textContent = '';
  errorElement.style.display = 'none';
}

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!turnstileScriptPromise) {
    turnstileScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.defer = true;
      script.onload = () => {
        if (window.turnstile) resolve(window.turnstile);
        else reject(new Error('The CAPTCHA script loaded without its API.'));
      };
      script.onerror = () => reject(new Error('The CAPTCHA script could not be loaded.'));
      document.head.appendChild(script);
    }).catch(error => {
      turnstileScriptPromise = null;
      throw error;
    });
  }
  return turnstileScriptPromise;
}

async function initializeCheckoutTurnstile() {
  const container = document.getElementById('checkoutTurnstile');
  if (!container || checkoutTurnstileWidgetId !== null) return;

  if (!window.FLORA_TURNSTILE_SITE_KEY) {
    showCheckoutError('Security verification is not configured. Please contact the shop.');
    return;
  }

  try {
    const turnstile = await loadTurnstile();
    if (!document.body.contains(container)) return;
    checkoutTurnstileWidgetId = turnstile.render(container, {
      sitekey: window.FLORA_TURNSTILE_SITE_KEY,
      callback: token => {
        checkoutCaptchaToken = token;
        clearCheckoutError();
      },
      'expired-callback': () => {
        checkoutCaptchaToken = '';
      },
      'error-callback': () => {
        checkoutCaptchaToken = '';
        showCheckoutError('Security verification failed to load. Please try again.');
      }
    });
  } catch (error) {
    console.error('Could not initialize checkout CAPTCHA:', error);
    showCheckoutError('Security verification could not load. Please try again.');
  }
}

async function getOrderSubmissionErrorMessage(error) {
  const response = error?.context;
  if (response instanceof Response) {
    try {
      const payload = await response.clone().json();
      if (typeof payload?.error === 'string') return payload.error;
      if (window.location.origin !== 'http://127.0.0.1:5500') {
        return 'We could not place your order. Please try again.';
      }
      const configurationKeys = [
        'SUPABASE_URL',
        'SUPABASE_SERVICE_ROLE_KEY',
        'TURNSTILE_SECRET_KEY',
        'TURNSTILE_HOSTNAME'
      ];
      if (
        payload &&
        configurationKeys.every(key => typeof payload[key] === 'boolean')
      ) {
        return `Local configuration diagnostic (true = configured): ${configurationKeys
          .map(key => `${key}: ${payload[key] ? 'present' : 'missing'}`)
          .join(', ')}.`;
      }
    } catch {
      // Fall back to a generic message when the function response is not JSON.
    }
  }
  return 'We could not place your order. Please try again.';
}

function getCanonicalCheckoutDetails(name, phone, address, notes, items) {
  return {
    customer_name: name,
    customer_phone: phone,
    delivery_address: address,
    customer_note: notes || null,
    items: [...items]
      .map(item => ({ product_id: item.id.trim(), quantity: item.quantity }))
      .sort((left, right) =>
        left.product_id < right.product_id ? -1 : left.product_id > right.product_id ? 1 : 0
      )
  };
}

async function fingerprintCheckout(details, customerId = null) {
  const canonicalDetails = customerId
    ? { ...details, customer_id: customerId }
    : details;
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(canonicalDetails))
  );
  return Array.from(new Uint8Array(digest), byte =>
    byte.toString(16).padStart(2, '0')
  ).join('');
}

function getOrCreateCheckoutIdempotencyKey(fingerprint) {
  let storedKeys;
  try {
    const serializedKeys = sessionStorage.getItem(CHECKOUT_IDEMPOTENCY_STORAGE_KEY);
    storedKeys = serializedKeys === null ? {} : JSON.parse(serializedKeys);
  } catch {
    throw new Error('Could not securely retain this checkout for retry. Please enable session storage and try again.');
  }

  if (
    !storedKeys ||
    typeof storedKeys !== 'object' ||
    Array.isArray(storedKeys) ||
    Object.entries(storedKeys).some(([storedFingerprint, key]) =>
      !/^[0-9a-f]{64}$/.test(storedFingerprint) ||
      typeof key !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)
    )
  ) {
    throw new Error('Saved checkout retry data is invalid. Please contact the shop before retrying.');
  }

  let idempotencyKey = storedKeys[fingerprint];
  if (!idempotencyKey) {
    if (!crypto.randomUUID) {
      throw new Error('This browser cannot create a secure checkout retry key.');
    }
    idempotencyKey = crypto.randomUUID();
    storedKeys[fingerprint] = idempotencyKey;
    try {
      sessionStorage.setItem(CHECKOUT_IDEMPOTENCY_STORAGE_KEY, JSON.stringify(storedKeys));
    } catch {
      throw new Error('Could not securely retain this checkout for retry. Please enable session storage and try again.');
    }
  }

  return idempotencyKey;
}

function clearCheckoutIdempotencyKey(fingerprint) {
  try {
    const serializedKeys = sessionStorage.getItem(CHECKOUT_IDEMPOTENCY_STORAGE_KEY);
    if (serializedKeys === null) return;
    const storedKeys = JSON.parse(serializedKeys);
    if (storedKeys && typeof storedKeys === 'object' && !Array.isArray(storedKeys)) {
      delete storedKeys[fingerprint];
      if (Object.keys(storedKeys).length === 0) {
        sessionStorage.removeItem(CHECKOUT_IDEMPOTENCY_STORAGE_KEY);
      } else {
        sessionStorage.setItem(CHECKOUT_IDEMPOTENCY_STORAGE_KEY, JSON.stringify(storedKeys));
      }
    }
  } catch (error) {
    console.error('Could not clear confirmed checkout retry data:', error);
  }
}

// ============================================================================
// 3. CART STATE MANAGEMENT (PERSISTENT VIA LOCALSTORAGE)
// ============================================================================
let cart = [];

/**
 * Loads cart from localStorage.
 */
function loadCart() {
  try {
    const saved = localStorage.getItem(FLORA_CONFIG.storageKey);
    if (saved) {
      cart = JSON.parse(saved);
      if (!Array.isArray(cart)) cart = [];
    }
  } catch (e) {
    console.error("Could not load cart from storage:", e);
    cart = [];
  }
  renderCartUI();
}

/**
 * Saves current cart to localStorage.
 */
function saveCart() {
  try {
    localStorage.setItem(FLORA_CONFIG.storageKey, JSON.stringify(cart));
  } catch (e) {
    console.error("Could not persist cart:", e);
  }
  renderCartUI();
}

/**
 * Adds a product to the cart or increments existing quantity.
 */
function addToCart(product) {
  const existingIndex = cart.findIndex(item => item.id === product.id);

  if (existingIndex > -1) {
    cart[existingIndex].quantity += 1;
  } else {
    cart.push({
      id: product.id,
      name: product.name,
      price: Number(product.price),
      image: product.image,
      quantity: 1
    });
  }

  saveCart();
  showToast(`"${product.name}" added to basket!`);
  animateBadge();
}

function addToCartById(productId) {
  const product = floraProducts.find(item => item.id === productId);
  if (product) addToCart(product);
}

/**
 * Updates quantity of a specific item (min 1).
 */
function updateCartItemQuantity(productId, delta) {
  const item = cart.find(i => i.id === productId);
  if (!item) return;

  const newQty = item.quantity + delta;
  if (newQty <= 0) {
    removeFromCart(productId);
  } else {
    item.quantity = newQty;
    saveCart();
  }
}

/**
 * Removes an item from the cart entirely.
 */
function removeFromCart(productId) {
  cart = cart.filter(item => item.id !== productId);
  saveCart();
}

/**
 * Clears all items from cart.
 */
function clearCart() {
  cart = [];
  saveCart();
}

/**
 * Computes subtotal, total items, and grand total.
 */
function calculateCartTotals() {
  let totalCount = 0;
  let grandTotal = 0;

  cart.forEach(item => {
    totalCount += item.quantity;
    grandTotal += item.price * item.quantity;
  });

  return { totalCount, grandTotal };
}

// ============================================================================
// 4. CART UI RENDERING
// ============================================================================
function renderCartUI() {
  const { totalCount, grandTotal } = calculateCartTotals();

  // 1. Update Cart Badge
  const badge = document.getElementById('cartBadge');
  if (badge) {
    badge.textContent = totalCount;
  }

  // 2. Update Cart Drawer Items & Elements
  const emptyState = document.getElementById('cartEmptyState');
  const itemsContainer = document.getElementById('cartItemsList');
  const cartFooter = document.getElementById('cartFooter');
  const grandTotalEl = document.getElementById('cartGrandTotal');

  if (grandTotalEl) {
    grandTotalEl.textContent = formatINR(grandTotal);
  }

  if (cart.length === 0) {
    if (emptyState) emptyState.style.display = 'flex';
    if (itemsContainer) itemsContainer.innerHTML = '';
    if (cartFooter) cartFooter.style.display = 'none';
  } else {
    if (emptyState) emptyState.style.display = 'none';
    if (cartFooter) cartFooter.style.display = 'block';

    if (itemsContainer) {
      itemsContainer.innerHTML = cart.map(item => {
        const itemSubtotal = item.price * item.quantity;
        return `
          <div class="cart-item" data-id="${item.id}">
            <img src="${item.image}" alt="${item.name}" class="cart-item-img">
            <div class="cart-item-details">
              <div>
                <h4 class="cart-item-title">${item.name}</h4>
                <div class="cart-item-price-unit">${formatINR(item.price)} each</div>
              </div>
              <div class="cart-item-controls">
                <div class="qty-control-group">
                  <button type="button" class="qty-btn" onclick="updateCartItemQuantity('${item.id}', -1)" aria-label="Decrease quantity">&minus;</button>
                  <span class="qty-number">${item.quantity}</span>
                  <button type="button" class="qty-btn" onclick="updateCartItemQuantity('${item.id}', 1)" aria-label="Increase quantity">&plus;</button>
                </div>
                <span class="cart-item-subtotal">${formatINR(itemSubtotal)}</span>
              </div>
            </div>
            <button type="button" class="cart-item-remove-btn" onclick="removeFromCart('${item.id}')" title="Remove item">
              <i class="fas fa-trash-alt"></i>
            </button>
          </div>
        `;
      }).join('');
    }
  }
}

/**
 * Reads data attributes from clicked product card.
 */
function handleAddToCartClick(buttonEl) {
  const card = buttonEl.closest('.product-card');
  if (!card) return;

  const product = {
    id: card.dataset.id || 'prod-' + Date.now(),
    name: card.dataset.name || card.querySelector('.product-name')?.textContent || 'Handcrafted Design',
    price: Number(card.dataset.price) || 999,
    image: card.dataset.image || card.querySelector('.product-img')?.src || ''
  };

  addToCart(product);
}

function showProductGridMessage(message, state = '') {
  const container = document.getElementById('productGrid');
  if (!container) return;

  container.innerHTML = `<p class="product-grid-message" role="status">${escapeHTML(message)}</p>`;
  container.dataset.state = state;
  document.getElementById('productLoadMore')?.setAttribute('hidden', '');
}

function updateProductLoadMore(totalProducts) {
  const loadMore = document.getElementById('productLoadMore');
  const summary = document.getElementById('productCountSummary');
  if (!loadMore || !summary) return;

  const shownCount = Math.min(visibleProductCount, totalProducts);
  summary.textContent = `Showing ${shownCount} of ${totalProducts} products`;
  loadMore.hidden = shownCount >= totalProducts;
}

function renderProductGrid(categoryFilter = activeProductFilter) {
  const container = document.getElementById('productGrid');
  if (!container) return;

  activeProductFilter = categoryFilter;
  const products = categoryFilter === 'all'
    ? floraProducts
    : floraProducts.filter(product => product.category === categoryFilter);

  if (products.length === 0) {
    showProductGridMessage(
      floraProducts.length === 0
        ? 'No products are available right now. Please check back soon.'
        : 'No products found in this category.',
      'empty'
    );
    return;
  }

  delete container.dataset.state;

  container.innerHTML = products.slice(0, visibleProductCount).map(product => {
    const categoryLabel = product.category === 'lamps' ? 'Floral Lamps'
      : product.category === 'bouquets' ? 'Bouquets'
        : 'Custom Arrangement';

    return `
      <article class="product-card" data-category="${escapeHTML(product.category)}" data-id="${escapeHTML(product.id)}">
        <div class="product-image-container">
          ${product.badge ? `<span class="product-badge">${escapeHTML(product.badge)}</span>` : ''}
          <img src="${escapeHTML(product.image || PLACEHOLDER_IMG)}" alt="${escapeHTML(product.name)}" class="product-img" onerror="this.src='${PLACEHOLDER_IMG}'">
        </div>
        <div class="product-info">
          <span class="product-category">${escapeHTML(categoryLabel)}</span>
          <h3 class="product-name">${escapeHTML(product.name)}</h3>
          <p class="product-desc">${escapeHTML(product.description)}</p>
          <div class="product-meta">
            <span class="product-price">${formatINR(product.price)}</span>
            ${product.note ? `<span class="price-note">${escapeHTML(product.note)}</span>` : ''}
          </div>
          <div class="product-actions-group">
            <button type="button" class="btn btn-add-cart" data-add-product="${escapeHTML(product.id)}">
              <i class="fas fa-cart-plus"></i> Add to Cart
            </button>
            <button type="button" class="btn btn-order" data-order-product="${escapeHTML(product.id)}">
              <i class="fab fa-whatsapp"></i> Inquire
            </button>
          </div>
        </div>
      </article>
    `;
  }).join('');
  updateProductLoadMore(products.length);
}

async function loadProducts() {
  const container = document.getElementById('productGrid');
  if (!container) return;

  container.setAttribute('aria-busy', 'true');
  showProductGridMessage('Loading products…', 'loading');

  if (!window.floraSupabase) {
    console.error('Supabase is not initialized; products could not be loaded.');
    showProductGridMessage('Products could not be loaded. Please try again later.', 'error');
    container.setAttribute('aria-busy', 'false');
    return;
  }

  let data;
  let error;
  try {
    ({ data, error } = await window.floraSupabase
      .from('products')
      .select('id, name, price, category, image_url, description, is_active')
      .eq('is_active', true)
      .order('created_at', { ascending: false }));
  } catch (loadError) {
    console.error('Could not load products from Supabase:', loadError);
    showProductGridMessage('Products could not be loaded. Please try again later.', 'error');
    container.setAttribute('aria-busy', 'false');
    return;
  }

  if (error) {
    console.error('Could not load products from Supabase:', error);
    showProductGridMessage('Products could not be loaded. Please try again later.', 'error');
    container.setAttribute('aria-busy', 'false');
    return;
  }

  floraProducts = (data || []).map(product => ({
    id: String(product.id),
    name: product.name || '',
    price: Number(product.price),
    category: product.category || '',
    image: product.image_url || PLACEHOLDER_IMG,
    description: product.description || '',
    badge: '',
    note: ''
  })).filter(product => product.name && Number.isFinite(product.price));

  renderProductGrid();
  container.setAttribute('aria-busy', 'false');
}

// ============================================================================
// 5. CART DRAWER & CHECKOUT MODAL HANDLERS
// ============================================================================
function openCartDrawer() {
  document.getElementById('cartSidebar')?.classList.add('open');
  document.getElementById('cartOverlay')?.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeCartDrawer() {
  document.getElementById('cartSidebar')?.classList.remove('open');
  document.getElementById('cartOverlay')?.classList.remove('active');
  document.body.style.overflow = '';
}

function getCustomerAccountUrl(authView) {
  const returnUrl = new URL(window.location.href);
  returnUrl.searchParams.set('checkout', '1');
  const accountUrl = new URL('account.html', window.location.href);
  accountUrl.searchParams.set('return', returnUrl.pathname.split('/').pop());
  accountUrl.searchParams.set('view', authView);
  return accountUrl.href;
}

async function openCheckoutModal() {
  if (cart.length === 0) {
    alert("Your basket is empty! Please add a handcrafted piece first.");
    return;
  }

  let hasCustomerSession = false;
  try {
    const { data, error } = await window.floraSupabase.auth.getSession();
    if (error) throw error;
    hasCustomerSession = Boolean(data.session);
  } catch (error) {
    console.error('Could not verify customer sign-in before checkout:', error);
    alert('We could not verify your account sign-in. Please refresh the page and try again.');
    return;
  }

  // Close drawer, open modal
  closeCartDrawer();

  const modal = document.getElementById('checkoutModal');
  const authGate = document.getElementById('checkoutAuthGate');
  const preview = document.getElementById('checkoutItemsPreview');
  const payable = document.getElementById('checkoutPayableAmount');
  const formSection = document.getElementById('checkoutFormSection');
  const confirmScreen = document.getElementById('checkoutConfirmationScreen');

  if (authGate) authGate.hidden = hasCustomerSession;
  const signInLink = document.getElementById('checkoutSignInLink');
  const createAccountLink = document.getElementById('checkoutCreateAccountLink');
  if (signInLink) signInLink.href = getCustomerAccountUrl('login');
  if (createAccountLink) createAccountLink.href = getCustomerAccountUrl('register');

  // Reset screen states
  if (formSection) formSection.style.display = hasCustomerSession ? 'block' : 'none';
  if (confirmScreen) confirmScreen.style.display = 'none';
  clearCheckoutError();

  // Render items preview
  const { grandTotal } = calculateCartTotals();
  if (payable) payable.textContent = formatINR(grandTotal);

  if (preview) {
    preview.innerHTML = cart.map(item => `
      <div class="checkout-preview-item">
        <span>${item.name} &times; ${item.quantity}</span>
        <strong>${formatINR(item.price * item.quantity)}</strong>
      </div>
    `).join('');
  }

  if (modal) {
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    if (hasCustomerSession) {
      void prepareCheckoutForCustomer();
      requestAnimationFrame(() => {
        if (checkoutTurnstileWidgetId !== null && window.turnstile) {
          window.turnstile.reset(checkoutTurnstileWidgetId);
          checkoutCaptchaToken = '';
        } else {
          void initializeCheckoutTurnstile();
        }
      });
    }
  }
}

let checkoutSavedAddresses = [];

async function prepareCheckoutForCustomer() {
  const addressGroup = document.getElementById('savedAddressGroup');
  const addressSelect = document.getElementById('savedAddressSelect');
  const addressStatus = document.getElementById('savedAddressStatus');
  if (!addressGroup || !addressSelect || !window.floraSupabase?.auth) return;

  addressGroup.hidden = true;
  addressSelect.innerHTML = '<option value="">Choose a saved address (optional)</option>';
  checkoutSavedAddresses = [];
  if (addressStatus) addressStatus.textContent = '';

  try {
    const { data: sessionData, error: sessionError } = await window.floraSupabase.auth.getSession();
    if (sessionError) throw sessionError;
    if (!sessionData.session) return;

    const [profileResult, addressesResult] = await Promise.all([
      window.floraSupabase
        .from('customer_profiles')
        .select('full_name, phone')
        .eq('user_id', sessionData.session.user.id)
        .maybeSingle(),
      window.floraSupabase
        .from('customer_addresses')
        .select('id, label, recipient_name, phone, delivery_address, is_default')
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: false })
    ]);
    if (profileResult.error) throw profileResult.error;
    if (addressesResult.error) throw addressesResult.error;

    if (profileResult.data?.full_name && !document.getElementById('custName').value.trim()) {
      document.getElementById('custName').value = profileResult.data.full_name;
    }
    if (profileResult.data?.phone && !document.getElementById('custPhone').value.trim()) {
      document.getElementById('custPhone').value = profileResult.data.phone;
    }

    checkoutSavedAddresses = addressesResult.data || [];
    checkoutSavedAddresses.forEach(address => {
      const option = document.createElement('option');
      option.value = address.id;
      option.textContent = `${address.label}${address.is_default ? ' (Default)' : ''}`;
      addressSelect.append(option);
    });
    addressGroup.hidden = false;

    const defaultAddress = checkoutSavedAddresses.find(address => address.is_default);
    if (defaultAddress) {
      addressSelect.value = defaultAddress.id;
      applyCheckoutSavedAddress(defaultAddress);
    }
  } catch (error) {
    console.error('Could not load saved checkout details:', error);
    if (addressStatus) {
      addressStatus.textContent = 'Saved details could not be loaded. You can still enter your delivery details below.';
    }
  }
}

function applyCheckoutSavedAddress(address) {
  document.getElementById('custName').value = address.recipient_name;
  document.getElementById('custPhone').value = address.phone;
  document.getElementById('custAddress').value = address.delivery_address;
}

function closeCheckoutModal() {
  const modal = document.getElementById('checkoutModal');
  if (modal) {
    modal.classList.remove('active');
    document.body.style.overflow = '';
  }
}

/**
 * Handles checkout form submission, validation & confirmation
 */
async function handleCheckoutFormSubmit(event) {
  event.preventDefault();

  if (orderSubmissionInProgress) return;

  if (cart.length === 0) {
    alert("Your cart is empty.");
    return;
  }

  const name = document.getElementById('custName').value.trim();
  const phone = document.getElementById('custPhone').value.trim();
  const address = document.getElementById('custAddress').value.trim();
  const notes = document.getElementById('custNotes').value.trim();

  // Validate phone
  const cleanPhone = phone.replace(/\D/g, '');
  if (cleanPhone.length !== 10) {
    alert("Please enter a valid 10-digit mobile number for delivery updates.");
    return;
  }

  if (!checkoutCaptchaToken) {
    showCheckoutError('Complete the security verification before placing your order.');
    return;
  }

  if (!window.floraSupabase) {
    showCheckoutError('Order service is unavailable. Please try again later.');
    return;
  }

  const submittedCart = cart.map(item => ({
    id: String(item.id).trim(),
    name: item.name,
    price: Number(item.price),
    quantity: item.quantity
  }));
  const canonicalDetails = getCanonicalCheckoutDetails(
    name,
    phone,
    address,
    notes,
    submittedCart
  );
  const submitButton = document.getElementById('submitOrderBtn');
  const originalButtonContent = submitButton?.innerHTML;
  const form = document.getElementById('checkoutForm');
  orderSubmissionInProgress = true;
  clearCheckoutError();
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = 'Submitting order...';
  }
  form?.setAttribute('aria-busy', 'true');
  let requestFingerprint;

  try {
    const { data: sessionData, error: sessionError } = await window.floraSupabase.auth.getSession();
    if (sessionError) throw sessionError;
    const customerSession = sessionData.session;
    const customerId = customerSession?.user.id || null;
    requestFingerprint = await fingerprintCheckout(canonicalDetails, customerId);
    const idempotencyKey = getOrCreateCheckoutIdempotencyKey(requestFingerprint);
    const { data, error } = await window.floraSupabase.functions.invoke('create-order', {
      headers: customerSession
        ? { 'x-customer-access-token': customerSession.access_token }
        : {},
      body: {
        idempotency_key: idempotencyKey,
        customer_name: name,
        customer_phone: phone,
        delivery_address: address,
        customer_note: notes || null,
        items: canonicalDetails.items,
        captcha_token: checkoutCaptchaToken
      }
    });

    if (error) {
      throw new Error(await getOrderSubmissionErrorMessage(error));
    }

    if (
      !data ||
      data.ok !== true ||
      (typeof data.order_number !== 'string' && typeof data.order_number !== 'number') ||
      (typeof data.total_amount !== 'string' && typeof data.total_amount !== 'number') ||
      !Number.isFinite(Number(data.total_amount))
    ) {
      throw new Error('The order service returned an unexpected response. Please try again.');
    }

    const orderId = String(data.order_number);
    const serverTotal = Number(data.total_amount);
    const receiptCard = document.getElementById('confirmReceiptDetails');
    const greeting = document.getElementById('confirmCustomerGreeting');
    if (greeting) {
      greeting.textContent = `Thank you, ${name}! Your order #${orderId} has been registered with our Guwahati studio.`;
    }

    if (receiptCard) {
      receiptCard.innerHTML = `
        <div class="receipt-row"><span>Order ID:</span> <strong>${escapeHTML(orderId)}</strong></div>
        <div class="receipt-row"><span>Customer:</span> <strong>${escapeHTML(name)} (${escapeHTML(phone)})</strong></div>
        <div class="receipt-row"><span>Delivery Address:</span> <span>${escapeHTML(address)}</span></div>
        ${notes ? `<div class="receipt-row"><span>Special Note:</span> <span>${escapeHTML(notes)}</span></div>` : ''}
        <div class="receipt-row receipt-total"><span>Total (Excl. delivery):</span> <strong>${formatINR(serverTotal)}</strong></div>
        <div style="margin-top:0.6rem; font-size:0.8rem; color:#6B6661;">Status: Pending artisan confirmation on WhatsApp</div>
      `;
    }

    let waMsg = `Hi ${FLORA_CONFIG.brandName}! 🌸\n\nI have placed an order on your website (Order #${orderId}):\n\n`;
    submittedCart.forEach(item => {
      waMsg += `• ${item.name} x ${item.quantity} = ${formatINR(item.price * item.quantity)}\n`;
    });
    waMsg += `\n*Grand Total:* ${formatINR(serverTotal)}\n`;
    waMsg += `*Name:* ${name}\n*Phone:* ${phone}\n*Address:* ${address}\n`;
    if (notes) waMsg += `*Special Note:* ${notes}\n`;
    waMsg += `\nPlease confirm availability and payment details. Thank you!`;

    const waBtn = document.getElementById('confirmWhatsAppBtn');
    if (waBtn) waBtn.href = buildWhatsAppLink(waMsg);

    clearCheckoutIdempotencyKey(requestFingerprint);
    clearCart();
    document.getElementById('checkoutFormSection').style.display = 'none';
    document.getElementById('checkoutConfirmationScreen').style.display = 'block';
  } catch (error) {
    console.error('Could not submit order.');
    showCheckoutError(
      error instanceof Error
        ? error.message
        : 'We could not place your order. Please try again.'
    );
    checkoutCaptchaToken = '';
    if (checkoutTurnstileWidgetId !== null && window.turnstile) {
      window.turnstile.reset(checkoutTurnstileWidgetId);
    }
  } finally {
    orderSubmissionInProgress = false;
    form?.removeAttribute('aria-busy');
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.innerHTML = originalButtonContent || 'Confirm & Place Order';
    }
  }
}

// ============================================================================
// 6. WHATSAPP & CUSTOM INQUIRY HELPERS
// ============================================================================
function buildWhatsAppLink(message) {
  const cleanPhone = FLORA_CONFIG.whatsappNumber.replace(/[^0-9]/g, '');
  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
}

function orderProduct(productName, referencePrice) {
  const message = `Hi ${FLORA_CONFIG.brandName}! 🌸\n\nI'm interested in the "${productName}" (${referencePrice}).\n\nCould you please share details on availability, customization options, and delivery timeline across India?`;
  window.open(buildWhatsAppLink(message), '_blank');
}

function handleCustomSubmit(event) {
  event.preventDefault();
  const type = document.getElementById('orderType').value;
  const occasion = document.getElementById('orderOccasion').value;
  const color = document.getElementById('orderColor').value;
  const budget = document.getElementById('orderBudget').value;
  const notes = document.getElementById('orderNotes').value.trim();

  let message = `Hi ${FLORA_CONFIG.brandName}! 🌸\n\nI would like to inquire about a custom handcrafted order:\n` +
    `• Style: ${type}\n` +
    `• Occasion: ${occasion}\n` +
    `• Color Palette: ${color}\n` +
    `• Estimated Budget: ${budget}\n`;

  if (notes) message += `• Special Notes: ${notes}\n`;
  message += `\nI would love to know the next steps for creating this for delivery across India!`;

  window.open(buildWhatsAppLink(message), '_blank');
}

// ============================================================================
// 7. TOAST & MICRO-INTERACTIONS
// ============================================================================
let toastTimeout;
function showToast(text) {
  const toast = document.getElementById('cartToast');
  const msg = document.getElementById('toastMessage');
  if (!toast || !msg) return;

  msg.textContent = text;
  toast.classList.add('show');

  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.remove('show');
  }, 2600);
}

function animateBadge() {
  const badge = document.getElementById('cartBadge');
  if (!badge) return;
  badge.classList.remove('bump');
  void badge.offsetWidth; // Force reflow
  badge.classList.add('bump');
  setTimeout(() => badge.classList.remove('bump'), 250);
}

// ============================================================================
// 8. EVENT LISTENERS SETUP
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
  // Load persistent cart
  loadCart();

  // Footer Year
  const yearSpan = document.getElementById('currentYear');
  if (yearSpan) yearSpan.textContent = new Date().getFullYear();

  // WhatsApp Static CTAs
  const defaultInquiry = `Hi ${FLORA_CONFIG.brandName}! 🌸 I'm visiting your website and would love to know more about your handcrafted bouquets & floral lamps.`;
  const defaultUrl = buildWhatsAppLink(defaultInquiry);

  ['heroWhatsappBtn', 'directWhatsappBtn', 'footerWhatsappLink', 'floatingWhatsappBtn'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.href = defaultUrl;
  });

  // Mobile Menu Toggle
  const menuToggle = document.getElementById('menuToggle');
  const navLinks = document.getElementById('navLinks');
  if (menuToggle && navLinks) {
    menuToggle.addEventListener('click', () => {
      const isOpen = navLinks.classList.toggle('open');
      menuToggle.setAttribute('aria-expanded', String(isOpen));
      const icon = menuToggle.querySelector('i');
      if (icon) {
        icon.classList.toggle('fa-bars');
        icon.classList.toggle('fa-times');
      }
    });

    navLinks.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        navLinks.classList.remove('open');
        menuToggle.setAttribute('aria-expanded', 'false');
        const icon = menuToggle.querySelector('i');
        if (icon) {
          icon.classList.remove('fa-times');
          icon.classList.add('fa-bars');
        }
      });
    });
  }

  // Cart Drawer open/close triggers
  document.getElementById('openCartBtn')?.addEventListener('click', openCartDrawer);
  document.getElementById('closeCartBtn')?.addEventListener('click', closeCartDrawer);
  document.getElementById('cartOverlay')?.addEventListener('click', closeCartDrawer);
  document.getElementById('checkoutBtn')?.addEventListener('click', openCheckoutModal);
  document.getElementById('closeCheckoutBtn')?.addEventListener('click', closeCheckoutModal);
  document.getElementById('savedAddressSelect')?.addEventListener('change', event => {
    const address = checkoutSavedAddresses.find(item => item.id === event.target.value);
    if (address) applyCheckoutSavedAddress(address);
  });

  // Close modals on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeCartDrawer();
      closeCheckoutModal();
      closeLightbox();
    }
  });

  // Collection Filter Tabs
  const filterBtns = document.querySelectorAll('.filter-btn');
  const productGrid = document.getElementById('productGrid');

  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const filterValue = btn.getAttribute('data-filter');
      activeProductFilter = filterValue;
      visibleProductCount = PRODUCTS_PER_PAGE;
      if (productGrid?.getAttribute('aria-busy') !== 'true') {
        renderProductGrid(filterValue);
      }
    });
  });

  document.getElementById('loadMoreProductsBtn')?.addEventListener('click', () => {
    visibleProductCount += PRODUCTS_PER_PAGE;
    renderProductGrid();
  });

  if (new URLSearchParams(window.location.search).get('checkout') === '1') {
    const returnUrl = new URL(window.location.href);
    returnUrl.searchParams.delete('checkout');
    window.history.replaceState(null, '', returnUrl.href);
    void openCheckoutModal();
  }

  productGrid?.addEventListener('click', event => {
    const button = event.target.closest('[data-add-product], [data-order-product]');
    if (!button) return;

    const productId = button.dataset.addProduct || button.dataset.orderProduct;
    const product = floraProducts.find(item => item.id === productId);
    if (!product) return;

    if (button.dataset.addProduct) {
      addToCart(product);
    } else {
      orderProduct(product.name, formatINR(product.price));
    }
  });

  void loadProducts();
});

// Lightbox Modal
function openLightbox(imageUrl, caption) {
  const modal = document.getElementById('lightboxModal');
  const img = document.getElementById('lightboxImg');
  const cap = document.getElementById('lightboxCaption');
  if (modal && img && cap) {
    img.src = imageUrl;
    cap.textContent = caption || '';
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }
}

function closeLightbox() {
  const modal = document.getElementById('lightboxModal');
  if (modal) {
    modal.classList.remove('active');
    document.body.style.overflow = '';
  }
}