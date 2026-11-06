const accountMessage = document.getElementById('accountMessage');
const accountAuth = document.getElementById('accountAuth');
const accountDashboard = document.getElementById('accountDashboard');
const accountOrders = [];
let currentUser = null;
let profileData = null;
let addressData = [];
let orderItemsByOrder = new Map();

function getCheckoutReturnUrl() {
  const returnPage = new URLSearchParams(window.location.search).get('return');
  if (!['index.html', 'products.html'].includes(returnPage)) return null;
  const returnUrl = new URL(returnPage, window.location.href);
  returnUrl.searchParams.set('checkout', '1');
  return returnUrl.href;
}

function getAccountAuthRedirectUrl() {
  const redirectUrl = new URL('account.html', window.location.href);
  const params = new URLSearchParams(window.location.search);
  for (const key of ['return', 'view']) {
    const value = params.get(key);
    if (value) redirectUrl.searchParams.set(key, value);
  }
  return redirectUrl.href;
}

function returnToCheckoutAfterAuth() {
  const checkoutUrl = getCheckoutReturnUrl();
  if (checkoutUrl) window.location.assign(checkoutUrl);
}

function showAccountMessage(message, type = 'info') {
  accountMessage.textContent = message;
  accountMessage.dataset.type = type;
}

function clearAccountMessage() {
  accountMessage.textContent = '';
  delete accountMessage.dataset.type;
}

function escapeAccountHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function formatAccountPrice(value) {
  return `₹${Number(value).toLocaleString('en-IN')}`;
}

function formatAccountDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Date unavailable'
    : new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function statusLabel(status) {
  return String(status || '')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, character => character.toUpperCase());
}

function showAuth(view = 'login') {
  currentUser = null;
  accountDashboard.hidden = true;
  accountAuth.hidden = false;
  document.querySelectorAll('[data-auth-view]').forEach(button => {
    const active = button.dataset.authView === view;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('[data-auth-panel]').forEach(panel => {
    panel.hidden = panel.dataset.authPanel !== view;
  });
}

function showPasswordRecovery() {
  showAuth('reset');
  document.getElementById('resetForm').hidden = true;
  document.getElementById('newPasswordForm').hidden = false;
}

function showDashboard(user) {
  currentUser = user;
  accountAuth.hidden = true;
  accountDashboard.hidden = false;
  setAccountView('overview');
  void loadCustomerData();
}

function setAccountView(view) {
  document.querySelectorAll('[data-account-view]').forEach(button => {
    const active = button.dataset.accountView === view;
    button.classList.toggle('active', active);
    button.setAttribute('aria-current', active ? 'page' : 'false');
  });
  document.querySelectorAll('[data-account-panel]').forEach(panel => {
    panel.hidden = panel.dataset.accountPanel !== view;
  });
}

function accountSetupError(error) {
  console.error('Could not load customer account data:', error);
  showAccountMessage(
    'Your account is signed in, but customer account data could not be loaded. Confirm that supabase-customer-accounts.sql has been run in Supabase.',
    'error'
  );
}

async function loadCustomerData() {
  if (!currentUser) return;
  const requestedUserId = currentUser.id;
  profileData = { full_name: '', phone: '' };
  addressData = [];
  accountOrders.splice(0, accountOrders.length);
  orderItemsByOrder = new Map();
  renderAccountData();
  clearAccountMessage();

  try {
    const [profileResult, addressesResult, ordersResult] = await Promise.all([
      window.floraSupabase
        .from('customer_profiles')
        .select('full_name, phone')
        .eq('user_id', currentUser.id)
        .maybeSingle(),
      window.floraSupabase
        .from('customer_addresses')
        .select('id, label, recipient_name, phone, delivery_address, is_default')
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: false }),
      window.floraSupabase
        .from('orders')
        .select('id, order_number, created_at, total_amount, status, delivery_address, tracking_information, payment_status')
        .eq('customer_id', currentUser.id)
        .order('created_at', { ascending: false })
    ]);

    if (currentUser?.id !== requestedUserId) return;
    if (profileResult.error) throw profileResult.error;
    if (addressesResult.error) throw addressesResult.error;
    if (ordersResult.error) throw ordersResult.error;
    if (!profileResult.data) {
      throw new Error('Your customer profile is missing. Run the customer account migration in Supabase.');
    }

    profileData = profileResult.data;
    addressData = addressesResult.data || [];
    accountOrders.splice(0, accountOrders.length, ...(ordersResult.data || []));

    orderItemsByOrder = new Map();
    if (accountOrders.length > 0) {
      const { data: items, error: itemsError } = await window.floraSupabase
        .from('order_items')
        .select('order_id, product_name, quantity, unit_price')
        .in('order_id', accountOrders.map(order => order.id));
      if (currentUser?.id !== requestedUserId) return;
      if (itemsError) throw itemsError;
      (items || []).forEach(item => {
        const orderItems = orderItemsByOrder.get(item.order_id) || [];
        orderItems.push(item);
        orderItemsByOrder.set(item.order_id, orderItems);
      });
    }

    renderAccountData();
  } catch (error) {
    accountSetupError(error);
  }
}

