// Set this to the owner's Supabase Auth user ID. Database RLS remains the
// security boundary; this also keeps other signed-iecaa7366n users out of the UI.
const FLORA_ADMIN_USER_ID = "ecaa7366-e7a3-4d0c-b3bb-859403379f2b";
const FLORA_PRODUCT_BUCKET = "flora-products";
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const ORDERS_PER_PAGE = 10;
const ORDER_STATUSES = [
  { value: "pending_confirmation", label: "Pending confirmation" },
  { value: "processing", label: "Processing" },
  { value: "shipped", label: "Shipped" },
  { value: "delivered", label: "Delivered" },
  { value: "cancelled", label: "Cancelled" }
];
const LEGACY_ORDER_STATUSES = {
  pending: "pending_confirmation",
  confirmed: "processing",
  fulfilled: "delivered"
};

let adminProducts = [];
let adminOrders = [];
let currentOrderPage = 0;
let totalAdminOrderCount = 0;
let currentImageUrl = "";

const loginPanel = document.getElementById("loginPanel");
const dashboardPanel = document.getElementById("dashboardPanel");
const loginStatus = document.getElementById("loginStatus");
const dashboardStatus = document.getElementById("dashboardStatus");
const productForm = document.getElementById("productForm");
const productList = document.getElementById("adminProductList");
const imageInput = document.getElementById("productImage");
const imagePreview = document.getElementById("imagePreview");
const orderList = document.getElementById("adminOrderList");
const ordersStatus = document.getElementById("ordersStatus");
const orderPageSummaries = document.querySelectorAll(".order-page-summary");
const previousOrdersButtons = document.querySelectorAll("[data-previous-orders]");
const nextOrdersButtons = document.querySelectorAll("[data-next-orders]");
const adminTabs = [...document.querySelectorAll("[data-admin-tab]")];

function activateAdminTab(tab, moveFocus = false) {
  const panel = document.getElementById(tab.getAttribute("aria-controls"));
  if (!panel) {
    console.error(`Admin tab panel not found for "${tab.dataset.adminTab}".`);
    return;
  }

  adminTabs.forEach(item => {
    const isSelected = item === tab;
    item.setAttribute("aria-selected", String(isSelected));
    item.tabIndex = isSelected ? 0 : -1;
    const controlledPanel = document.getElementById(item.getAttribute("aria-controls"));
    if (controlledPanel) controlledPanel.hidden = !isSelected;
  });

  if (moveFocus) tab.focus();
}

adminTabs.forEach((tab, index) => {
  tab.addEventListener("click", () => activateAdminTab(tab));
  tab.addEventListener("keydown", event => {
    let nextIndex;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % adminTabs.length;
    else if (event.key === "ArrowLeft") nextIndex = (index - 1 + adminTabs.length) % adminTabs.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = adminTabs.length - 1;
    else return;

    event.preventDefault();
    activateAdminTab(adminTabs[nextIndex], true);
  });
});
const initiallySelectedTab = adminTabs.find(tab => tab.getAttribute("aria-selected") === "true");
if (initiallySelectedTab) activateAdminTab(initiallySelectedTab);

function setStatus(element, message, state = "error") {
  element.textContent = message;
  element.dataset.state = state;
}

function escapeAdminHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function categoryLabel(category) {
  return category === "lamps" ? "Floral Lamps"
    : category === "bouquets" ? "Bouquets"
      : "Custom Arrangements";
}

function formatPrice(price) {
  return `₹${Number(price).toLocaleString("en-IN")}`;
}

function formatOrderDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Date unavailable"
    : date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function canonicalOrderStatus(status) {
  return LEGACY_ORDER_STATUSES[status] || status;
}

function orderStatusLabel(status) {
  return ORDER_STATUSES.find(item => item.value === canonicalOrderStatus(status))?.label || status;
}

