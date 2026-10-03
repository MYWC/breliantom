/**
 * Mobilex — Supabase production data layer
 * Vanilla JS / REST only. No framework, no npm, GitHub Pages friendly.
 *
 * Put ONLY the Supabase Project URL and publishable/anon key here, or expose
 * the same values before app.js loads as window.MOBILEX_SUPABASE_URL and
 * window.MOBILEX_SUPABASE_PUBLISHABLE_KEY.
 * NEVER put a service-role/secret key in this file.
 */

const CONFIG = {
  url: String(window.MOBILEX_SUPABASE_URL || '').replace(/\/$/, ''),
  publishableKey: String(window.MOBILEX_SUPABASE_PUBLISHABLE_KEY || ''),
};

const SESSION_KEY = 'mx-supabase-session-v1';

let sessionMemory = null;

export function isSupabaseConfigured() {
  return Boolean(CONFIG.url && CONFIG.publishableKey);
}

export function getSupabaseConfig() {
  return { ...CONFIG };
}

export function getStoredSession() {
  if (sessionMemory) return sessionMemory;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    sessionMemory = raw ? JSON.parse(raw) : null;
  } catch {
    sessionMemory = null;
  }
  return sessionMemory;
}

function saveSession(session) {
  sessionMemory = session || null;
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch {}
}

function authHeaders(accessToken = '') {
  return {
    apikey: CONFIG.publishableKey,
    Authorization: `Bearer ${accessToken || CONFIG.publishableKey}`,
    'Content-Type': 'application/json',
  };
}