function renderAccountData() {
  const fullName = profileData?.full_name || currentUser?.user_metadata?.full_name || 'there';
  document.getElementById('welcomeHeading').textContent = `Welcome, ${fullName}`;
  document.getElementById('orderCount').textContent = String(accountOrders.length);
  document.getElementById('addressCount').textContent = String(addressData.length);
  document.getElementById('profileName').value = profileData?.full_name || '';
  document.getElementById('profilePhone').value = profileData?.phone || '';
  document.getElementById('profileEmail').value = currentUser?.email || '';
  renderOrderList();
  renderAddressList();
  renderTrackingOrderSelect();
}

function renderOrderList() {
  const container = document.getElementById('accountOrderList');
  if (accountOrders.length === 0) {
    container.innerHTML = '<p class="account-empty">You have no orders associated with this account yet. Guest orders are not added automatically.</p>';
    return;
  }

  container.innerHTML = accountOrders.map(order => {
    const items = orderItemsByOrder.get(order.id) || [];
    const itemMarkup = items.length
      ? `<ul class="order-item-list">${items.map(item => `<li>${escapeAccountHTML(item.product_name)} × ${Number(item.quantity)} — ${formatAccountPrice(Number(item.unit_price) * Number(item.quantity))}</li>`).join('')}</ul>`
      : '<p>Product details are not available.</p>';
    return `
      <article class="account-order-card">
        <h3>Order #${escapeAccountHTML(order.order_number)}</h3>
        <p>${escapeAccountHTML(formatAccountDate(order.created_at))}</p>
        <p>Total: <strong>${escapeAccountHTML(formatAccountPrice(order.total_amount))}</strong></p>
        <p>Status: <strong>${escapeAccountHTML(statusLabel(order.status))}</strong></p>
        <div class="account-order-actions">
          <button type="button" class="btn btn-secondary" data-track-order="${escapeAccountHTML(order.id)}">Track order</button>
        </div>
        <details>
          <summary>Order details</summary>
          ${itemMarkup}
          <p>Delivery address: ${escapeAccountHTML(order.delivery_address)}</p>
          <p>Payment: ${escapeAccountHTML(statusLabel(order.payment_status))}</p>
        </details>
      </article>
    `;
  }).join('');
}

function renderAddressList() {
  const container = document.getElementById('savedAddressList');
  if (addressData.length === 0) {
    container.innerHTML = '<p class="account-empty">No saved addresses yet. Add one to choose it more quickly at checkout.</p>';
    return;
  }
  container.innerHTML = addressData.map(address => `
    <article class="saved-address-card">
      <h3>${escapeAccountHTML(address.label)}${address.is_default ? ' <span>(Default)</span>' : ''}</h3>
      <p>${escapeAccountHTML(address.recipient_name)} · ${escapeAccountHTML(address.phone)}</p>
      <p>${escapeAccountHTML(address.delivery_address)}</p>
      <div class="address-card-actions">
        <button type="button" class="btn btn-secondary" data-edit-address="${escapeAccountHTML(address.id)}">Edit</button>
        ${address.is_default ? '' : `<button type="button" class="btn btn-secondary" data-default-address="${escapeAccountHTML(address.id)}">Make default</button>`}
        <button type="button" class="btn btn-secondary" data-delete-address="${escapeAccountHTML(address.id)}">Delete</button>
      </div>
    </article>
  `).join('');
}