function renderAdminOrders() {
  orderList.setAttribute("aria-busy", "false");
  const firstOrderNumber = totalAdminOrderCount === 0
    ? 0
    : currentOrderPage * ORDERS_PER_PAGE + 1;
  const lastOrderNumber = Math.min(
    (currentOrderPage + 1) * ORDERS_PER_PAGE,
    totalAdminOrderCount
  );
  orderPageSummaries.forEach(summary => {
    summary.textContent =
      `Showing ${firstOrderNumber}–${lastOrderNumber} of ${totalAdminOrderCount} orders`;
  });
  previousOrdersButtons.forEach(button => {
    button.disabled = currentOrderPage === 0;
  });
  nextOrdersButtons.forEach(button => {
    button.disabled = lastOrderNumber >= totalAdminOrderCount;
  });

  if (adminOrders.length === 0) {
    orderList.innerHTML = '<p class="admin-help">No orders received yet.</p>';
    return;
  }

  orderList.innerHTML = adminOrders.map(order => `
    <article class="admin-order-card">
      <div class="admin-order-header">
        <div>
          <h3>Order #${escapeAdminHTML(order.order_number)}</h3>
          <p class="admin-order-date">${escapeAdminHTML(formatOrderDate(order.created_at))}</p>
          <p class="admin-order-current-status">Status: <strong>${escapeAdminHTML(orderStatusLabel(order.status))}</strong></p>
        </div>
        <strong class="admin-order-total">${formatPrice(order.total_amount)}</strong>
      </div>
      <div class="admin-order-customer">
        <p><strong>${escapeAdminHTML(order.customer_name)}</strong> · <a href="tel:${escapeAdminHTML(order.customer_phone)}">${escapeAdminHTML(order.customer_phone)}</a></p>
        <p>${escapeAdminHTML(order.delivery_address)}</p>
        ${order.customer_note ? `<p><strong>Note:</strong> ${escapeAdminHTML(order.customer_note)}</p>` : ""}
      </div>
      <ul class="admin-order-items">
        ${(order.items || []).map(item => `
          <li>
            <span>${escapeAdminHTML(item.product_name)} × ${escapeAdminHTML(item.quantity)}</span>
            <strong>${formatPrice(Number(item.unit_price) * Number(item.quantity))}</strong>
          </li>
        `).join("")}
      </ul>
      <div class="admin-order-status">
        <label for="order-status-${escapeAdminHTML(order.id)}">Status</label>
        <select id="order-status-${escapeAdminHTML(order.id)}" data-order-status="${escapeAdminHTML(order.id)}">
          ${ORDER_STATUSES.map(status => `
            <option value="${status.value}" ${canonicalOrderStatus(order.status) === status.value ? "selected" : ""}>${status.label}</option>
          `).join("")}
        </select>
        <button class="btn btn-secondary" type="button" data-save-order-details="${escapeAdminHTML(order.id)}">Save order details</button>
        <button class="btn btn-secondary" type="button" data-send-status-update="${escapeAdminHTML(order.id)}">Prepare WhatsApp update</button>
      </div>
      <div class="admin-order-status">
        <label for="payment-method-${escapeAdminHTML(order.id)}">Payment method</label>
        <select id="payment-method-${escapeAdminHTML(order.id)}" data-payment-method="${escapeAdminHTML(order.id)}">
          <option value="UPI">UPI</option>
          <option value="Bank Transfer">Bank Transfer</option>
        </select>
        <button class="btn btn-secondary" type="button" data-send-payment-request="${escapeAdminHTML(order.id)}">Prepare payment message</button>
      </div>
    </article>
  `).join("");
}