async function parseResponse(response) {
  const text = await response.text();
  let body = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }
  if (!response.ok) {
    const message = body?.message || body?.msg || body?.error_description || body?.error || response.statusText;
    const error = new Error(`Supabase request failed (${response.status}): ${message}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

async function authFetch(path, options = {}) {
  if (!isSupabaseConfigured()) throw new Error('Supabase هنوز پیکربندی نشده است.');
  const response = await fetch(`${CONFIG.url}/auth/v1/${path}`, {
    ...options,
    headers: { ...authHeaders(), ...(options.headers || {}) },
  });
  return parseResponse(response);
}

async function restFetch(path, options = {}, retry = true) {
  if (!isSupabaseConfigured()) throw new Error('Supabase هنوز پیکربندی نشده است.');

  const session = getStoredSession();
  const response = await fetch(`${CONFIG.url}/rest/v1/${path}`, {
    ...options,
    headers: {
      ...authHeaders(session?.access_token || ''),
      ...(options.headers || {}),
    },
  });

  if (response.status === 401 && retry && session?.refresh_token) {
    try {
      await refreshSession();
      return restFetch(path, options, false);
    } catch {}
  }

  return parseResponse(response);
}

function buildQuery(path, params = {}) {
  const url = new URL(`${CONFIG.url}/rest/v1/${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  return `${url.pathname}${url.search}`;
}

export async function supabaseRequest(path, options = {}) {
  return restFetch(path, options);
}

export async function get(path, params = {}) {
  return restFetch(buildQuery(path, params), {
    headers: { Accept: 'application/json' },
  });
}

export async function post(path, body, { returning = false, onConflict = '' } = {}) {
  const headers = {};
  if (returning) headers.Prefer = 'return=representation';
  else headers.Prefer = 'return=minimal';
  if (onConflict) headers.Prefer += `,resolution=merge-duplicates`; // PK/unique target is inferred by PostgREST.
  return restFetch(path, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

export async function patch(path, body, { returning = false } = {}) {
  const headers = { Prefer: returning ? 'return=representation' : 'return=minimal' };
  return restFetch(path, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  });
}

export async function remove(path) {
  return restFetch(path, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
}

export async function rpc(name, body = {}) {
  return restFetch(`rpc/${name}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { Prefer: 'return=representation' },
  });
}

/* ------------------------- AUTH ------------------------- */

export async function signIn(email, password) {
  const data = await authFetch('token?grant_type=password', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  saveSession(data);
  return data;
}

export async function signUp(email, password, displayName = '', phone = '') {
  const data = await authFetch('signup', {
    method: 'POST',
    body: JSON.stringify({
      email,
      password,
      data: { name: displayName, display_name: displayName, full_name: displayName, phone },
    }),
  });
  if (data?.session) saveSession(data.session);
  return data;
}

export async function refreshSession() {
  const current = getStoredSession();
  if (!current?.refresh_token) throw new Error('جلسه قابل تمدید نیست.');
  const data = await authFetch(`token?grant_type=refresh_token`, {
    method: 'POST',
    body: JSON.stringify({ refresh_token: current.refresh_token }),
  });
  saveSession(data);
  return data;
}

export async function getSession() {
  const local = getStoredSession();
  if (!local?.access_token) return null;
  try {
    const user = await authFetch('user', {
      headers: { Authorization: `Bearer ${local.access_token}` },
    });
    return { ...local, user };
  } catch (error) {
    if (local.refresh_token) {
      try {
        const refreshed = await refreshSession();
        const user = await authFetch('user', {
          headers: { Authorization: `Bearer ${refreshed.access_token}` },
        });
        return { ...refreshed, user };
      } catch {}
    }
    saveSession(null);
    return null;
  }
}

export async function signOut() {
  const session = getStoredSession();
  try {
    if (session?.access_token) {
      await authFetch('logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
    }
  } finally {
    saveSession(null);
  }
}

export async function getMyProfile(userId) {
  const rows = await get('profiles', {
    select: '*',
    id: `eq.${userId}`,
    limit: '1',
  });
  return rows?.[0] || null;
}

export async function getMyRole(userId) {
  const rows = await get('user_roles', {
    select: '*',
    user_id: `eq.${userId}`,
    limit: '1',
  });
  return rows?.[0]?.role || 'customer';
}

/* ------------------------- CATALOG ------------------------- */

export async function loadCatalog() {
  const [brands, categories, series, models, colors, catalog] = await Promise.all([
    get('brands', { select: '*', is_active: 'eq.true', order: 'sort_order.asc,name_en.asc' }),
    get('categories', { select: '*', is_active: 'eq.true', order: 'sort_order.asc,name_en.asc' }),
    get('series', { select: '*', is_active: 'eq.true', order: 'sort_order.asc,name_en.asc' }),
    get('models', { select: '*', is_active: 'eq.true', order: 'sort_order.asc,name_en.asc' }),
    get('colors', { select: '*', is_active: 'eq.true', order: 'name_fa.asc' }),
    get('v_catalog', { select: '*', order: 'brand_name_en.asc,series_name_en.asc,model_name_en.asc,price_toman.asc' }),
  ]);

  const variantMap = new Map();
  for (const row of catalog || []) {
    if (!variantMap.has(row.variant_id)) {
      variantMap.set(row.variant_id, {
        id: row.variant_id,
        slug: row.variant_slug || row.variant_id,
        modelId: row.model_id,
        ram: Number(row.ram_gb),
        storage: Number(row.storage_gb),
        colorId: row.color_id,
        price: Number(row.price_toman),
        oldPrice: Number(row.old_price_toman || 0),
        stock: Number(row.stock || 0),
        sku: row.sku,
        warranty: row.warranty_text || '',
        delivery: row.delivery_text || '',
        offerId: row.offer_id,
        sellerId: row.seller_id || '',
        isDefault: Boolean(row.is_default),
      });
    }
  }

  return {
    brands: (brands || []).map((b) => ({
      id: b.id, slug: b.slug, nameFa: b.name_fa, nameEn: b.name_en, mark: b.mark, tone: b.tone,
      featured: Boolean(b.is_featured), isActive: Boolean(b.is_active), sortOrder: Number(b.sort_order || 0)
    })),
    categories: (categories || []).map((c) => ({
      id: c.id, slug: c.slug, name: c.name_fa, nameFa: c.name_fa, nameEn: c.name_en, note: c.note || '', isActive: Boolean(c.is_active), sortOrder: Number(c.sort_order || 0)
    })),
    series: (series || []).map((s) => ({
      id: s.id, slug: s.slug, brandId: s.brand_id, nameFa: s.name_fa, nameEn: s.name_en,
      description: s.description || '', isActive: Boolean(s.is_active), sortOrder: Number(s.sort_order || 0)
    })),
    models: (models || []).map((m) => ({
      id: m.id, slug: m.slug, brandId: series?.find((s) => s.id === m.series_id)?.brand_id || '', seriesId: m.series_id,
      categoryId: m.category_id, nameFa: m.name_fa, nameEn: m.name_en, rating: Number(m.rating || 0), reviews: Number(m.review_count || 0),
      specs: m.specs || {}, description: m.description || '', isActive: Boolean(m.is_active), sortOrder: Number(m.sort_order || 0)
    })),
    colors: (colors || []).map((c) => ({ id: c.id, nameFa: c.name_fa, hex: c.hex, isActive: Boolean(c.is_active) })),
    variants: [...variantMap.values()],
  };
}

export async function loadShipping() {
  const rows = await get('shipping_methods', {
    select: '*',
    is_active: 'eq.true',
    order: 'sort_order.asc,title.asc',
  });
  return (rows || []).map((x) => ({ id: x.id, title: x.title, detail: x.detail, price: Number(x.price_toman || 0) }));
}

export async function loadCoupons({ admin = false } = {}) {
  const rows = await get(admin ? 'coupons' : 'v_public_coupons', {
    select: '*',
    ...(admin ? { order: 'created_at.desc' } : { order: 'code.asc' }),
  });
  return (rows || []).map((x) => ({
    id: x.id,
    code: x.code,
    kind: x.kind,
    value: Number(x.value || 0),
    min: Number(x.min_subtotal_toman || 0),
    max: Number(x.max_discount_toman || 0),
    label: x.label || '',
    active: x.active !== false,
  }));
}

export async function loadHomeContent() {
  const rows = await get('site_content', { select: '*', id: 'eq.home', is_published: 'eq.true', limit: '1' });
  const row = rows?.[0];
  return row ? {
    heroEyebrow: row.hero_eyebrow,
    heroTitle: row.hero_title,
    heroText: row.hero_text,
    bannerTitle: row.banner_title,
    bannerText: row.banner_text,
  } : null;
}

export async function searchCatalog(query, { limit = 20 } = {}) {
  const value = String(query || '').trim().replaceAll(',', ' ');
  if (!value) return [];
  const safe = value.replaceAll('*', '').replaceAll('(', '').replaceAll(')', '');
  const encoded = safe.replaceAll(',', ' ');
  return get('v_catalog', {
    select: '*',
    or: `(brand_name_en.ilike.*${encoded}*,brand_name_fa.ilike.*${encoded}*,series_name_en.ilike.*${encoded}*,series_name_fa.ilike.*${encoded}*,model_name_en.ilike.*${encoded}*,model_name_fa.ilike.*${encoded}*,sku.ilike.*${encoded}*)`,
    order: 'brand_name_en.asc,model_name_en.asc,price_toman.asc',
    limit: String(limit),
  });
}

/* ------------------------- CART / WISHLIST / COMPARE ------------------------- */

async function ensureActiveCart(userId) {
  const existing = await get('carts', {
    select: '*',
    user_id: `eq.${userId}`,
    status: 'eq.active',
    order: 'created_at.asc',
    limit: '1',
  });
  if (existing?.[0]) return existing[0];

  const created = await post('carts', { user_id: userId, status: 'active' }, { returning: true });
  return created?.[0] || created;
}

export async function getRemoteCart(userId) {
  const cart = await ensureActiveCart(userId);
  if (!cart?.id) return [];
  const rows = await get('cart_items', {
    select: 'cart_id,offer_id,qty',
    cart_id: `eq.${cart.id}`,
    order: 'created_at.asc',
  });
  return { cartId: cart.id, items: rows || [] };
}

export async function setRemoteCartItem(userId, offerId, qty) {
  const cart = await ensureActiveCart(userId);
  if (!cart?.id) throw new Error('سبد کاربر ساخته نشد.');
  if (Number(qty) <= 0) {
    await remove(`cart_items?cart_id=eq.${cart.id}&offer_id=eq.${offerId}`);
    return;
  }
  await post('cart_items', {
    cart_id: cart.id,
    offer_id: offerId,
    qty: Math.max(1, Math.floor(Number(qty))),
  }, { onConflict: 'cart_id,offer_id' });
}

export async function clearRemoteCart(userId) {
  const cart = await ensureActiveCart(userId);
  if (!cart?.id) return;
  await remove(`cart_items?cart_id=eq.${cart.id}`);
}

async function getRemoteRelation(userId, table) {
  const rows = await get(table, {
    select: 'offer_id',
    user_id: `eq.${userId}`,
    order: 'created_at.asc',
  });
  return (rows || []).map((x) => x.offer_id);
}

export async function getRemoteWishlist(userId) {
  return getRemoteRelation(userId, 'wishlist_items');
}

export async function getRemoteCompare(userId) {
  return getRemoteRelation(userId, 'compare_items');
}

export async function toggleRemoteRelation(userId, table, offerId, active) {
  if (active) {
    await post(table, { user_id: userId, offer_id: offerId }, { onConflict: 'user_id,offer_id' });
  } else {
    await remove(`${table}?user_id=eq.${userId}&offer_id=eq.${offerId}`);
  }
}

/* ------------------------- ADDRESSES / ORDERS ------------------------- */

export async function getAddresses(userId) {
  return get('addresses', {
    select: '*',
    user_id: `eq.${userId}`,
    order: 'is_default.desc,created_at.asc',
  });
}

export async function saveAddress(userId, row) {
  const payload = {
    user_id: userId,
    title: row.title,
    receiver: row.receiver,
    phone: row.phone,
    province: row.province || '',
    city: row.city,
    detail: row.detail,
    postal: row.postal,
    is_default: Boolean(row.default || row.is_default),
  };
  if (row.id) return patch(`addresses?id=eq.${row.id}&user_id=eq.${userId}`, payload, { returning: true });
  return post('addresses', payload, { returning: true });
}

export async function setDefaultAddress(userId, id) {
  // The unique partial index plus trigger handles the one-default invariant.
  return patch(`addresses?id=eq.${id}&user_id=eq.${userId}`, { is_default: true }, { returning: true });
}

export async function deleteAddress(userId, id) {
  return remove(`addresses?id=eq.${id}&user_id=eq.${userId}`);
}

function mapOrder(order, itemRows) {
  return {
    id: order.id,
    orderNumber: order.order_number,
    date: new Date(order.created_at).toLocaleDateString('fa-IR', { month: 'long', day: 'numeric' }),
    status: order.status,
    total: Number(order.total_toman || 0),
    subtotal: Number(order.subtotal_toman || 0),
    discount: Number(order.discount_toman || 0),
    shipping: Number(order.shipping_toman || 0),
    shippingId: order.shipping_method_id,
    shippingSnapshot: order.shipping_snapshot || {},
    addressId: order.address_id,
    addressSnapshot: order.address_snapshot || {},
    tracking: order.tracking_number || '',
    couponCode: order.coupon_code_snapshot || '',
    createdAt: order.created_at,
    updatedAt: order.updated_at,
    items: (itemRows || []).map((item) => ({
      id: item.id,
      productId: item.variant_id,
      offerId: item.offer_id,
      qty: Number(item.qty || 0),
      titleFa: item.title_fa_snapshot,
      titleEn: item.title_en_snapshot,
      unitPrice: Number(item.unit_price_toman || 0),
      lineTotal: Number(item.line_total_toman || 0),
      sku: item.sku_snapshot,
    })),
  };
}

export async function getOrders(userId, { admin = false } = {}) {
  const orders = await get('orders', {
    select: '*',
    ...(admin ? {} : { user_id: `eq.${userId}` }),
    order: 'created_at.desc',
    limit: '100',
  });
  if (!orders?.length) return [];
  const ids = orders.map((x) => x.id);
  const inValue = `(${ids.join(',')})`;
  const items = await get('order_items', {
    select: '*',
    order_id: `in.${inValue}`,
    order: 'created_at.asc',
  });
  const byOrder = new Map();
  for (const item of items || []) {
    if (!byOrder.has(item.order_id)) byOrder.set(item.order_id, []);
    byOrder.get(item.order_id).push(item);
  }
  return orders.map((o) => mapOrder(o, byOrder.get(o.id) || []));
}

export async function createOrder(userId, { addressId, shippingMethodId, items, couponCode }) {
  return rpc('create_order', {
    p_address_id: addressId,
    p_shipping_method_id: shippingMethodId,
    p_items: items,
    p_coupon_code: couponCode || null,
  });
}

export async function cancelOrder(orderId) {
  return rpc('cancel_order', { p_order_id: orderId });
}

export async function getNotifications(userId) {
  return get('notifications', {
    select: '*',
    user_id: `eq.${userId}`,
    order: 'created_at.desc',
    limit: '50',
  });
}

export async function markNotificationRead(id, userId) {
  return patch(`notifications?id=eq.${id}&user_id=eq.${userId}`, { read_at: new Date().toISOString() });
}

/* ------------------------- ADMIN ------------------------- */

export async function getAdminCustomers() {
  return get('v_admin_customers', { select: '*', order: 'last_order_at.desc.nullslast' });
}

export async function getAdminSales() {
  return get('v_admin_sales', { select: '*', order: 'gross_sales_toman.desc' });
}

export async function adminUpsert(table, payload, idField = 'id') {
  if (payload[idField]) {
    return patch(`${table}?${idField}=eq.${encodeURIComponent(payload[idField])}`, payload, { returning: true });
  }
  return post(table, payload, { returning: true });
}

export async function adminDelete(table, idField, id) {
  return remove(`${table}?${idField}=eq.${encodeURIComponent(id)}`);
}

export async function adminSetStock(offerId, stockQty) {
  const result = await patch(`inventory?offer_id=eq.${encodeURIComponent(offerId)}`, { stock_qty: Math.max(0, Math.floor(Number(stockQty))) }, { returning: true });
  return result;
}

export async function adminUpdateOrderStatus(orderId, status, note = '') {
  return rpc('admin_update_order_status', {
    p_order_id: orderId,
    p_status: status,
    p_note: note,
  });
}

export async function adminSaveCoupon(row) {
  const payload = {
    code: String(row.code || '').trim().toUpperCase(),
    kind: row.kind,
    value: Number(row.value || 0),
    min_subtotal_toman: Number(row.min || 0),
    max_discount_toman: Number(row.max || 0),
    active: row.active !== false,
    label: row.label || '',
  };
  if (row.id) return patch(`coupons?id=eq.${row.id}`, payload, { returning: true });
  return post('coupons', payload, { returning: true });
}

export async function adminDeleteCoupon(id) {
  return adminDelete('coupons', 'id', id);
}

export async function adminSaveContent(row) {
  return patch('site_content?id=eq.home', {
    hero_eyebrow: row.heroEyebrow,
    hero_title: row.heroTitle,
    hero_text: row.heroText,
    banner_title: row.bannerTitle,
    banner_text: row.bannerText,
  }, { returning: true });
}
