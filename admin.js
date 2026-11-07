// Set this to the owner's Supabase Auth user ID. Database RLS remains the
// security boundary; this also keeps other signed-iecaa7366n users out of the UI.
const FLORA_ADMIN_USER_ID = "ecaa7366-e7a3-4d0c-b3bb-859403379f2b";
const FLORA_PRODUCT_BUCKET = "flora-products";
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const ORDERS_PER_PAGE = 50;

let adminProducts = [];
let adminOrders = [];
let currentOrderPage = 0;
let totalAdminOrderCount = 0;
let currentImageUrl = "";
let communicationSettings = {
  business_whatsapp_number: "",
  upi_id: "",
  payment_instructions: ""
};

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
const orderPageSummary = document.getElementById("orderPageSummary");
const previousOrdersButton = document.getElementById("previousOrdersBtn");
const nextOrdersButton = document.getElementById("nextOrdersBtn");
const communicationSettingsForm = document.getElementById("communicationSettingsForm");
const communicationSettingsStatus = document.getElementById("communicationSettingsStatus");

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

function paymentMethodLabel(method) {
  return method === "upi" ? "UPI"
    : method === "cod" ? "Cash on Delivery"
      : "Not selected";
}

function paymentStatusLabel(status) {
  return status === "paid" ? "Paid" : "Pending";
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
  orderPageSummary.textContent =
    `Showing ${firstOrderNumber}–${lastOrderNumber} of ${totalAdminOrderCount} orders`;
  previousOrdersButton.disabled = currentOrderPage === 0;
  nextOrdersButton.disabled = lastOrderNumber >= totalAdminOrderCount;

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
        </div>
        <strong class="admin-order-total">${formatPrice(order.total_amount)}</strong>
      </div>
      <div class="admin-order-customer">
        <p><strong>${escapeAdminHTML(order.customer_name)}</strong> · <a href="tel:${escapeAdminHTML(order.customer_phone)}">${escapeAdminHTML(order.customer_phone)}</a></p>
        <p>${escapeAdminHTML(order.delivery_address)}</p>
        ${order.customer_note ? `<p><strong>Delivery / order instructions:</strong> ${escapeAdminHTML(order.customer_note)}</p>` : ""}
      </div>
      <ul class="admin-order-items">
        ${(order.items || []).map(item => `
          <li>
            <span>${escapeAdminHTML(item.product_name)} × ${escapeAdminHTML(item.quantity)}<small>${formatPrice(item.unit_price)} each</small></span>
            <strong>${formatPrice(Number(item.unit_price) * Number(item.quantity))}</strong>
          </li>
        `).join("")}
      </ul>
      <div class="admin-order-meta">
        <p><strong>Payment:</strong> ${escapeAdminHTML(paymentMethodLabel(order.payment_method))} · ${escapeAdminHTML(paymentStatusLabel(order.payment_status))}</p>
        ${order.tracking_information ? `<p><strong>Tracking:</strong> ${escapeAdminHTML(order.tracking_information)}</p>` : ""}
      </div>
      <div class="admin-order-edit-grid">
        <label>Order status
          <select data-order-status="${escapeAdminHTML(order.id)}">
            ${["pending", "pending_confirmation", "confirmed", "processing", "shipped", "delivered", "fulfilled", "cancelled"].map(status => `
              <option value="${status}" ${order.status === status ? "selected" : ""}>${status[0].toUpperCase()}${status.slice(1)}</option>
            `).join("")}
          </select>
        </label>
        <label>Payment method
          <select data-payment-method="${escapeAdminHTML(order.id)}">
            <option value="" ${!order.payment_method ? "selected" : ""}>Not selected</option>
            <option value="upi" ${order.payment_method === "upi" ? "selected" : ""}>UPI</option>
            <option value="cod" ${order.payment_method === "cod" ? "selected" : ""}>Cash on Delivery</option>
          </select>
        </label>
        <label>Payment status
          <select data-payment-status="${escapeAdminHTML(order.id)}">
            <option value="pending" ${order.payment_status !== "paid" ? "selected" : ""}>Pending</option>
            <option value="paid" ${order.payment_status === "paid" ? "selected" : ""}>Paid</option>
          </select>
        </label>
        <label class="admin-tracking-field">Tracking information
          <input type="text" maxlength="1000" data-tracking-information="${escapeAdminHTML(order.id)}" value="${escapeAdminHTML(order.tracking_information || "")}" placeholder="Optional tracking link or details">
        </label>
        <button class="btn btn-secondary" type="button" data-save-order-details="${escapeAdminHTML(order.id)}">Save order details</button>
      </div>
      <div class="admin-order-actions">
        <button class="btn btn-primary" type="button" data-order-action="message" data-order-id="${escapeAdminHTML(order.id)}" ${order.status === "cancelled" ? "disabled" : ""}>${order.payment_status === "paid" ? "WhatsApp: Order update" : "WhatsApp: Confirm & request payment"}</button>
        ${order.payment_status === "paid"
          ? `<button class="btn btn-secondary" type="button" data-order-action="payment-received" data-order-id="${escapeAdminHTML(order.id)}">WhatsApp: Payment received</button>`
          : ""}
        ${order.payment_status !== "paid" && order.status !== "cancelled"
          ? `<button class="btn btn-secondary" type="button" data-order-action="mark-paid-confirmed" data-order-id="${escapeAdminHTML(order.id)}">Mark as Paid & Confirm Order</button>`
          : ""}
        <button class="btn btn-secondary" type="button" data-order-action="copy" data-order-id="${escapeAdminHTML(order.id)}">Copy Order Details</button>
        <button class="btn btn-secondary" type="button" data-order-action="confirmed" data-order-id="${escapeAdminHTML(order.id)}" ${order.status === "confirmed" ? "disabled" : ""}>Mark as Confirmed</button>
        <button class="btn btn-secondary" type="button" data-order-action="shipped" data-order-id="${escapeAdminHTML(order.id)}" ${order.status === "shipped" ? "disabled" : ""}>Mark as Shipped</button>
        <button class="btn btn-secondary" type="button" data-order-action="delivered" data-order-id="${escapeAdminHTML(order.id)}" ${order.status === "delivered" ? "disabled" : ""}>Mark as Delivered</button>
      </div>
    </article>
  `).join("");
}

async function loadAdminOrders() {
  orderList.setAttribute("aria-busy", "true");
  orderList.innerHTML = '<p class="admin-help">Loading orders…</p>';
  ordersStatus.textContent = "";
  previousOrdersButton.disabled = true;
  nextOrdersButton.disabled = true;

  let orders;
  let count;
  let error;
  try {
    ({ data: orders, count, error } = await window.floraSupabase
      .from("orders")
      .select("id, order_number, customer_name, customer_phone, delivery_address, customer_note, status, total_amount, payment_method, payment_status, tracking_information, created_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(
        currentOrderPage * ORDERS_PER_PAGE,
        (currentOrderPage + 1) * ORDERS_PER_PAGE - 1
      ));
  } catch (loadError) {
    orderList.setAttribute("aria-busy", "false");
    orderList.innerHTML = "";
    orderPageSummary.textContent = "";
    console.error("Could not load orders:", loadError);
    setStatus(ordersStatus, `Could not load orders: ${loadError.message || "Network error."}`);
    return;
  }

  if (error) {
    orderList.setAttribute("aria-busy", "false");
    orderList.innerHTML = "";
    orderPageSummary.textContent = "";
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
    orderPageSummary.textContent = "";
    previousOrdersButton.disabled = currentOrderPage === 0;
    nextOrdersButton.disabled =
      (currentOrderPage + 1) * ORDERS_PER_PAGE >= totalAdminOrderCount;
    console.error("Could not load order items:", itemsError);
    setStatus(ordersStatus, `Orders loaded, but their items could not be loaded: ${itemsError.message || "Unexpected error."}`);
    return;
  }

  renderAdminOrders();
}

async function updateOrderStatus(order, status) {
  ordersStatus.textContent = "";
  try {
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

    setStatus(ordersStatus, `Order #${order.order_number} updated to ${status}.`, "success");
    await loadAdminOrders();
  } catch (error) {
    console.error("Could not update order status:", error);
    const message = error.code === "23514"
      ? `The database does not allow the status "${status}". Run supabase-order-status-constraint.sql in Supabase, then try again.`
      : `Could not update order status: ${error.message || "Unexpected error."}`;
    setStatus(ordersStatus, message);
  }
}