function preparePaymentMessage(orderId) {
  const order = adminOrders.find(item => String(item.id) === orderId);
  const methodSelect = orderList.querySelector(`[data-payment-method="${CSS.escape(orderId)}"]`);
  if (!order || !methodSelect) return;

  const phone = String(order.customer_phone).replace(/\D/g, "");
  const whatsappPhone = phone.length === 10 ? `91${phone}` : phone;
  if (!/^\d{11,15}$/.test(whatsappPhone)) {
    setStatus(ordersStatus, `Could not prepare payment message for order #${order.order_number}: the customer phone number is invalid.`);
    return;
  }

  const message = [
    "🌸 *Flora by Kriti*",
    "",
    "Your order is almost confirmed!",
    "",
    "Please complete your payment to proceed with your order.",
    "",
    `💰 *Order Amount:* ${formatPrice(order.total_amount)}`,
    `💳 *Payment Method:* ${methodSelect.value}`,
    "",
    "Once the payment is completed, please share the payment screenshot with us.",
    "",
    "Thank you for shopping with Flora by Kriti! 💐"
  ].join("\n");
  const whatsappUrl = `https://wa.me/${whatsappPhone}?text=${encodeURIComponent(message)}`;
  window.open(whatsappUrl, "_blank", "noopener,noreferrer");
}

function prepareOrderStatusUpdate(orderId) {
  const order = adminOrders.find(item => String(item.id) === orderId);
  const statusSelect = orderList.querySelector(`[data-order-status="${CSS.escape(orderId)}"]`);
  if (!order || !statusSelect) return;
  if (canonicalOrderStatus(order.status) !== statusSelect.value) {
    setStatus(ordersStatus, `Save order #${order.order_number}'s new status before preparing a customer update.`);
    return;
  }

  const phone = String(order.customer_phone).replace(/\D/g, "");
  const whatsappPhone = phone.length === 10 ? `91${phone}` : phone;
  if (!/^\d{11,15}$/.test(whatsappPhone)) {
    setStatus(ordersStatus, `Could not prepare status update for order #${order.order_number}: the customer phone number is invalid.`);
    return;
  }

  const trackingUrl = new URL("track-order.html", window.location.href);
  trackingUrl.searchParams.set("order", String(order.order_number));
  const message = [
    "🌸 *Flora by Kriti — Order Update*",
    "",
    `Your order #${order.order_number} is now: *${orderStatusLabel(statusSelect.value)}*`,
    "",
    `Track your order anytime: ${trackingUrl.href}`,
    "",
    "Thank you for shopping with Flora by Kriti! 💐"
  ].join("\n");
  window.open(`https://wa.me/${whatsappPhone}?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
}

async function loadAdminOrders() {
  orderList.setAttribute("aria-busy", "true");
  orderList.innerHTML = '<p class="admin-help">Loading orders…</p>';
  ordersStatus.textContent = "";
  previousOrdersButtons.forEach(button => {
    button.disabled = true;
  });
  nextOrdersButtons.forEach(button => {
    button.disabled = true;
  });

  let orders;
  let count;
  let error;
  try {
    ({ data: orders, count, error } = await window.floraSupabase
      .from("orders")
      .select("id, order_number, customer_name, customer_phone, delivery_address, customer_note, status, total_amount, created_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(
        currentOrderPage * ORDERS_PER_PAGE,
        (currentOrderPage + 1) * ORDERS_PER_PAGE - 1
      ));
  } catch (loadError) {
    orderList.setAttribute("aria-busy", "false");
    orderList.innerHTML = "";
    orderPageSummaries.forEach(summary => {
      summary.textContent = "";
    });
    console.error("Could not load orders:", loadError);
    setStatus(ordersStatus, `Could not load orders: ${loadError.message || "Network error."}`);
    return;
  }

  if (error) {
    orderList.setAttribute("aria-busy", "false");
    orderList.innerHTML = "";
    orderPageSummaries.forEach(summary => {
      summary.textContent = "";
    });
    setStatus(ordersStatus, `Could not load orders: ${error.message}`);
    return;
  }

  adminOrders = orders || [];
  totalAdminOrderCount = count || 0;
  const lastPage = Math.max(0, Math.ceil(totalAdminOrderCount / ORDERS_PER_PAGE) - 1);
  if (currentOrderPage > lastPage) {
    currentOrderPage = lastPage;
    await loadAdminOrders();
    return;
  }
  if (adminOrders.length === 0) {
    renderAdminOrders();
    return;
  }

  try {
    const { data: items, error: itemsError } = await window.floraSupabase
      .from("order_items")
      .select("order_id, product_name, quantity, unit_price")
      .in("order_id", adminOrders.map(order => order.id));
    if (itemsError) throw itemsError;

    const itemsByOrder = new Map();
    for (const item of items || []) {
      const orderItems = itemsByOrder.get(item.order_id) || [];
      orderItems.push(item);
      itemsByOrder.set(item.order_id, orderItems);
    }
    adminOrders = adminOrders.map(order => ({
      ...order,
      items: itemsByOrder.get(order.id) || []
    }));
  } catch (itemsError) {
    orderList.setAttribute("aria-busy", "false");
    orderList.innerHTML = "";
    orderPageSummaries.forEach(summary => {
      summary.textContent = "";
    });
    previousOrdersButtons.forEach(button => {
      button.disabled = currentOrderPage === 0;
    });
    nextOrdersButtons.forEach(button => {
      button.disabled =
        (currentOrderPage + 1) * ORDERS_PER_PAGE >= totalAdminOrderCount;
    });
    console.error("Could not load order items:", itemsError);
    setStatus(ordersStatus, `Orders loaded, but their items could not be loaded: ${itemsError.message || "Unexpected error."}`);
    return;
  }

  renderAdminOrders();
}

async function saveOrderDetails(orderId) {
  const order = adminOrders.find(item => String(item.id) === orderId);
  const select = orderList.querySelector(`[data-order-status="${CSS.escape(orderId)}"]`);
  const button = orderList.querySelector(`[data-save-order-details="${CSS.escape(orderId)}"]`);
  if (!order || !select || !button) return;

  button.disabled = true;
  ordersStatus.textContent = "";
  try {
    const status = select.value;
    const { data, error } = await window.floraSupabase
      .from("orders")
      .update({ status })
      .eq("id", order.id)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      throw new Error("No order was updated. Check owner access and database policies.");
    }

    setStatus(ordersStatus, `Order details saved for order #${order.order_number}.`, "success");
    await loadAdminOrders();
  } catch (error) {
    console.error("Could not save order details:", error);
    setStatus(ordersStatus, `Could not save order details: ${error.message || "Unexpected error."}`);
  } finally {
    button.disabled = false;
  }
}