function renderTrackingOrderSelect(selectedId = '') {
  const select = document.getElementById('trackingOrderSelect');
  select.innerHTML = accountOrders.length
    ? accountOrders.map(order => `<option value="${escapeAccountHTML(order.id)}" ${order.id === selectedId ? 'selected' : ''}>Order #${escapeAccountHTML(order.order_number)} — ${escapeAccountHTML(statusLabel(order.status))}</option>`).join('')
    : '<option value="">No orders to track</option>';
  renderTracking(accountOrders.find(order => order.id === (select.value || selectedId)));
}

function renderTracking(order) {
  const container = document.getElementById('trackingResult');
  if (!order) {
    container.innerHTML = '<p class="account-empty">Your order progress will appear here after you place an order while signed in.</p>';
    return;
  }

  const status = order.status === 'fulfilled' ? 'delivered' : order.status;
  const stages = ['pending', 'confirmed', 'processing', 'shipped', 'delivered'];
  let timeline;
  if (status === 'cancelled') {
    timeline = `
      <ol class="tracking-timeline is-cancelled">
        <li class="complete">Pending</li>
        <li class="cancelled">Cancelled</li>
      </ol>
    `;
  } else {
    const activeIndex = stages.indexOf(status);
    if (activeIndex < 0) {
      timeline = `<p>Current status: ${escapeAccountHTML(statusLabel(order.status))}. Progress details are not available for this status.</p>`;
    } else {
      timeline = `<ol class="tracking-timeline">${stages.map((stage, index) => {
        const state = index < activeIndex ? 'complete' : index === activeIndex ? 'current' : '';
        return `<li class="${state}">${escapeAccountHTML(statusLabel(stage))}</li>`;
      }).join('')}</ol>`;
    }
  }

  container.innerHTML = `
    <h3>Order #${escapeAccountHTML(order.order_number)}</h3>
    <p>Current order status: <strong>${escapeAccountHTML(statusLabel(order.status))}</strong></p>
    ${timeline}
    ${order.tracking_information
      ? `<p><strong>Delivery update:</strong> ${escapeAccountHTML(order.tracking_information)}</p>`
      : '<p>There is no additional delivery update yet.</p>'}
  `;
}

function openAddressEditor(address = null) {
  const form = document.getElementById('addressForm');
  form.hidden = false;
  document.getElementById('addressFormTitle').textContent = address ? 'Edit delivery address' : 'Add a delivery address';
  document.getElementById('addressId').value = address?.id || '';
  document.getElementById('addressLabel').value = address?.label || '';
  document.getElementById('addressRecipient').value = address?.recipient_name || profileData?.full_name || '';
  document.getElementById('addressPhone').value = address?.phone || profileData?.phone || '';
  document.getElementById('addressText').value = address?.delivery_address || '';
  document.getElementById('addressDefault').checked = Boolean(address?.is_default) || (!address && addressData.length === 0);
  form.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function closeAddressEditor() {
  const form = document.getElementById('addressForm');
  form.reset();
  form.hidden = true;
  document.getElementById('addressId').value = '';
}

async function setAddressDefault(addressId) {
  const { error } = await window.floraSupabase.rpc('set_default_customer_address', {
    p_address_id: addressId
  });
  if (error) throw error;
}

document.querySelectorAll('[data-auth-view]').forEach(button => {
  button.addEventListener('click', () => {
    clearAccountMessage();
    showAuth(button.dataset.authView);
  });
});

document.querySelectorAll('[data-account-view]').forEach(button => {
  button.addEventListener('click', () => setAccountView(button.dataset.accountView));
});

document.querySelectorAll('[data-open-account-view]').forEach(button => {
  button.addEventListener('click', () => setAccountView(button.dataset.openAccountView));
});

document.getElementById('loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  clearAccountMessage();
  const button = event.currentTarget.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    const { data, error } = await window.floraSupabase.auth.signInWithPassword({
      email: document.getElementById('loginEmail').value.trim(),
      password: document.getElementById('loginPassword').value
    });
    if (error) throw error;
    if (data.session) returnToCheckoutAfterAuth();
  } catch (error) {
    console.error('Customer sign in failed:', error);
    showAccountMessage(error.message || 'Could not sign in. Please check your details and try again.', 'error');
  } finally {
    button.disabled = false;
  }
});