async function markOrderPaidAndConfirmed(order) {
  ordersStatus.textContent = "";
  try {
    const { data, error } = await window.floraSupabase
      .from("orders")
      .update({ payment_status: "paid", status: "confirmed" })
      .eq("id", order.id)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      throw new Error("No order was updated. Check owner access and database policies.");
    }

    setStatus(
      ordersStatus,
      `Order #${order.order_number} marked as paid and confirmed.`,
      "success"
    );
    await loadAdminOrders();
  } catch (error) {
    console.error("Could not mark order as paid and confirmed:", error);
    setStatus(
      ordersStatus,
      `Could not update payment and order status: ${error.message || "Unexpected error."}`
    );
  }
}

async function saveOrderDetails(orderId, button) {
  const order = adminOrders.find(item => String(item.id) === orderId);
  const status = orderList.querySelector(`[data-order-status="${CSS.escape(orderId)}"]`)?.value;
  const paymentMethod = orderList.querySelector(`[data-payment-method="${CSS.escape(orderId)}"]`)?.value || null;
  const paymentStatus = orderList.querySelector(`[data-payment-status="${CSS.escape(orderId)}"]`)?.value;
  const trackingInformation = orderList.querySelector(`[data-tracking-information="${CSS.escape(orderId)}"]`)?.value.trim() || null;
  if (!order || !status || !paymentStatus) return;

  button.disabled = true;
  ordersStatus.textContent = "";
  try {
    const { data, error } = await window.floraSupabase
      .from("orders")
      .update({
        status,
        payment_method: paymentMethod,
        payment_status: paymentStatus,
        tracking_information: trackingInformation
      })
      .eq("id", order.id)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("No order was updated. Check owner access and database policies.");

    setStatus(ordersStatus, `Order details saved for order #${order.order_number}.`, "success");
    await loadAdminOrders();
  } catch (error) {
    console.error("Could not save order details:", error);
    const message = error.code === "23514"
      ? `The database does not allow the selected order status. Run supabase-order-status-constraint.sql in Supabase, then try again.`
      : `Could not save order details: ${error.message || "Unexpected error."}`;
    setStatus(ordersStatus, message);
  } finally {
    button.disabled = false;
  }
}