function setSignedInView(isSignedIn) {
  loginPanel.hidden = isSignedIn;
  dashboardPanel.hidden = !isSignedIn;
}

function resetProductForm() {
  productForm.reset();
  document.getElementById("productId").value = "";
  document.getElementById("productActive").checked = true;
  document.getElementById("formTitle").textContent = "Add a product";
  document.getElementById("saveProductBtn").textContent = "Save product";
  document.getElementById("cancelEditBtn").hidden = true;
  imageInput.required = true;
  currentImageUrl = "";
  if (imagePreview.dataset.objectUrl) {
    URL.revokeObjectURL(imagePreview.dataset.objectUrl);
    delete imagePreview.dataset.objectUrl;
  }
  imagePreview.removeAttribute("src");
  imagePreview.hidden = true;
}

function renderAdminProducts() {
  productList.setAttribute("aria-busy", "false");
  if (adminProducts.length === 0) {
    productList.innerHTML = '<p class="admin-help">No products found. Add your first product above.</p>';
    return;
  }

  productList.innerHTML = adminProducts.map(product => `
    <article class="admin-product-row">
      <img src="${escapeAdminHTML(product.image_url || "")}" alt="" onerror="this.style.visibility='hidden'">
      <div>
        <h3>${escapeAdminHTML(product.name)}</h3>
        <p>${escapeAdminHTML(categoryLabel(product.category))} · ${formatPrice(product.price)} · ${product.is_active ? "Visible" : "Hidden"}</p>
      </div>
      <div class="admin-row-actions">
        <button type="button" class="btn btn-secondary" data-edit-product="${escapeAdminHTML(product.id)}">Edit</button>
        <button type="button" class="btn admin-delete-btn" data-delete-product="${escapeAdminHTML(product.id)}">Delete</button>
      </div>
    </article>
  `).join("");
}