document.getElementById('registerForm').addEventListener('submit', async event => {
  event.preventDefault();
  clearAccountMessage();
  const button = event.currentTarget.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    const fullName = document.getElementById('registerName').value.trim();
    const phone = document.getElementById('registerPhone').value.trim();
    const { data, error } = await window.floraSupabase.auth.signUp({
      email: document.getElementById('registerEmail').value.trim(),
      password: document.getElementById('registerPassword').value,
      options: {
        data: { full_name: fullName, phone },
        emailRedirectTo: getAccountAuthRedirectUrl()
      }
    });
    if (error) throw error;
    if (data.session) returnToCheckoutAfterAuth();
    if (!data.session) {
      showAccountMessage('Account created. Check your email to confirm the address, then sign in.', 'success');
      showAuth('login');
    }
  } catch (error) {
    console.error('Customer registration failed:', error);
    showAccountMessage(error.message || 'Could not create the account. Please try again.', 'error');
  } finally {
    button.disabled = false;
  }
});

document.getElementById('resetForm').addEventListener('submit', async event => {
  event.preventDefault();
  clearAccountMessage();
  const button = event.currentTarget.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    const { error } = await window.floraSupabase.auth.resetPasswordForEmail(
      document.getElementById('resetEmail').value.trim(),
      { redirectTo: getAccountAuthRedirectUrl() }
    );
    if (error) throw error;
    showAccountMessage('If an account exists for that email, a password reset link has been sent.', 'success');
  } catch (error) {
    console.error('Password reset request failed:', error);
    showAccountMessage(error.message || 'Could not send the password reset link.', 'error');
  } finally {
    button.disabled = false;
  }
});

document.getElementById('newPasswordForm').addEventListener('submit', async event => {
  event.preventDefault();
  clearAccountMessage();
  const button = event.currentTarget.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    const { error } = await window.floraSupabase.auth.updateUser({
      password: document.getElementById('newPassword').value
    });
    if (error) throw error;
    const { data: sessionData, error: sessionError } = await window.floraSupabase.auth.getSession();
    if (sessionError) throw sessionError;
    window.history.replaceState(null, '', window.location.pathname);
    if (sessionData.session) showDashboard(sessionData.session.user);
    showAccountMessage('Your password has been updated. You can continue using your account.', 'success');
  } catch (error) {
    console.error('Password update failed:', error);
    showAccountMessage(error.message || 'Could not update your password.', 'error');
  } finally {
    button.disabled = false;
  }
});

document.getElementById('profileForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (!currentUser) return;
  clearAccountMessage();
  const button = event.currentTarget.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    const fullName = document.getElementById('profileName').value.trim();
    const phone = document.getElementById('profilePhone').value.trim();
    const { data, error } = await window.floraSupabase
      .from('customer_profiles')
      .update({ full_name: fullName, phone })
      .eq('user_id', currentUser.id)
      .select('full_name, phone')
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('Your customer profile is missing. Run the customer account migration in Supabase, then sign in again.');
    profileData = data;
    document.getElementById('welcomeHeading').textContent = `Welcome, ${fullName}`;
    showAccountMessage('Profile updated.', 'success');
  } catch (error) {
    console.error('Customer profile update failed:', error);
    showAccountMessage(error.message || 'Could not update your profile.', 'error');
  } finally {
    button.disabled = false;
  }
});

document.getElementById('addAddressButton').addEventListener('click', () => openAddressEditor());
document.getElementById('cancelAddressButton').addEventListener('click', closeAddressEditor);