function getCustomerWhatsAppNumber(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`;
  return digits.length >= 8 && digits.length <= 15 ? digits : "";
}

function getOrderConfirmationMessage(order) {
  if (order.payment_status === "paid") {
    const statusMessages = {
      pending: "Your payment has been received. We will confirm your order shortly.",
      confirmed: "Your payment has been received and your order is confirmed. We are preparing it now.",
      processing: "Your order is being prepared. We will share another update when it is shipped.",
      shipped: [
        "Your order has been shipped.",
        order.tracking_information ? `Tracking information: ${order.tracking_information}` : ""
      ].filter(Boolean).join("\n"),
      delivered: "Your order has been delivered. We hope you love it!",
      fulfilled: "Your order has been fulfilled. Thank you for shopping with us."
    };
    const statusMessage = statusMessages[order.status] || "Your payment has been received. We will keep you updated about your order.";
    return [
      "*Flora by Kriti*",
      "",
      `Update for order #${order.order_number}:`,
      statusMessage,
      "",
      "Thank you for choosing *Flora by Kriti*!"
    ].join("\n");
  }

  const items = order.items || [];
  const products = items.length
    ? items.map(item => `${item.product_name} × ${item.quantity}`).join(", ")
    : "Product details unavailable";
  const lines = [
    "*Flora by Kriti*",
    "",
    "Hello! Your order has been received successfully.",
    "",
    "*Order Details:*",
    `Product: ${products}`,
    `Total Amount: ${formatPrice(order.total_amount)}`,
    "",
    `Please complete the payment of *${formatPrice(order.total_amount)}* to confirm and process your order.`,
    "",
    "Once the payment is completed, kindly share the payment screenshot with us."
  ];

  if (order.payment_method === "upi") {
    if (communicationSettings.upi_id) lines.push("", `UPI ID: ${communicationSettings.upi_id}`);
    if (communicationSettings.payment_instructions) lines.push(communicationSettings.payment_instructions);
  }
  lines.push("", "Thank you for choosing *Flora by Kriti*!");
  return lines.join("\n");
}

function getPaymentReceivedMessage(order) {
  return [
    "Flora by Kriti — Payment received",
    "",
    `We’ve received your payment of ${formatPrice(order.total_amount)} for order #${order.order_number}.`,
    "",
    "Your order is now being prepared. We’ll keep you updated and let you know the delivery date.",
    "",
    "Thank you for choosing Flora by Kriti."
  ].join("\n");
}