async function loadAdminProducts() {
  productList.setAttribute("aria-busy", "true");
  productList.innerHTML = '<p class="admin-help">Loading products…</p>';
  let data;
  let error;
  try {
    ({ data, error } = await window.floraSupabase
      .from("products")
      .select("id, name, price, category, image_url, description, is_active, created_at")
      .order("created_at", { ascending: false }));
  } catch (loadError) {
    productList.setAttribute("aria-busy", "false");
    productList.innerHTML = "";
    console.error("Could not load products:", loadError);
    setStatus(dashboardStatus, `Could not load products: ${loadError.message || "Network error."}`);
    return;
  }

  if (error) {
    productList.setAttribute("aria-busy", "false");
    productList.innerHTML = "";
    setStatus(dashboardStatus, `Could not load products: ${error.message}`);
    return;
  }

  adminProducts = data || [];
  renderAdminProducts();
}

function beginProductEdit(product) {
  document.getElementById("productId").value = product.id;
  document.getElementById("productName").value = product.name;
  document.getElementById("productPrice").value = product.price;
  document.getElementById("productCategory").value = product.category;
  document.getElementById("productDescription").value = product.description || "";
  document.getElementById("productActive").checked = product.is_active;
  currentImageUrl = product.image_url || "";
  imagePreview.src = currentImageUrl;
  imagePreview.hidden = !currentImageUrl;
  imageInput.required = false;
  document.getElementById("formTitle").textContent = "Edit product";
  document.getElementById("saveProductBtn").textContent = "Save changes";
  document.getElementById("cancelEditBtn").hidden = false;
  document.getElementById("productName").focus();
}

async function uploadProductImage(file) {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    throw new Error("Choose a JPEG, PNG, or WebP image.");
  }
  if (file.size > MAX_IMAGE_SIZE) {
    throw new Error("Image must be 5 MB or smaller.");
  }

  const extension = file.type === "image/jpeg" ? "jpg" : file.type.split("/")[1];
  const objectPath = `${crypto.randomUUID()}.${extension}`;
  const { error } = await window.floraSupabase.storage
    .from(FLORA_PRODUCT_BUCKET)
    .upload(objectPath, file, { contentType: file.type, upsert: false });

  if (error) throw error;

  const { data } = window.floraSupabase.storage
    .from(FLORA_PRODUCT_BUCKET)
    .getPublicUrl(objectPath);
  return data.publicUrl;
}

async function handleProductSave(event) {
  event.preventDefault();
  const saveButton = document.getElementById("saveProductBtn");
  saveButton.disabled = true;
  dashboardStatus.textContent = "";

  let uploadedImageUrl = "";
  try {
    const file = imageInput.files[0];
    const imageUrl = file ? await uploadProductImage(file) : currentImageUrl;
    if (file) uploadedImageUrl = imageUrl;
    const product = {
      name: document.getElementById("productName").value.trim(),
      price: Number(document.getElementById("productPrice").value),
      category: document.getElementById("productCategory").value,
      description: document.getElementById("productDescription").value.trim(),
      image_url: imageUrl,
      is_active: document.getElementById("productActive").checked
    };

    if (!product.name || !Number.isFinite(product.price) || product.price <= 0) {
      throw new Error("Enter a product name and a price greater than zero.");
    }

    const productId = document.getElementById("productId").value;
    const previousImageUrl = currentImageUrl;
    const result = productId
      ? await window.floraSupabase.from("products").update(product).eq("id", productId).select("id").single()
      : await window.floraSupabase.from("products").insert(product).select("id").single();

    if (result.error) throw result.error;

    uploadedImageUrl = "";
    resetProductForm();
    setStatus(dashboardStatus, productId ? "Product updated." : "Product added.", "success");
    if (productId && file && previousImageUrl) {
      await deleteUploadedImage(previousImageUrl);
    }
    await Promise.all([loadAdminProducts(), loadAdminOrders()]);
  } catch (error) {
    console.error("Could not save product:", error);
    setStatus(dashboardStatus, `Could not save product: ${error.message || "Unexpected error."}`);
    if (uploadedImageUrl) {
      await deleteUploadedImage(uploadedImageUrl);
    }
  } finally {
    saveButton.disabled = false;
  }
}