document.getElementById('addressForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (!currentUser) return;
  clearAccountMessage();
  const button = event.currentTarget.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    const addressId = document.getElementById('addressId').value;
    const values = {
      user_id: currentUser.id,
      label: document.getElementById('addressLabel').value.trim(),
      recipient_name: document.getElementById('addressRecipient').value.trim(),
      phone: document.getElementById('addressPhone').value.trim(),
      delivery_address: document.getElementById('addressText').value.trim(),
      is_default: false
    };
    let savedAddressId = addressId;
    if (addressId) {
      const { data, error } = await window.floraSupabase
        .from('customer_addresses')
        .update(values)
        .eq('id', addressId)
        .select('id')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('That saved address could not be found.');
      savedAddressId = data.id;
    } else {
      const { data, error } = await window.floraSupabase
        .from('customer_addresses')
        .insert(values)
        .select('id')
        .single();
      if (error) throw error;
      savedAddressId = data.id;
    }

    const shouldBeDefault = document.getElementById('addressDefault').checked || addressData.length === 0;
    if (shouldBeDefault) await setAddressDefault(savedAddressId);
    closeAddressEditor();
    await loadCustomerData();
    showAccountMessage('Address saved.', 'success');
  } catch (error) {
    console.error('Saved address update failed:', error);
    showAccountMessage(error.message || 'Could not save this address.', 'error');
  } finally {
    button.disabled = false;
  }
});

document.getElementById('savedAddressList').addEventListener('click', async event => {
  const editButton = event.target.closest('[data-edit-address]');
  const defaultButton = event.target.closest('[data-default-address]');
  const deleteButton = event.target.closest('[data-delete-address]');
  if (editButton) {
    const address = addressData.find(item => item.id === editButton.dataset.editAddress);
    if (address) openAddressEditor(address);
    return;
  }
  if (!defaultButton && !deleteButton) return;

  clearAccountMessage();
  const button = defaultButton || deleteButton;
  button.disabled = true;
  try {
    if (defaultButton) {
      await setAddressDefault(defaultButton.dataset.defaultAddress);
    } else {
      const { error } = await window.floraSupabase
        .from('customer_addresses')
        .delete()
        .eq('id', deleteButton.dataset.deleteAddress);
      if (error) throw error;
    }
    await loadCustomerData();
    showAccountMessage(defaultButton ? 'Default address updated.' : 'Address deleted.', 'success');
  } catch (error) {
    console.error('Saved address action failed:', error);
    showAccountMessage(error.message || 'Could not update this address.', 'error');
  } finally {
    button.disabled = false;
  }
});

document.getElementById('accountOrderList').addEventListener('click', event => {
  const button = event.target.closest('[data-track-order]');
  if (!button) return;
  setAccountView('tracking');
  renderTrackingOrderSelect(button.dataset.trackOrder);
});

document.getElementById('trackingOrderSelect').addEventListener('change', event => {
  renderTracking(accountOrders.find(order => order.id === event.target.value));
});

document.getElementById('logoutButton').addEventListener('click', async () => {
  clearAccountMessage();
  try {
    const { error } = await window.floraSupabase.auth.signOut();
    if (error) throw error;
    showAuth('login');
    showAccountMessage('You have been signed out.', 'success');
  } catch (error) {
    console.error('Customer sign out failed:', error);
    showAccountMessage(error.message || 'Could not sign out. Please try again.', 'error');
  }
});

async function initializeCustomerAccount() {
  if (!window.floraSupabase?.auth) {
    showAccountMessage('Account service is unavailable. Please try again later.', 'error');
    return;
  }

  const isRecovery = new URLSearchParams(window.location.hash.slice(1)).get('type') === 'recovery';
  const requestedAuthView = new URLSearchParams(window.location.search).get('view');
  const initialAuthView = ['login', 'register', 'reset'].includes(requestedAuthView)
    ? requestedAuthView
    : 'login';
  if (isRecovery) {
    showPasswordRecovery();
  } else {
    showAuth(initialAuthView);
  }

  const { data, error } = await window.floraSupabase.auth.getSession();
  if (error) {
    console.error('Could not restore customer session:', error);
    showAccountMessage('Could not restore your sign-in. Please sign in again.', 'error');
    showAuth('login');
  } else if (data.session && !isRecovery) {
    if (getCheckoutReturnUrl()) returnToCheckoutAfterAuth();
    else showDashboard(data.session.user);
  } else if (!isRecovery) {
    showAuth(initialAuthView);
  }

  window.floraSupabase.auth.onAuthStateChange((event, session) => {
    if (event === 'INITIAL_SESSION') return;
    window.setTimeout(() => {
      if (event === 'PASSWORD_RECOVERY') showPasswordRecovery();
      else if (session && getCheckoutReturnUrl()) returnToCheckoutAfterAuth();
      else if (session) showDashboard(session.user);
      else showAuth('login');
    }, 0);
  });
}

void initializeCustomerAccount();