function getOrderDetailsText(order) {
  const items = (order.items || []).map(item =>
    `${item.product_name} × ${item.quantity} — ${formatPrice(item.unit_price)} each (${formatPrice(Number(item.unit_price) * Number(item.quantity))})`
  );
  return [
    `Order #${order.order_number}`,
    `Customer: ${order.customer_name}`,
    `Phone: ${order.customer_phone}`,
    `Status: ${order.status}`,
    `Payment: ${paymentMethodLabel(order.payment_method)} (${paymentStatusLabel(order.payment_status)})`,
    `Total: ${formatPrice(order.total_amount)}`,
    "Products:",
    ...(items.length ? items : ["Product details unavailable"]),
    `Delivery address: ${order.delivery_address}`,
    order.customer_note ? `Delivery / order instructions: ${order.customer_note}` : "",
    order.tracking_information ? `Tracking information: ${order.tracking_information}` : ""
  ].filter(Boolean).join("\n");
}

function openCustomerWhatsApp(order, includeMessage) {
  const phone = getCustomerWhatsAppNumber(order.customer_phone);
  if (!phone) {
    setStatus(ordersStatus, `Order #${order.order_number} has no valid WhatsApp phone number.`);
    return;
  }
  const message = includeMessage ? `?text=${encodeURIComponent(getOrderConfirmationMessage(order))}` : "";
  window.open(`https://wa.me/${phone}${message}`, "_blank", "noopener,noreferrer");
}

async function handleOrderAction(action, orderId) {
  const order = adminOrders.find(item => String(item.id) === orderId);
  if (!order) return;

  if (action === "whatsapp") {
    openCustomerWhatsApp(order, false);
  } else if (action === "message") {
    openCustomerWhatsApp(order, true);
  } else if (action === "payment-received") {
    const phone = getCustomerWhatsAppNumber(order.customer_phone);
    if (!phone) {
      setStatus(ordersStatus, `Order #${order.order_number} has no valid WhatsApp phone number.`);
      return;
    }
    window.open(
      `https://wa.me/${phone}?text=${encodeURIComponent(getPaymentReceivedMessage(order))}`,
      "_blank",
      "noopener,noreferrer"
    );
  } else if (action === "mark-paid-confirmed") {
    await markOrderPaidAndConfirmed(order);
  } else if (action === "copy") {
    try {
      await navigator.clipboard.writeText(getOrderDetailsText(order));
      setStatus(ordersStatus, `Order #${order.order_number} details copied.`, "success");
    } catch (error) {
      console.error("Could not copy order details:", error);
      setStatus(ordersStatus, "Could not copy order details. Check clipboard permissions and try again.");
    }
  } else if (["confirmed", "shipped", "delivered"].includes(action)) {
    await updateOrderStatus(order, action);
  }
}

async function loadCommunicationSettings() {
  communicationSettingsStatus.textContent = "";
  try {
    const { data, error } = await window.floraSupabase
      .from("shop_whatsapp_settings")
      .select("business_whatsapp_number, upi_id, payment_instructions")
      .eq("id", true)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("Settings row is missing. Run supabase-whatsapp-order-communication.sql in Supabase.");

    communicationSettings = data;
    document.getElementById("businessWhatsappNumber").value = data.business_whatsapp_number || "";
    document.getElementById("businessUpiId").value = data.upi_id || "";
    document.getElementById("businessPaymentInstructions").value = data.payment_instructions || "";
  } catch (error) {
    console.error("Could not load WhatsApp settings:", error);
    setStatus(
      communicationSettingsStatus,
      `Could not load WhatsApp settings: ${error.message || "Unexpected error."} Check that the dashboard migration has been applied.`
    );
  }
}