async function deleteProduct(productId) {
  const product = adminProducts.find(item => String(item.id) === productId);
  if (!product || !window.confirm(`Delete "${product.name}"? This cannot be undone.`)) return;

  dashboardStatus.textContent = "";
  const { data, error } = await window.floraSupabase
    .from("products")
    .delete()
    .eq("id", product.id)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("Could not delete product:", error);
    setStatus(dashboardStatus, `Could not delete product: ${error.message}`);
    return;
  }
  if (!data) {
    setStatus(dashboardStatus, "Could not delete product: no matching product was deleted. Check owner access and database policies.");
    return;
  }

  setStatus(dashboardStatus, "Product deleted.", "success");
  await deleteUploadedImage(product.image_url);
  await loadAdminProducts();
}

async function getUploadedImagePath(imageUrl) {
  if (!imageUrl) return null;
  const marker = `/storage/v1/object/public/${FLORA_PRODUCT_BUCKET}/`;
  const markerIndex = imageUrl.indexOf(marker);
  return markerIndex === -1
    ? null
    : decodeURIComponent(imageUrl.slice(markerIndex + marker.length));
}

async function deleteUploadedImage(imageUrl) {
  const path = await getUploadedImagePath(imageUrl);
  if (!path) return;

  const { error } = await window.floraSupabase.storage
    .from(FLORA_PRODUCT_BUCKET)
    .remove([path]);
  if (error) {
    console.error("Could not remove a product image from storage:", error);
    setStatus(dashboardStatus, `The product image could not be removed from storage: ${error.message}`);
  }
}

async function showDashboard(user) {
  setSignedInView(true);

  if (!FLORA_ADMIN_USER_ID) {
    setStatus(
      dashboardStatus,
      `Sign-in worked, but the owner ID is not configured. Set FLORA_ADMIN_USER_ID in admin.js to this account's Auth user ID (${user.id}), then apply the SQL setup.`
    );
    productList.innerHTML = '<p class="admin-help">Product management is locked until the owner ID and database policies are configured.</p>';
    return;
  }

  if (user.id !== FLORA_ADMIN_USER_ID) {
    await window.floraSupabase.auth.signOut();
    setSignedInView(false);
    setStatus(loginStatus, "This account is not authorized as the product owner.");
    return;
  }

  await loadAdminProducts();
}

async function initializeAdmin() {
  if (!window.floraSupabase) {
    setStatus(loginStatus, "Supabase is not configured. Check supabase.js.");
    document.getElementById("loginForm").querySelectorAll("input, button").forEach(control => {
      control.disabled = true;
    });
    return;
  }

  const { data, error } = await window.floraSupabase.auth.getSession();
  if (error) {
    setStatus(loginStatus, `Could not check sign-in status: ${error.message}`);
    return;
  }

  if (data.session?.user) {
    await showDashboard(data.session.user);
  }

  window.floraSupabase.auth.onAuthStateChange((_event, session) => {
    if (!session?.user) {
      setSignedInView(false);
    }
  });
}

document.getElementById("loginForm").addEventListener("submit", async event => {
  event.preventDefault();
  const submitButton = event.currentTarget.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  setStatus(loginStatus, "Signing in…", "success");

  try {
    const { data, error } = await window.floraSupabase.auth.signInWithPassword({
      email: document.getElementById("loginEmail").value.trim(),
      password: document.getElementById("loginPassword").value
    });

    if (error) {
      setStatus(loginStatus, `Sign-in failed: ${error.message}`);
    } else if (data.user) {
      loginStatus.textContent = "";
      await showDashboard(data.user);
    }
  } catch (error) {
    console.error("Could not sign in:", error);
    setStatus(loginStatus, `Sign-in failed: ${error.message || "Network error."}`);
  } finally {
    submitButton.disabled = false;
  }
});

document.getElementById("signOutBtn").addEventListener("click", async () => {
  const { error } = await window.floraSupabase.auth.signOut();
  if (error) setStatus(dashboardStatus, `Could not sign out: ${error.message}`);
});
document.getElementById("refreshProductsBtn").addEventListener("click", () => {
  dashboardStatus.textContent = "";
  void loadAdminProducts();
});
document.getElementById("refreshOrdersBtn").addEventListener("click", () => {
  void loadAdminOrders();
});
function changeOrderPage(pageChange) {
  const nextPage = currentOrderPage + pageChange;
  const lastPage = Math.max(0, Math.ceil(totalAdminOrderCount / ORDERS_PER_PAGE) - 1);
  if (nextPage < 0 || nextPage > lastPage) return;

  currentOrderPage = nextPage;
  void loadAdminOrders().then(() => {
    document.getElementById("ordersHeading").scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  });
}
previousOrdersButtons.forEach(button => {
  button.addEventListener("click", () => changeOrderPage(-1));
});
nextOrdersButtons.forEach(button => {
  button.addEventListener("click", () => changeOrderPage(1));
});
document.getElementById("cancelEditBtn").addEventListener("click", resetProductForm);
productForm.addEventListener("submit", handleProductSave);
imageInput.addEventListener("change", () => {
  const file = imageInput.files[0];
  if (!file) {
    if (imagePreview.dataset.objectUrl) {
      URL.revokeObjectURL(imagePreview.dataset.objectUrl);
      delete imagePreview.dataset.objectUrl;
    }
    imagePreview.hidden = !currentImageUrl;
    imagePreview.src = currentImageUrl;
    return;
  }

  if (imagePreview.dataset.objectUrl) {
    URL.revokeObjectURL(imagePreview.dataset.objectUrl);
  }
  imagePreview.src = URL.createObjectURL(file);
  imagePreview.dataset.objectUrl = imagePreview.src;
  imagePreview.hidden = false;
});
productList.addEventListener("click", event => {
  if (!(event.target instanceof Element)) return;
  const button = event.target.closest("[data-edit-product], [data-delete-product]");
  if (!button) return;

  if (button.dataset.editProduct) {
    const product = adminProducts.find(item => String(item.id) === button.dataset.editProduct);
    if (product) beginProductEdit(product);
  } else if (button.dataset.deleteProduct) {
    void deleteProduct(button.dataset.deleteProduct);
  }
});
orderList.addEventListener("click", event => {
  if (!(event.target instanceof Element)) return;
  const statusUpdateButton = event.target.closest("[data-send-status-update]");
  if (statusUpdateButton) {
    prepareOrderStatusUpdate(statusUpdateButton.dataset.sendStatusUpdate);
    return;
  }
  const paymentButton = event.target.closest("[data-send-payment-request]");
  if (paymentButton) {
    preparePaymentMessage(paymentButton.dataset.sendPaymentRequest);
    return;
  }
  const detailsButton = event.target.closest("[data-save-order-details]");
  if (detailsButton) {
    void saveOrderDetails(detailsButton.dataset.saveOrderDetails);
    return;
  }
});

imageInput.required = true;

void initializeAdmin();