async function saveCommunicationSettings(event) {
  event.preventDefault();
  const button = document.getElementById("saveCommunicationSettingsBtn");
  const businessWhatsappNumber = document.getElementById("businessWhatsappNumber").value.trim();
  const upiId = document.getElementById("businessUpiId").value.trim();
  const paymentInstructions = document.getElementById("businessPaymentInstructions").value.trim();

  if (businessWhatsappNumber && !/^[0-9]{8,15}$/.test(businessWhatsappNumber)) {
    setStatus(communicationSettingsStatus, "Enter the business WhatsApp number in international format using 8–15 digits, without + or spaces.");
    return;
  }

  button.disabled = true;
  communicationSettingsStatus.textContent = "";
  try {
    const settings = {
      id: true,
      business_whatsapp_number: businessWhatsappNumber,
      upi_id: upiId,
      payment_instructions: paymentInstructions
    };
    const { error } = await window.floraSupabase
      .from("shop_whatsapp_settings")
      .upsert(settings, { onConflict: "id" });
    if (error) throw error;

    communicationSettings = settings;
    setStatus(communicationSettingsStatus, "WhatsApp and payment settings saved.", "success");
  } catch (error) {
    console.error("Could not save WhatsApp settings:", error);
    setStatus(communicationSettingsStatus, `Could not save settings: ${error.message || "Unexpected error."}`);
  } finally {
    button.disabled = false;
  }
}

function setSignedInView(isSignedIn) {
  loginPanel.hidden = isSignedIn;
  dashboardPanel.hidden = !isSignedIn;
}

function showAdminTab(name, focusTab = false) {
  const tabs = [...document.querySelectorAll("[data-admin-tab]")];
  const selectedTab = tabs.find(tab => tab.dataset.adminTab === name);
  if (!selectedTab) return;

  tabs.forEach(tab => {
    const isSelected = tab === selectedTab;
    tab.setAttribute("aria-selected", String(isSelected));
    tab.tabIndex = isSelected ? 0 : -1;
    document.getElementById(tab.getAttribute("aria-controls")).hidden = !isSelected;
  });

  if (focusTab) selectedTab.focus();
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
  await Promise.all([
    loadAdminProducts(),
    loadAdminOrders(),
    loadCommunicationSettings()
  ]);
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

  await Promise.all([
    loadAdminProducts(),
    loadAdminOrders(),
    loadCommunicationSettings()
  ]);
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
document.querySelector(".admin-tabs").addEventListener("click", event => {
  if (!(event.target instanceof Element)) return;
  const tab = event.target.closest("[data-admin-tab]");
  if (tab) showAdminTab(tab.dataset.adminTab);
});
document.querySelector(".admin-tabs").addEventListener("keydown", event => {
  if (!(event.target instanceof Element) || !event.target.matches("[data-admin-tab]")) return;
  const tabs = [...document.querySelectorAll("[data-admin-tab]")];
  const currentIndex = tabs.indexOf(event.target);
  const nextIndex = event.key === "ArrowRight"
    ? (currentIndex + 1) % tabs.length
    : event.key === "ArrowLeft"
      ? (currentIndex - 1 + tabs.length) % tabs.length
      : event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : -1;
  if (nextIndex < 0) return;
  event.preventDefault();
  showAdminTab(tabs[nextIndex].dataset.adminTab, true);
});
document.getElementById("refreshProductsBtn").addEventListener("click", () => {
  dashboardStatus.textContent = "";
  void loadAdminProducts();
});
document.getElementById("refreshOrdersBtn").addEventListener("click", () => {
  void loadAdminOrders();
});
previousOrdersButton.addEventListener("click", () => {
  if (currentOrderPage === 0) return;
  currentOrderPage -= 1;
  void loadAdminOrders();
});
nextOrdersButton.addEventListener("click", () => {
  if ((currentOrderPage + 1) * ORDERS_PER_PAGE >= totalAdminOrderCount) return;
  currentOrderPage += 1;
  void loadAdminOrders();
});
document.getElementById("cancelEditBtn").addEventListener("click", resetProductForm);
productForm.addEventListener("submit", handleProductSave);
communicationSettingsForm.addEventListener("submit", saveCommunicationSettings);
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
    if (product) {
      showAdminTab("products");
      beginProductEdit(product);
    }
  } else if (button.dataset.deleteProduct) {
    void deleteProduct(button.dataset.deleteProduct);
  }
});
orderList.addEventListener("click", event => {
  if (!(event.target instanceof Element)) return;
  const actionButton = event.target.closest("[data-order-action]");
  if (actionButton) {
    void handleOrderAction(actionButton.dataset.orderAction, actionButton.dataset.orderId);
    return;
  }

  const detailsButton = event.target.closest("[data-save-order-details]");
  if (detailsButton) {
    void saveOrderDetails(detailsButton.dataset.saveOrderDetails, detailsButton);
    return;
  }

});

imageInput.required = true;

void initializeAdmin();
