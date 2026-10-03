import {
  brands as seedBrands,
  categories as seedCategories,
  series as seedSeries,
  models as seedModels,
  variants as seedVariants,
  colors as seedColors,
  shipping,
  coupons as seedCoupons,
  demoUser,
  demoAddresses,
  demoOrders,
  statusMap,
  guides,
} from './data.js';
import * as SB from './supabase.js';

const K = {
  wish: 'mx-wish-v4',
  compare: 'mx-compare-v4',
  cart: 'mx-cart-v4',
  user: 'mx-user-v4',
  addresses: 'mx-addresses-v4',
  orders: 'mx-orders-v4',
  coupon: 'mx-coupon-v4',
  shipping: 'mx-shipping-v4',
  catalog: 'mx-catalog-v5',
  coupons: 'mx-coupons-v5',
  content: 'mx-content-v5',
  admin: 'mx-admin-session-v5'
};

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const state = {
  filters: { brand: '', series: '', color: '', storage: '', ram: '', min: '', max: '', rating: '' },
  sort: 'featured',
  checkoutStep: 1,
  selectedAddress: 'addr-1',
  selectedShipping: 'express',
  search: '',
  filtersOpen: false,
  adminTab: 'dashboard'
};

let db = {
  brands: [],
  categories: [],
  series: [],
  models: [],
  variants: []
};

const remoteState = {
  configured: SB.isSupabaseConfigured(),
  ready: false,
  session: SB.getStoredSession(),
  profile: null,
  role: 'customer',
  addresses: null,
  orders: null,
  wishlistIds: null,
  compareIds: null,
  shipping: null,
  coupons: null,
  content: null,
  notifications: [],
  customers: null,
  sales: null
};

function remoteUserId() {
  return remoteState.session?.user?.id || null;
}

function remoteUser() {
  if (!remoteState.profile) return null;
  return {
    id: remoteState.profile.id,
    name: remoteState.profile.display_name || 'کاربر Mobilex',
    email: remoteState.profile.email || remoteState.session?.user?.email || '',
    phone: remoteState.profile.phone || ''
  };
}

function remoteLoggedIn() {
  return Boolean(remoteUserId() && remoteState.session?.access_token);
}

function activeShipping() {
  return remoteState.shipping || shipping;
}

function remoteArrayReady(value) {
  return remoteState.configured && remoteState.ready && Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function fa(value) {
  return new Intl.NumberFormat('fa-IR').format(Number(value) || 0);
}

function money(value) {
  return `${fa(value)} تومان`;
}

function read(key, fallback = []) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    toast('ذخیره‌سازی محلی ممکن نشد.');
    return false;
  }
}

function uid(prefix = 'mx') {
  const raw = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${raw.replaceAll('-', '').slice(0, 18)}`;
}


async function hydrateRemoteCatalog() {
  const bundle = await SB.loadCatalog();
  db = {
    brands: bundle.brands || [],
    categories: bundle.categories || [],
    series: bundle.series || [],
    models: bundle.models || [],
    variants: bundle.variants || [],
    colors: bundle.colors || []
  };
  persistLocalCatalogOnly();
}

function persistLocalCatalogOnly() {
  write(K.catalog, db);
  rebuild();
}

async function hydrateRemoteUser() {
  const session = await SB.getSession();
  remoteState.session = session;
  if (!session?.user?.id) {
    remoteState.profile = null;
    remoteState.role = 'customer';
    remoteState.addresses = null;
    remoteState.orders = null;
    remoteState.wishlistIds = null;
    remoteState.compareIds = null;
    remoteState.notifications = [];
    return;
  }
  const uid = session.user.id;
  const [profile, role, addressRows, orderRows, wishOffers, compareOffers, notificationRows, remoteCart] = await Promise.all([
    SB.getMyProfile(uid),
    SB.getMyRole(uid),
    SB.getAddresses(uid),
    SB.getOrders(uid),
    SB.getRemoteWishlist(uid),
    SB.getRemoteCompare(uid),
    SB.getNotifications(uid),
    SB.getRemoteCart(uid)
  ]);
  remoteState.profile = profile || { id: uid, display_name: session.user.user_metadata?.display_name || 'کاربر Mobilex', email: session.user.email || '', phone: session.user.user_metadata?.phone || '' };
  remoteState.role = role || 'customer';
  remoteState.addresses = (addressRows || []).map((a) => ({ id: a.id, title: a.title, receiver: a.receiver, phone: a.phone, province: a.province || '', city: a.city, detail: a.detail, postal: a.postal, default: Boolean(a.is_default) }));
  remoteState.orders = orderRows || [];
  remoteState.wishlistIds = (wishOffers || []).map((offerId) => products.find((p) => p.offerId === offerId)?.id).filter(Boolean);
  remoteState.compareIds = (compareOffers || []).map((offerId) => products.find((p) => p.offerId === offerId)?.id).filter(Boolean);
  remoteState.notifications = notificationRows || [];

  const offerToProduct = new Map(products.map((p) => [p.offerId, p.id]));
  const remoteCartItems = (remoteCart?.items || []).map((row) => ({ productId: offerToProduct.get(row.offer_id), qty: Number(row.qty || 0) })).filter((x) => x.productId);
  if (remoteCart) write(K.cart, remoteCartItems);

  write(K.user, remoteUser());
  write(K.addresses, remoteState.addresses);
  write(K.orders, remoteState.orders);
  write(K.wish, remoteState.wishlistIds);
  write(K.compare, remoteState.compareIds);
}

async function hydrateRemotePublic() {
  if (!remoteState.configured) return;
  const [shippingRows, couponRows, contentRow] = await Promise.all([
    SB.loadShipping(),
    SB.loadCoupons(),
    SB.loadHomeContent()
  ]);
  remoteState.shipping = shippingRows;
  remoteState.coupons = couponRows;
  remoteState.content = contentRow;
  if (remoteState.session?.user?.id && ['admin', 'manager'].includes(remoteState.role)) {
    const [customers, sales] = await Promise.all([SB.getAdminCustomers(), SB.getAdminSales()]);
    remoteState.customers = customers || [];
    remoteState.sales = sales || [];
  }
}

async function bootSupabase() {
  if (!remoteState.configured) return;
  try {
    await hydrateRemoteCatalog();
    await hydrateRemoteUser();
    remoteState.role = remoteState.role || 'customer';
    await hydrateRemotePublic();
    remoteState.ready = true;
    const defaultAddress = addresses().find((a) => a.default);
    if (defaultAddress) state.selectedAddress = defaultAddress.id;
    const defaultShip = activeShipping()[0];
    if (defaultShip && !activeShipping().some((x) => x.id === state.selectedShipping)) state.selectedShipping = defaultShip.id;
    render();
  } catch (error) {
    console.error('Mobilex Supabase boot failed:', error);
    remoteState.ready = true;
    toast('اتصال Supabase برقرار نشد؛ سایت با داده محلی ادامه می‌دهد.');
    render();
  }
}

async function refreshRemoteData({ catalog = false, userData = false, admin = false } = {}) {
  if (!remoteState.configured) return;
  try {
    if (catalog) await hydrateRemoteCatalog();
    if (userData && remoteLoggedIn()) await hydrateRemoteUser();
    if (admin && remoteLoggedIn() && ['admin', 'manager'].includes(remoteState.role)) {
      const [customers, sales] = await Promise.all([SB.getAdminCustomers(), SB.getAdminSales()]);
      remoteState.customers = customers || [];
      remoteState.sales = sales || [];
    }
    render();
  } catch (error) {
    console.error(error);
    toast(error.message || 'دریافت داده از Supabase ناموفق بود.');
  }
}

async function remoteLogin(email, password) {
  const session = await SB.signIn(email, password);
  remoteState.session = session;
  await hydrateRemoteUser();
  await hydrateRemotePublic();
  remoteState.ready = true;
  if (remoteUser()) write(K.user, remoteUser());
  const defaultAddress = addresses().find((a) => a.default);
  if (defaultAddress) state.selectedAddress = defaultAddress.id;
  render();
}

async function remoteSignup(name, email, password, phone) {
  const result = await SB.signUp(email, password, name, phone);
  if (!result?.session) {
    toast('ثبت‌نام انجام شد؛ ایمیل تأیید را بررسی کن و بعد وارد شو.');
    return;
  }
  remoteState.session = result.session;
  await hydrateRemoteUser();
  await hydrateRemotePublic();
  remoteState.ready = true;
  render();
}

async function remoteLogout() {
  try { await SB.signOut(); } catch (error) { console.error(error); }
  remoteState.session = null;
  remoteState.profile = null;
  remoteState.role = 'customer';
  remoteState.addresses = null;
  remoteState.orders = null;
  remoteState.wishlistIds = null;
  remoteState.compareIds = null;
  remoteState.notifications = [];
  localStorage.removeItem(K.user);
  localStorage.removeItem(K.admin);
  render();
}

function mapOfferIds(productIds) {
  return productIds.map((id) => getProduct(id)?.offerId).filter(Boolean);
}

function getCatalogProducts() {
  return db.variants.map((variant, index) => {
    const m = getModel(variant.modelId);
    return {
      ...variant,
      slug: variant.slug || variant.id,
      titleFa: m?.nameFa || 'گوشی موبایل',
      titleEn: m?.nameEn || 'Mobile Phone',
      rating: m?.rating || 4.5,
      reviews: m?.reviews || 0,
      specs: m?.specs || {},
      isNew: index < 5,
      isFeatured: index < 8,
      categoryId: m?.categoryId || 'phones'
    };
  });
}

let products = [];

function rebuild() {
  products = getCatalogProducts();
}

function persistCatalog() {
  write(K.catalog, db);
  rebuild();
}

function initCatalog() {
  const saved = read(K.catalog, null);
  if (saved?.brands && saved?.series && saved?.models && saved?.variants) {
    db = {
      brands: saved.brands,
      categories: saved.categories || clone(seedCategories),
      series: saved.series,
      models: saved.models,
      variants: saved.variants
    };
  } else {
    db = {
      brands: clone(seedBrands),
      categories: clone(seedCategories),
      series: clone(seedSeries),
      models: clone(seedModels),
      variants: clone(seedVariants)
    };
    persistCatalog();
  }
  rebuild();
}

function coupons() {
  if (remoteArrayReady(remoteState.coupons)) return remoteState.coupons;
  const saved = read(K.coupons, null);
  if (Array.isArray(saved)) return saved;
  write(K.coupons, clone(seedCoupons));
  return clone(seedCoupons);
}

function content() {
  if (remoteState.content) return remoteState.content;
  return read(K.content, {
    heroEyebrow: 'MOBILEX / COMMERCE',
    heroTitle: 'خرید موبایل، روشن و ساده.',
    heroText: 'برند، سری، مدل و Variant را در یک مسیر واضح پیدا کن و قبل از خرید مقایسه کن.',
    bannerTitle: 'از انتخاب تا سفارش، یک مسیر.',
    bannerText: 'سبد، کد تخفیف، ارسال، پرداخت و پیگیری را در یک تجربه مرتب نگه می‌داریم.'
  });
}

function wish() { return remoteArrayReady(remoteState.wishlistIds) ? remoteState.wishlistIds : read(K.wish, []); }
function cmp() { return remoteArrayReady(remoteState.compareIds) ? remoteState.compareIds : read(K.compare, []); }
function cart() { return read(K.cart, []); }
function user() { return remoteUser() || read(K.user, null); }
function addresses() { return remoteArrayReady(remoteState.addresses) ? remoteState.addresses : read(K.addresses, demoAddresses); }
function orders() { return remoteArrayReady(remoteState.orders) ? remoteState.orders : read(K.orders, demoOrders); }
function coupon() { return read(K.coupon, null); }
function adminSession() {
  if (remoteState.configured && remoteState.ready && remoteLoggedIn()) return { active: ['admin', 'manager'].includes(remoteState.role), role: remoteState.role };
  return read(K.admin, null);
}
function cartQty() { return cart().reduce((sum, item) => sum + Number(item.qty || 0), 0); }
function getBrand(value) { return db.brands.find((x) => x.id === value || x.slug === value); }
function getSeries(value) { return db.series.find((x) => x.id === value || x.slug === value); }
function getModel(value) { return db.models.find((x) => x.id === value || x.slug === value); }
function getProduct(value) { return products.find((x) => x.id === value || x.slug === value); }
function productsForModel(id) { return products.filter((x) => x.modelId === id); }
function variantsForModel(id) { return db.variants.filter((x) => x.modelId === id); }
function model(product) { return getModel(product?.modelId); }
function brand(product) { return getBrand(model(product)?.brandId); }
function serie(product) { return getSeries(model(product)?.seriesId); }
function pcolor(product) { return (remoteState.ready ? (db.colors || []) : seedColors).find((x) => x.id === product?.colorId) || seedColors.find((x) => x.id === product?.colorId); }
function disc(product) {
  return product.oldPrice && product.oldPrice > product.price
    ? Math.round((1 - product.price / product.oldPrice) * 100)
    : 0;
}
function ic(name) {
  return { arr: '→', heart: '♡', bag: '◱', check: '✓', close: '×', plus: '+', search: '⌕' }[name] || '•';
}
function brandMark(b, cls = '') {
  return `<span class="brand-mark-bubble brand-${esc(b?.tone || 'plain')} ${cls}">${esc(b?.mark || '?')}</span>`;
}
function heroTitleHtml(value) {
  const raw = String(value ?? '').trim();
  const parts = raw.split('،');
  if (parts.length < 2) return esc(raw);
  return `${esc(parts.shift())}،<br><em>${esc(parts.join('،'))}</em>`;
}

function phoneArt(p, large = false) {
  if (!p) return '<div class="phone-art"><div class="phone-device"></div></div>';
  return `<div class="phone-art ${large ? 'large' : ''}" style="--phone:${esc(pcolor(p)?.hex || '#d5d5d0')}">
    <div class="phone-device">
      <span class="camera"><i></i><i></i><i></i></span>
      <span class="phone-screen"><b>${esc(brand(p)?.nameEn || 'Mobilex')}</b><small>${esc(p.titleEn)}</small></span>
    </div>
    <span class="phone-shadow"></span>
  </div>`;
}

function syncPath() {
  state.path = location.pathname;
}

function pageMeta(title, description) {
  document.title = `${title} — Mobilex`;
  const meta = document.querySelector('meta[name="description"]');
  if (meta) meta.setAttribute('content', description || 'Mobilex — فروشگاه مدرن موبایل برای کشف، مقایسه و خرید.');
  const canonicalUrl = new URL(location.href);
  canonicalUrl.hash = '';
  let canonical = document.querySelector('link[rel="canonical"]');
  if (!canonical) {
    canonical = document.createElement('link');
    canonical.rel = 'canonical';
    document.head.appendChild(canonical);
  }
  canonical.href = canonicalUrl.href;
  let ld = document.getElementById('mobilex-jsonld');
  if (!ld) {
    ld = document.createElement('script');
    ld.type = 'application/ld+json';
    ld.id = 'mobilex-jsonld';
    document.head.appendChild(ld);
  }
  ld.textContent = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Mobilex',
    url: location.origin,
    potentialAction: { '@type': 'SearchAction', target: `${location.origin}/products?q={search_term_string}`, 'query-input': 'required name=search_term_string' }
  });
}

function breadcrumbs(items) {
  return `<nav class="breadcrumbs" aria-label="مسیر صفحه"><a href="/" data-route="/">خانه</a>${items.map((item) => `<span>/</span>${item.href ? `<a href="${item.href}" data-route="${item.href}">${esc(item.label)}</a>` : `<strong>${esc(item.label)}</strong>`}`).join('')}</nav>`;
}

function page(body, cls = '') {
  return `<section class="page ${cls}"><div class="container">${body}</div></section>`;
}

function productCard(p) {
  const m = model(p), b = brand(p), c = pcolor(p), d = disc(p);
  return `<article class="product-card">
    <div class="product-visual">
      <div class="visual-top"><div>${p.isNew ? '<span class="badge">NEW</span>' : ''}${d ? `<span class="badge dark">${fa(d)}٪</span>` : ''}</div>
      <div><button class="round-btn ${cmp().includes(p.id) ? 'active' : ''}" data-action="compare" data-id="${esc(p.id)}" aria-label="مقایسه">${ic('plus')}</button><button class="round-btn ${wish().includes(p.id) ? 'active' : ''}" data-action="wish" data-id="${esc(p.id)}" aria-label="علاقه‌مندی">${ic('heart')}</button></div></div>
      <a class="product-visual-link" href="/product/${esc(p.slug)}" data-route="/product/${esc(p.slug)}">${phoneArt(p)}</a>
      <button class="quick-view" data-action="quick" data-id="${esc(p.id)}">مشاهده سریع ${ic('arr')}</button>
    </div>
    <div class="product-copy"><small>${esc(b?.nameFa || '')}</small><h3><a href="/product/${esc(p.slug)}" data-route="/product/${esc(p.slug)}">${esc(m?.nameFa || p.titleFa)}</a></h3>
    <p>${fa(p.ram)}GB RAM · ${p.storage >= 1024 ? '1TB' : `${fa(p.storage)}GB`} · ${esc(c?.nameFa || '')}</p>
    <div class="rating">★ ${Number(p.rating).toFixed(1)} <span>(${fa(p.reviews)})</span></div>
    <div class="price-row"><div><strong>${money(p.price)}</strong>${p.oldPrice ? `<del>${money(p.oldPrice)}</del>` : ''}</div><button class="text-action" data-action="add-cart" data-id="${esc(p.id)}">افزودن ${ic('arr')}</button></div></div>
  </article>`;
}

function home() {
  const c = content();
  const featured = products.filter((p) => p.isFeatured).slice(0, 4);
  const trending = [...products].sort((a, b) => (b.rating * b.reviews) - (a.rating * a.reviews)).slice(0, 4);
  const heroProduct = products[0];
  pageMeta('فروشگاه موبایل', 'Mobilex — کشف، مقایسه و خرید موبایل با یک مسیر واضح.');
  return `${
    `<section class="hero"><div class="container hero-grid"><div class="hero-copy"><span class="eyebrow">${esc(c.heroEyebrow)}</span><h1>${heroTitleHtml(c.heroTitle)}</h1><p>${esc(c.heroText)}</p><div class="hero-actions"><a class="button dark" href="/products" data-route="/products">شروع خرید ${ic('arr')}</a><button class="button" data-action="search">جستجوی مدل</button></div><div class="hero-points"><span>✓ انتخاب Variant</span><span>✓ مقایسه</span><span>✓ Checkout مرحله‌ای</span></div></div><div class="hero-stage"><div class="hero-note"><span>FEATURED</span><b>${esc(heroProduct?.titleEn || 'Mobilex')}</b><small>${esc(brand(heroProduct)?.nameEn || '')} · ${heroProduct ? `${fa(heroProduct.ram)}GB / ${heroProduct.storage >= 1024 ? '1TB' : `${heroProduct.storage}GB`}` : ''}</small></div>${phoneArt(heroProduct, true)}${heroProduct ? `<a href="/product/${heroProduct.slug}" data-route="/product/${heroProduct.slug}">صفحه محصول ${ic('arr')}</a>` : ''}</div></div></section>`}
    <section class="section compact"><div class="container"><div class="section-head"><div><span class="eyebrow">EXPLORE</span><h2>از دسته‌ای شروع کن.</h2><p>مسیرهای اصلی فروشگاه، کوتاه و واضح.</p></div></div><div class="category-grid">${db.categories.map((category) => `<a class="category-card" href="/products?category=${encodeURIComponent(category.slug)}" data-route="/products?category=${encodeURIComponent(category.slug)}"><strong>${esc(category.name)}</strong><small>${esc(category.note)}</small></a>`).join('')}</div></div></section>
    <section class="section soft"><div class="container"><div class="section-head"><div><span class="eyebrow">BRANDS</span><h2>برندت را انتخاب کن.</h2><p>از برند مستقیم به سری و مدل برو.</p></div><a class="text-action" href="/brands" data-route="/brands">همه برندها ${ic('arr')}</a></div><div class="brand-grid">${db.brands.filter((b) => b.featured).map(brandCard).join('')}</div></div></section>
    <section class="section"><div class="container"><div class="section-head"><div><span class="eyebrow">NEW</span><h2>تازه‌واردها.</h2><p>محصولاتی که برای شروع انتخاب کرده‌ایم.</p></div></div><div class="product-grid">${featured.map(productCard).join('')}</div></div></section>
    <section class="section soft"><div class="container"><div class="commerce-banner"><div><span class="eyebrow">SHOPPING FLOW</span><h2>${esc(c.bannerTitle)}</h2><p>${esc(c.bannerText)}</p><a class="button dark" href="/cart" data-route="/cart">دیدن سبد ${ic('arr')}</a></div><div class="flow-grid"><span>01<br><b>انتخاب</b></span><span>02<br><b>Variant</b></span><span>03<br><b>Checkout</b></span><span>04<br><b>Tracking</b></span></div></div></div></section>
    <section class="section"><div class="container"><div class="section-head"><div><span class="eyebrow">TRENDING</span><h2>محبوب‌ترین‌ها.</h2><p>مدل‌های پرمراجعه برای مقایسه.</p></div></div><div class="product-grid">${trending.map(productCard).join('')}</div></div></section>`;
}

function brandCard(b) {
  const modelCount = db.models.filter((m) => m.brandId === b.id).length;
  const seriesCount = db.series.filter((s) => s.brandId === b.id).length;
  return `<a class="brand-card" href="/brand/${esc(b.slug)}" data-route="/brand/${esc(b.slug)}">${brandMark(b)}<div><strong>${esc(b.nameFa)}</strong><small>${esc(b.nameEn)}</small><em>${fa(seriesCount)} سری · ${fa(modelCount)} مدل</em></div>${ic('arr')}</a>`;
}

function brandsPage() {
  const q = (new URL(location.href).searchParams.get('q') || '').trim().toLowerCase();
  const list = db.brands.filter((b) => `${b.nameFa} ${b.nameEn}`.toLowerCase().includes(q));
  pageMeta('برندها', 'فهرست برندهای موبایل در Mobilex.');
  return page(`${breadcrumbs([{ label: 'برندها' }])}<div class="page-hero"><div><span class="eyebrow">BRAND DIRECTORY</span><h1>برندها.</h1><p>از Brand به Series، Model و Variant برو.</p></div></div><div class="directory-bar"><label>⌕<input id="brand-search" value="${esc(q)}" placeholder="جستجوی برند…"></label><span>${fa(list.length)} برند</span></div><div class="brand-grid directory">${list.map(brandCard).join('') || '<div class="empty">برندی پیدا نشد.</div>'}</div>`, 'directory');
}

function brandPage(slug) {
  const b = getBrand(slug);
  if (!b) return page('<div class="empty">برند پیدا نشد.</div>');
  const ss = db.series.filter((s) => s.brandId === b.id);
  const ms = db.models.filter((m) => m.brandId === b.id);
  const ps = products.filter((p) => brand(p)?.id === b.id);
  pageMeta(`${b.nameFa}`, `محصولات ${b.nameFa} در Mobilex.`);
  return page(`${breadcrumbs([{ label: 'برندها', href: '/brands' }, { label: b.nameFa }])}<div class="brand-hero"><div class="brand-hero-head">${brandMark(b, 'hero')}<div><span class="eyebrow">${esc(b.nameEn)}</span><h1>${esc(b.nameFa)}</h1><p>${fa(ss.length)} سری · ${fa(ms.length)} مدل نمونه</p></div></div><a class="button dark" href="/products?brand=${encodeURIComponent(b.slug)}" data-route="/products?brand=${encodeURIComponent(b.slug)}">همه محصولات ${ic('arr')}</a></div><div class="section-inline"><div class="section-head"><div><span class="eyebrow">SERIES</span><h2>سری‌ها.</h2></div></div><div class="series-grid">${ss.map((s) => `<a class="series-card" href="/series/${esc(s.slug)}" data-route="/series/${esc(s.slug)}"><span>${esc(b.nameEn)}</span><strong>${esc(s.nameFa)}</strong><small>${esc(s.description || '')}</small>${ic('arr')}</a>`).join('')}</div></div><div class="section-inline"><div class="section-head"><div><span class="eyebrow">PRODUCTS</span><h2>محصولات این برند.</h2></div></div><div class="product-grid">${ps.slice(0, 8).map(productCard).join('') || '<div class="empty">محصولی ثبت نشده است.</div>'}</div></div>`, 'brand-page');
}

function seriesPage(slug) {
  const s = getSeries(slug);
  if (!s) return page('<div class="empty">سری پیدا نشد.</div>');
  const b = getBrand(s.brandId);
  const ms = db.models.filter((m) => m.seriesId === s.id);
  const ps = products.filter((p) => serie(p)?.id === s.id);
  pageMeta(`${s.nameFa}`, `مدل‌ها و محصولات ${s.nameFa} در Mobilex.`);
  return page(`${breadcrumbs([{ label: 'برندها', href: '/brands' }, { label: b?.nameFa || '', href: `/brand/${b?.slug || ''}` }, { label: s.nameFa }])}<div class="series-hero"><div><span class="eyebrow">${esc(s.nameEn)}</span><h1>${esc(s.nameFa)}</h1><p>${esc(s.description || '')} · ${fa(ms.length)} مدل نمونه.</p><a class="button dark" href="/products?series=${encodeURIComponent(s.slug)}" data-route="/products?series=${encodeURIComponent(s.slug)}">محصولات سری ${ic('arr')}</a></div><div>${ps[0] ? phoneArt(ps[0], true) : ''}</div></div><div class="section-inline"><div class="section-head"><div><span class="eyebrow">MODELS</span><h2>مدل‌های این سری.</h2></div></div><div class="model-grid">${ms.map((m) => { const p = productsForModel(m.id)[0]; return `<a class="model-card" href="${p ? `/product/${p.slug}` : `/products?model=${encodeURIComponent(m.slug)}`}" data-route="${p ? `/product/${p.slug}` : `/products?model=${encodeURIComponent(m.slug)}`}" >${p ? phoneArt(p) : ''}<div><strong>${esc(m.nameFa)}</strong><small>★ ${Number(m.rating || 0).toFixed(1)} · ${fa(m.reviews || 0)} بررسی</small></div></a>`; }).join('')}</div></div>`, 'series-page');
}

function catalog() {
  const url = new URL(location.href);
  const q = (url.searchParams.get('q') || '').toLowerCase();
  state.filters = {
    brand: url.searchParams.get('brand') || '',
    series: url.searchParams.get('series') || '',
    color: url.searchParams.get('color') || '',
    storage: url.searchParams.get('storage') || '',
    ram: url.searchParams.get('ram') || '',
    min: url.searchParams.get('min') || '',
    max: url.searchParams.get('max') || '',
    rating: url.searchParams.get('rating') || '',
    category: url.searchParams.get('category') || ''
  };
  state.sort = url.searchParams.get('sort') || 'featured';
  let list = [...products];
  const match = (p) => `${p.titleFa} ${p.titleEn} ${brand(p)?.nameFa || ''} ${brand(p)?.nameEn || ''} ${serie(p)?.nameFa || ''} ${serie(p)?.nameEn || ''}`.toLowerCase().includes(q);
  if (q) list = list.filter(match);
  if (state.filters.brand) list = list.filter((p) => brand(p)?.slug === state.filters.brand || brand(p)?.id === state.filters.brand);
  if (state.filters.series) list = list.filter((p) => serie(p)?.slug === state.filters.series || serie(p)?.id === state.filters.series);
  if (state.filters.category) list = list.filter((p) => p.categoryId === state.filters.category);
  if (state.filters.color) list = list.filter((p) => p.colorId === state.filters.color);
  if (state.filters.storage) list = list.filter((p) => String(p.storage) === state.filters.storage);
  if (state.filters.ram) list = list.filter((p) => String(p.ram) === state.filters.ram);
  if (state.filters.min) list = list.filter((p) => p.price >= Number(state.filters.min));
  if (state.filters.max) list = list.filter((p) => p.price <= Number(state.filters.max));
  if (state.filters.rating) list = list.filter((p) => p.rating >= Number(state.filters.rating));
  if (state.sort === 'price-asc') list.sort((a, b) => a.price - b.price);
  else if (state.sort === 'price-desc') list.sort((a, b) => b.price - a.price);
  else if (state.sort === 'rating') list.sort((a, b) => b.rating - a.rating);
  else if (state.sort === 'discount') list.sort((a, b) => disc(b) - disc(a));
  else if (state.sort === 'new') list.sort((a, b) => Number(b.isNew) - Number(a.isNew));
  else list.sort((a, b) => (b.rating * b.reviews) - (a.rating * a.reviews));
  return list;
}

function filters() {
  return `<aside class="filters ${state.filtersOpen ? 'open' : ''}"><div class="filters-head"><b>فیلترها</b><button class="icon-btn mobile-only" data-action="filters-close">×</button></div><div class="filter-block"><b>برند</b><div class="check-list">${db.brands.map((b) => `<label><input type="radio" name="brand-filter" value="${esc(b.slug)}" ${state.filters.brand === b.slug ? 'checked' : ''}><span>${esc(b.nameFa)}</span></label>`).join('')}</div></div><div class="filter-block"><b>سری</b><select id="filter-series"><option value="">همه</option>${db.series.map((s) => `<option value="${esc(s.slug)}" ${state.filters.series === s.slug ? 'selected' : ''}>${esc(s.nameFa)}</option>`).join('')}</select></div><div class="filter-block"><b>حافظه</b><div class="pill-row">${[128,256,512,1024].map((v) => `<button class="${state.filters.storage === String(v) ? 'active' : ''}" data-storage="${v}">${v >= 1024 ? '1TB' : `${fa(v)}GB`}</button>`).join('')}</div></div><div class="filter-block"><b>RAM</b><div class="pill-row">${[8,12,16,24].map((v) => `<button class="${state.filters.ram === String(v) ? 'active' : ''}" data-ram="${v}">${fa(v)}GB</button>`).join('')}</div></div><div class="filter-block"><b>رنگ</b><div class="color-row">${(remoteState.ready ? (db.colors || []) : seedColors).map((c) => `<button class="${state.filters.color === c.id ? 'active' : ''}" data-color="${esc(c.id)}" title="${esc(c.nameFa)}"><i style="--dot:${esc(c.hex)}"></i></button>`).join('')}</div></div><div class="filter-block"><b>امتیاز</b><select id="filter-rating"><option value="">همه</option><option value="4.8" ${state.filters.rating === '4.8' ? 'selected' : ''}>۴.۸ به بالا</option><option value="4.5" ${state.filters.rating === '4.5' ? 'selected' : ''}>۴.۵ به بالا</option></select></div><div class="filter-block"><b>قیمت</b><div class="two-inputs"><input id="min-price" type="number" value="${esc(state.filters.min)}" placeholder="از"><input id="max-price" type="number" value="${esc(state.filters.max)}" placeholder="تا"></div></div><button class="button dark full" data-action="apply-filters">اعمال فیلتر</button><button class="filter-clear" data-action="clear-filters">پاک کردن</button></aside>`;
}

function productsPage() {
  const list = catalog();
  const b = getBrand(state.filters.brand);
  const s = getSeries(state.filters.series);
  const q = new URL(location.href).searchParams.get('q') || '';
  const title = b ? `محصولات ${b.nameFa}` : s ? `محصولات ${s.nameFa}` : q ? `نتایج «${q}»` : 'همه موبایل‌ها';
  pageMeta(title, `${title} در Mobilex.`);
  return page(`${breadcrumbs([{ label: 'موبایل‌ها' }])}<div class="page-hero"><div><span class="eyebrow">CATALOG</span><h1>${esc(title)}</h1><p>${fa(list.length)} محصول در محدوده فعلی.</p></div><button class="button mobile-only" data-action="filters-open">فیلترها</button></div><div class="catalog-toolbar"><span>${fa(list.length)} نتیجه</span><label>مرتب‌سازی <select id="catalog-sort"><option value="featured" ${state.sort === 'featured' ? 'selected' : ''}>پیشنهاد Mobilex</option><option value="new" ${state.sort === 'new' ? 'selected' : ''}>جدیدترین</option><option value="price-asc" ${state.sort === 'price-asc' ? 'selected' : ''}>ارزان‌ترین</option><option value="price-desc" ${state.sort === 'price-desc' ? 'selected' : ''}>گران‌ترین</option><option value="rating" ${state.sort === 'rating' ? 'selected' : ''}>امتیاز</option><option value="discount" ${state.sort === 'discount' ? 'selected' : ''}>تخفیف</option></select></label></div><div class="catalog-layout">${filters()}<div class="catalog-main"><div class="product-grid catalog-grid">${list.map(productCard).join('') || '<div class="empty">محصولی پیدا نشد.</div>'}</div></div></div>`, 'catalog');
}

function productPage(slug) {
  const p = getProduct(slug);
  if (!p) return page('<div class="empty">محصول پیدا نشد.</div>');
  const m = model(p), b = brand(p), s = serie(p), ps = productsForModel(m.id), vs = variantsForModel(m.id);
  pageMeta(m?.nameFa || p.titleFa, `${m?.nameFa || p.titleFa} — مشخصات، قیمت و Variantها در Mobilex.`);
  const storageOptions = [...new Set(vs.map((v) => v.storage))];
  const ramOptions = [...new Set(vs.map((v) => v.ram))];
  const colorOptions = [...new Set(vs.map((v) => v.colorId))];
  return page(`${breadcrumbs([{ label: 'برندها', href: '/brands' }, { label: b?.nameFa || '', href: `/brand/${b?.slug || ''}` }, { label: s?.nameFa || '', href: `/series/${s?.slug || ''}` }, { label: m?.nameFa || p.titleFa }])}<div class="product-detail"><div><div class="gallery">${phoneArt(p, true)}</div><small class="sku">SKU: ${esc(p.sku)}</small></div><div class="product-info"><span class="eyebrow">${esc(b?.nameEn || '')} / ${esc(s?.nameEn || '')}</span><h1>${esc(m?.nameFa || p.titleFa)}</h1><p class="english">${esc(m?.nameEn || p.titleEn)}</p><div class="rating">★ ${Number(p.rating).toFixed(1)} <span>(${fa(p.reviews)} بررسی)</span></div><hr><div class="choice"><b>حافظه</b><div class="pills">${storageOptions.map((value) => { const v = ps.find((x) => x.storage === value); return v ? `<a class="${v.id === p.id ? 'active' : ''}" href="/product/${v.slug}" data-route="/product/${v.slug}">${value >= 1024 ? '1TB' : `${fa(value)}GB`}</a>` : ''; }).join('')}</div></div><div class="choice"><b>RAM</b><div class="pills">${ramOptions.map((value) => { const v = ps.find((x) => x.ram === value); return v ? `<a class="${v.id === p.id ? 'active' : ''}" href="/product/${v.slug}" data-route="/product/${v.slug}">${fa(value)}GB</a>` : ''; }).join('')}</div></div><div class="choice"><b>رنگ: ${esc(pcolor(p)?.nameFa || '')}</b><div class="colors">${colorOptions.map((id) => { const v = ps.find((x) => x.colorId === id), c = pcolor({ colorId: id }); return v ? `<a class="${v.id === p.id ? 'active' : ''}" href="/product/${v.slug}" data-route="/product/${v.slug}" title="${esc(c?.nameFa || '')}"><i style="--dot:${esc(c?.hex || '#ddd')}"></i></a>` : ''; }).join('')}</div></div><div class="price-box"><span>قیمت Variant</span><strong>${money(p.price)}</strong>${p.oldPrice ? `<del>${money(p.oldPrice)}</del>` : ''}</div><div class="stock"><i></i><b>${p.stock > 0 ? 'موجود' : 'ناموجود'}</b><span>${esc(p.delivery || '')} · ${esc(p.warranty || '')}</span></div><button class="button dark full" data-action="add-cart" data-id="${esc(p.id)}" ${p.stock > 0 ? '' : 'disabled'}>افزودن به سبد ${ic('arr')}</button><div class="two-buttons"><button class="button" data-action="wish" data-id="${esc(p.id)}">${wish().includes(p.id) ? 'حذف از علاقه‌مندی' : 'افزودن به علاقه‌مندی'}</button><button class="button" data-action="compare" data-id="${esc(p.id)}">${cmp().includes(p.id) ? 'در مقایسه هست' : 'افزودن به مقایسه'}</button></div></div></div><div class="detail-section"><span class="eyebrow">KEY SPECS</span><h2>مشخصات کلیدی</h2><div class="spec-grid">${[['RAM', `${fa(p.ram)}GB`], ['Storage', p.storage >= 1024 ? '1TB' : `${fa(p.storage)}GB`], ['Display', p.specs.display], ['Camera', p.specs.camera], ['Chip', p.specs.chip], ['Battery', p.specs.battery]].map(([k, v]) => `<div><small>${esc(k)}</small><b>${esc(v)}</b></div>`).join('')}</div></div><div class="detail-section"><span class="eyebrow">VARIANTS</span><h2>Variantهای این مدل</h2><div class="variant-list">${ps.map((x) => `<a class="${x.id === p.id ? 'active' : ''}" href="/product/${x.slug}" data-route="/product/${x.slug}"><span>${fa(x.ram)}GB / ${x.storage >= 1024 ? '1TB' : `${fa(x.storage)}GB`}</span><span><i class="dot" style="--dot:${esc(pcolor(x)?.hex || '#ddd')}"></i>${esc(pcolor(x)?.nameFa || '')}</span><b>${money(x.price)}</b></a>`).join('')}</div></div>`, 'product');
}

function comparePage() {
  const ps = cmp().map(getProduct).filter(Boolean);
  const rows = [['برند', (p) => brand(p)?.nameFa], ['سری', (p) => serie(p)?.nameFa], ['مدل', (p) => model(p)?.nameFa], ['RAM', (p) => `${fa(p.ram)}GB`], ['حافظه', (p) => p.storage >= 1024 ? '1TB' : `${fa(p.storage)}GB`], ['نمایشگر', (p) => p.specs.display], ['دوربین', (p) => p.specs.camera], ['پردازنده', (p) => p.specs.chip], ['باتری', (p) => p.specs.battery], ['قیمت', (p) => money(p.price)]];
  pageMeta('مقایسه', 'مقایسه محصولات موبایل در Mobilex.');
  return page(`${breadcrumbs([{ label: 'مقایسه' }])}<div class="page-hero"><div><span class="eyebrow">COMPARE</span><h1>کنار هم ببین.</h1><p>تا ۴ محصول را در یک نگاه مقایسه کن.</p></div></div>${ps.length ? `<div class="compare-wrap"><table><thead><tr><th>مشخصه</th>${ps.map((p) => `<th>${esc(model(p)?.nameFa || p.titleFa)}<button class="filter-clear" data-action="compare-remove" data-id="${esc(p.id)}">حذف</button></th>`).join('')}</tr></thead><tbody>${rows.map(([key, fn]) => `<tr><th>${esc(key)}</th>${ps.map((p) => `<td>${esc(fn(p) || '—')}</td>`).join('')}</tr>`).join('')}</tbody></table></div><button class="button" data-action="clear-compare">خالی کردن مقایسه</button>` : '<div class="empty"><h2>هنوز محصولی برای مقایسه انتخاب نشده.</h2><a class="button dark" href="/products" data-route="/products">رفتن به کاتالوگ</a></div>'}`, 'compare');
}

function wishlistPage() {
  const ps = wish().map(getProduct).filter(Boolean);
  pageMeta('علاقه‌مندی‌ها', 'محصولات ذخیره‌شده در Mobilex.');
  return page(`${breadcrumbs([{ label: 'علاقه‌مندی‌ها' }])}<div class="page-hero"><div><span class="eyebrow">WISHLIST</span><h1>ذخیره‌های تو.</h1><p>${fa(ps.length)} محصول ذخیره شده.</p></div></div><div class="product-grid">${ps.map(productCard).join('') || '<div class="empty">هنوز محصولی ذخیره نکرده‌ای.</div>'}</div>`);
}

function totals() {
  const items = cart().map((entry) => ({ entry, product: getProduct(entry.productId) })).filter((x) => x.product);
  const subtotal = items.reduce((sum, x) => sum + x.product.price * x.entry.qty, 0);
  const rules = coupons();
  const rule = rules.find((x) => x.code === coupon()?.code);
  let discount = 0;
  if (rule && subtotal >= Number(rule.min || 0)) {
    discount = rule.kind === 'percent'
      ? Math.min(Math.round(subtotal * rule.value / 100), Number(rule.max || Number.MAX_SAFE_INTEGER))
      : Math.min(Number(rule.value || 0), Number(rule.max || Number.MAX_SAFE_INTEGER));
  }
  const ship = activeShipping().find((x) => x.id === state.selectedShipping) || activeShipping()[0] || { price: 0 };
  return { items, subtotal, discount, shipping: ship.price, total: Math.max(0, subtotal - discount + ship.price), rule };
}

function cartPage() {
  const t = totals();
  pageMeta('سبد خرید', 'سبد خرید Mobilex.');
  return page(`${breadcrumbs([{ label: 'سبد خرید' }])}<div class="page-hero"><div><span class="eyebrow">CART</span><h1>سبد خرید.</h1><p>${t.items.length ? `${fa(t.items.length)} آیتم آماده Checkout.` : 'سبدت خالی است.'}</p></div></div>${t.items.length ? `<div class="cart-layout"><div class="cart-list">${t.items.map((x) => `<article class="cart-item">${phoneArt(x.product)}<div><strong>${esc(x.product.titleFa)}</strong><small>${fa(x.product.ram)}GB · ${x.product.storage >= 1024 ? '1TB' : `${fa(x.product.storage)}GB`}</small><b>${money(x.product.price)}</b></div><div class="qty"><button data-cart-minus="${esc(x.product.id)}">−</button><span>${fa(x.entry.qty)}</span><button data-cart-plus="${esc(x.product.id)}">+</button></div><button class="filter-clear" data-cart-remove="${esc(x.product.id)}">حذف</button></article>`).join('')}</div><aside class="summary"><span class="eyebrow">SUMMARY</span><h2>خلاصه سفارش</h2><div><span>مجموع</span><b>${money(t.subtotal)}</b></div><div><span>تخفیف</span><b>${t.discount ? `− ${money(t.discount)}` : '—'}</b></div><div><span>ارسال</span><b>${money(t.shipping)}</b></div><hr><div><strong>قابل پرداخت</strong><strong>${money(t.total)}</strong></div>${t.rule ? `<span class="coupon-active">${esc(t.rule.code)} فعال است</span>` : ''}<a class="button dark full" href="/checkout" data-route="/checkout">ادامه Checkout ${ic('arr')}</a><button class="button full" data-action="coupon">اعمال کد تخفیف</button></aside></div>` : '<div class="empty"><a class="button dark" href="/products" data-route="/products">رفتن به محصولات</a></div>`, 'cart');
}

function accountPage() {
  const u = user();
  pageMeta('حساب کاربری', 'حساب کاربری Mobilex.');
  if (!u) {
    const connected = remoteState.configured;
    return page(`${breadcrumbs([{ label: 'حساب' }])}<div class="login-box"><span class="eyebrow">${connected ? 'SUPABASE AUTH' : 'LOCAL DEMO'}</span><h1>حساب کاربری.</h1><p>${connected ? 'با ایمیل و رمز عبور وارد شو یا حساب جدید بساز.' : 'برای مشاهده جریان محلی می‌توانی با حساب آزمایشی وارد شوی.'}</p>${connected ? `<div class="auth-grid"><form id="account-login-form" class="auth-card"><h2>ورود</h2><label>ایمیل<input name="email" type="email" autocomplete="email" required placeholder="you@example.com"></label><label>رمز عبور<input name="password" type="password" autocomplete="current-password" required></label><button class="button dark full" type="submit">ورود</button></form><form id="account-signup-form" class="auth-card"><h2>ساخت حساب</h2><label>نام<input name="name" autocomplete="name" required></label><label>ایمیل<input name="email" type="email" autocomplete="email" required></label><label>تلفن<input name="phone" autocomplete="tel"></label><label>رمز عبور<input name="password" type="password" minlength="6" autocomplete="new-password" required></label><button class="button full" type="submit">ثبت‌نام</button></form></div>` : `<button class="button dark" data-action="login-demo">ورود آزمایشی ${ic('arr')}</button>`}</div>`, 'account');
  }
  const adminLabel = ['admin', 'manager'].includes(remoteState.role) ? 'مدیریت' : '';
  const notificationCount = remoteState.configured ? remoteState.notifications.filter((n) => !n.read_at).length : 2;
  return page(`${breadcrumbs([{ label: 'حساب' }])}<div class="page-hero"><div><span class="eyebrow">ACCOUNT / ${esc(remoteState.role.toUpperCase())}</span><h1>${esc(u.name)}.</h1><p>${esc(u.email)}</p></div><button class="button" data-action="logout">خروج</button></div><div class="account-cards"><a href="/orders" data-route="/orders"><span>سفارش‌ها</span><strong>${fa(orders().length)}</strong></a><a href="/wishlist" data-route="/wishlist"><span>علاقه‌مندی</span><strong>${fa(wish().length)}</strong></a><a href="/compare" data-route="/compare"><span>مقایسه</span><strong>${fa(cmp().length)}</strong></a><a href="/account/addresses" data-route="/account/addresses"><span>آدرس‌ها</span><strong>${fa(addresses().length)}</strong></a><a href="/notifications" data-route="/notifications"><span>اعلان‌های جدید</span><strong>${fa(notificationCount)}</strong></a>${adminLabel ? `<a href="/admin" data-route="/admin"><span>${adminLabel}</span><strong>↗</strong></a>` : ''}</div>`, 'account');
}

function addressesPage() {
  if (!user()) return accountPage();
  return page(`${breadcrumbs([{ label: 'حساب', href: '/account' }, { label: 'آدرس‌ها' }])}<div class="page-hero"><div><span class="eyebrow">ADDRESSES</span><h1>آدرس‌ها.</h1><p>مقصد Checkout را انتخاب کن.</p></div></div><div class="address-list">${addresses().map((a) => `<article class="address"><div><span class="eyebrow">${a.default ? 'DEFAULT' : 'ADDRESS'}</span><h2>${esc(a.title)}</h2><p>${esc(a.receiver)} · ${esc(a.phone)}</p><p>${esc(a.city)} · ${esc(a.detail)}</p><small>${esc(a.postal)}</small></div>${a.default ? '<span class="pill">پیش‌فرض</span>' : `<button class="text-action" data-default-address="${esc(a.id)}">انتخاب</button>`}</article>`).join('')}</div>`, 'addresses');
}

function ordersPage() {
  const list = orders();
  pageMeta('سفارش‌ها', 'سفارش‌های Mobilex.');
  return page(`${breadcrumbs([{ label: 'سفارش‌ها' }])}<div class="page-hero"><div><span class="eyebrow">ORDERS</span><h1>سفارش‌ها.</h1><p>${fa(list.length)} سفارش نمایشی.</p></div></div><div class="order-list">${list.map((o) => { const p = getProduct(o.items[0]?.productId), st = statusMap[o.status] || statusMap.pending; return `<a class="order" href="/order/${encodeURIComponent(o.id)}" data-route="/order/${encodeURIComponent(o.id)}"><div><span class="eyebrow">${esc(o.orderNumber || o.id)}</span><h2>${esc(p?.titleFa || 'سفارش')}</h2><small>${esc(o.date)} · ${esc(st.label)}</small></div><b>${money(o.total)}</b></a>`; }).join('')}</div>`, 'orders');
}

function orderPage(id) {
  const o = orders().find((x) => x.id === id);
  if (!o) return page('<div class="empty">سفارش پیدا نشد.</div>');
  const st = statusMap[o.status] || statusMap.pending;
  const a = addresses().find((x) => x.id === o.addressId), s = activeShipping().find((x) => x.id === o.shippingId);
  pageMeta(`سفارش ${o.id}`, `جزئیات سفارش ${o.id} در Mobilex.`);
  return page(`${breadcrumbs([{ label: 'سفارش‌ها', href: '/orders' }, { label: o.id }])}<div class="order-detail-head"><div><span class="eyebrow">${esc(o.id)}</span><h1>جزئیات سفارش.</h1><p>${esc(o.date)} · ${esc(st.label)}</p></div><strong>${money(o.total)}</strong></div><div class="progress"><span style="width:${st.p}%"></span></div><div class="progress-labels"><span>ثبت</span><span>پرداخت</span><span>آماده‌سازی</span><span>ارسال</span><span>تحویل</span></div><div class="order-grid"><section>${o.items.map((item) => { const p = getProduct(item.productId); return `<article class="order-item">${phoneArt(p)}<div><strong>${esc(p?.titleFa || 'محصول')}</strong><small>${fa(item.qty)} عدد · ${money(p?.price || 0)}</small></div></article>`; }).join('')}</section><aside class="order-side"><div><span class="eyebrow">DELIVERY</span><b>${esc(s?.title || '')}</b><small>${esc(s?.detail || '')}</small></div><div><span class="eyebrow">ADDRESS</span><b>${esc(a?.title || '')}</b><small>${esc(a?.city || '')} · ${esc(a?.detail || '')}</small></div><div><span class="eyebrow">TRACKING</span><b>${esc(o.tracking || '')}</b><small>${remoteLoggedIn() ? 'شناسه پیگیری سفارش' : 'شناسه پیگیری نمایشی'}</small></div>${['pending','paid','processing'].includes(o.status) ? `<button class="button danger" data-action="cancel-order" data-id="${esc(o.id)}">لغو سفارش</button>` : ''}</aside></div>`, 'order-detail');
}

function checkoutPage() {
  const t = totals();
  if (!t.items.length) return page('<div class="empty">سبد خرید خالی است.</div>');
  const stepLabels = ['گیرنده', 'ارسال', 'پرداخت', 'تأیید'];
  pageMeta('Checkout', 'تکمیل سفارش در Mobilex.');
  return page(`${breadcrumbs([{ label: 'سبد', href: '/cart' }, { label: 'Checkout' }])}<div class="page-hero"><div><span class="eyebrow">CHECKOUT</span><h1>خرید را کامل کن.</h1><p>Checkout چهارمرحله‌ای فاز ۵.</p></div></div><div class="checkout-steps">${stepLabels.map((label, index) => `<button class="${state.checkoutStep === index + 1 ? 'active' : ''}" data-step="${index + 1}"><span>${fa(index + 1)}</span>${label}</button>`).join('')}</div><div class="checkout-layout"><div>${checkoutContent(t)}</div><aside class="summary"><span class="eyebrow">SUMMARY</span><h2>خلاصه</h2>${t.items.map((x) => `<div><span>${esc(x.product.titleFa)} × ${fa(x.entry.qty)}</span><b>${money(x.product.price * x.entry.qty)}</b></div>`).join('')}<hr><div><strong>مبلغ نهایی</strong><strong>${money(t.total)}</strong></div></aside></div>`, 'checkout');
}

function checkoutContent(t) {
  if (!user()) {
    return `<section class="checkout-card"><span class="eyebrow">ACCOUNT REQUIRED</span><h2>اول وارد حساب شو.</h2><p class="notice">برای ثبت سفارش، ورود کاربر را فعال کن.</p><a class="button dark" href="/account" data-route="/account">ورود به حساب</a></section>`;
  }
  if (state.checkoutStep === 1) return `<section class="checkout-card"><span class="eyebrow">01 / ADDRESS</span><h2>آدرس گیرنده</h2><div class="choice-list">${addresses().map((a) => `<label class="${a.id === state.selectedAddress ? 'active' : ''}"><input type="radio" name="addr" value="${esc(a.id)}" ${a.id === state.selectedAddress ? 'checked' : ''}><span><b>${esc(a.title)}</b><small>${esc(a.city)} · ${esc(a.detail)}</small></span></label>`).join('')}</div><button class="button dark" data-action="checkout-next">ادامه</button></section>`;
  if (state.checkoutStep === 2) return `<section class="checkout-card"><span class="eyebrow">02 / SHIPPING</span><h2>روش ارسال</h2><div class="choice-list">${activeShipping().map((s) => `<label class="${s.id === state.selectedShipping ? 'active' : ''}"><input type="radio" name="ship" value="${esc(s.id)}" ${s.id === state.selectedShipping ? 'checked' : ''}><span><b>${esc(s.title)}</b><small>${esc(s.detail)}</small></span><b>${s.price ? money(s.price) : 'رایگان'}</b></label>`).join('')}</div><div class="checkout-actions"><button class="button" data-action="checkout-back">بازگشت</button><button class="button dark" data-action="checkout-next">ادامه</button></div></section>`;
  if (state.checkoutStep === 3) return `<section class="checkout-card"><span class="eyebrow">03 / PAYMENT</span><h2>پرداخت آنلاین</h2><div class="payment-demo"><b>DEMO PAYMENT</b><span>در فاز نهایی به درگاه واقعی متصل می‌شود.</span></div><div class="notice">هیچ تراکنش مالی واقعی در این فاز انجام نمی‌شود.</div><div class="checkout-actions"><button class="button" data-action="checkout-back">بازگشت</button><button class="button dark" data-action="checkout-next">ادامه</button></div></section>`;
  return `<section class="checkout-card"><span class="eyebrow">04 / REVIEW</span><h2>تأیید نهایی</h2><div class="review"><div><span>آدرس</span><b>${esc(addresses().find((a) => a.id === state.selectedAddress)?.detail || '')}</b></div><div><span>ارسال</span><b>${esc(activeShipping().find((s) => s.id === state.selectedShipping)?.title || '')}</b></div><div><span>مبلغ</span><b>${money(t.total)}</b></div></div><div class="checkout-actions"><button class="button" data-action="checkout-back">بازگشت</button><button class="button dark" data-action="place-order">ثبت سفارش ${ic('arr')}</button></div></section>`;
}

function successPage(id) {
  const found = orders().find((o) => o.id === id);
  const label = found?.orderNumber || id;
  pageMeta('ثبت سفارش', 'سفارش شما در Mobilex ثبت شد.');
  return page(`${breadcrumbs([{ label: 'تأیید سفارش' }])}<div class="success"><span>✓</span><span class="eyebrow">ORDER CONFIRMED</span><h1>سفارشت ثبت شد.</h1><p>شماره سفارش <b dir="ltr">${esc(label)}</b></p><a class="button dark" href="/order/${encodeURIComponent(id)}" data-route="/order/${encodeURIComponent(id)}">پیگیری سفارش</a><a class="button" href="/products" data-route="/products">ادامه خرید</a></div>`, 'success');
}

function notificationsPage() {
  const rows = remoteState.configured && remoteLoggedIn() ? remoteState.notifications : [];
  if (remoteState.configured && remoteLoggedIn()) {
    pageMeta('اعلان‌ها', 'اعلان‌های حساب Mobilex.');
    return page(`${breadcrumbs([{ label: 'اعلان‌ها' }])}<div class="page-hero"><div><span class="eyebrow">NOTIFICATIONS</span><h1>اعلان‌ها.</h1><p>${fa(rows.length)} اعلان.</p></div></div><div class="notifications">${rows.map((n) => `<article class="${n.read_at ? '' : 'unread'}"><b>${esc(n.title)}</b><p>${esc(n.body)}</p><small>${new Date(n.created_at).toLocaleString('fa-IR')}</small></article>`).join('') || '<div class="empty">اعلانی نداریم.</div>'}</div>`, 'notifications');
  }
  return page(`${breadcrumbs([{ label: 'اعلان‌ها' }])}<div class="page-hero"><div><span class="eyebrow">NOTIFICATIONS</span><h1>اعلان‌ها.</h1><p>نمونه اعلان‌های محلی.</p></div></div><div class="notifications"><article><b>سفارش ارسال شد</b><p>آخرین وضعیت سفارش‌ها را از صفحه پیگیری ببین.</p><small>امروز · ۱۰:۴۲</small></article><article><b>پیشنهاد ویژه</b><p>برای چند Variant منتخب تخفیف در نظر گرفته شده.</p><small>دیروز · ۱۸:۲۰</small></article></div>`, 'notifications');
}

function guidesPage() {
  return page(`${breadcrumbs([{ label: 'راهنمای خرید' }])}<div class="page-hero"><div><span class="eyebrow">GUIDES</span><h1>راهنمای خرید.</h1><p>چند راهنمای کوتاه برای تصمیم بهتر.</p></div></div><div class="guide-grid">${guides.map((g) => `<article><span>${esc(g.id)}</span><h2>${esc(g.title)}</h2><p>${esc(g.text)}</p><a class="text-action" href="/products" data-route="/products">کاتالوگ ${ic('arr')}</a></article>`).join('')}</div>`, 'guides');
}

function route() {
  const path = location.pathname.replace(/\/+$/, '') || '/';
  if (path === '/') return home();
  if (path === '/brands') return brandsPage();
  if (path === '/products' || path === '/deals') return productsPage();
  if (path === '/compare') return comparePage();
  if (path === '/wishlist') return wishlistPage();
  if (path === '/cart') return cartPage();
  if (path === '/checkout') return checkoutPage();
  if (path === '/account') return accountPage();
  if (path === '/account/addresses') return addressesPage();
  if (path === '/orders') return ordersPage();
  if (path === '/notifications') return notificationsPage();
  if (path === '/guides') return guidesPage();
  if (path === '/admin' || path.startsWith('/admin/')) return adminRoute(path);
  if (path.startsWith('/brand/')) return brandPage(path.split('/')[2]);
  if (path.startsWith('/series/')) return seriesPage(path.split('/')[2]);
  if (path.startsWith('/product/')) return productPage(path.split('/')[2]);
  if (path.startsWith('/order-success/')) return successPage(decodeURIComponent(path.split('/order-success/')[1] || ''));
  if (path.startsWith('/order/')) return orderPage(decodeURIComponent(path.split('/order/')[1] || ''));
  pageMeta('404', 'صفحه مورد نظر پیدا نشد.');
  return page('<div class="empty"><h2>صفحه پیدا نشد.</h2><a class="button dark" href="/" data-route="/">بازگشت به خانه</a></div>');
}

function go(href, replace = false) {
  const url = new URL(href, location.origin);
  const target = `${url.pathname}${url.search}${url.hash}`;
  if (replace) history.replaceState({}, '', target); else history.pushState({}, '', target);
  $('#mobile-menu').hidden = true;
  render();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function render() {
  syncPath();
  const app = $('#app');
  try {
    app.innerHTML = route();
  } catch (error) {
    console.error(error);
    pageMeta('خطا', 'خطای موقت در Mobilex.');
    app.innerHTML = `<div class="container"><div class="empty"><h2>یک خطای موقت رخ داد.</h2><p>صفحه را دوباره باز کن.</p><button class="button dark" data-action="reload">تلاش دوباره</button></div></div>`;
  }
  bind();
  syncCounts();
  renderCompareBar();
  activeNav();
  syncAdminNav();
}

function activeNav() {
  $$('[data-route]').forEach((a) => {
    const target = (a.dataset.route || '').split('?')[0].replace(/\/$/, '') || '/';
    a.classList.toggle('active', target === state.path || (target !== '/' && state.path.startsWith(target)));
  });
}

function syncCounts() {
  const fav = $('#fav-count'), count = $('#cart-count');
  if (fav) fav.textContent = fa(wish().length);
  if (count) count.textContent = fa(cartQty());
}

function syncAdminNav() {
  const active = Boolean(adminSession()?.active);
  const desktop = $('#admin-nav');
  const mobile = $('#admin-mobile-nav');
  if (desktop) desktop.hidden = !active;
  if (mobile) mobile.hidden = !active;
}

async function toggleWish(id) {
  const list = wish().slice();
  const index = list.indexOf(id);
  if (index >= 0) list.splice(index, 1); else list.push(id);
  write(K.wish, list);
  remoteState.wishlistIds = remoteLoggedIn() ? list : remoteState.wishlistIds;
  if (remoteLoggedIn()) {
    try {
      const p = getProduct(id);
      if (!p?.offerId) throw new Error('Offer محصول پیدا نشد.');
      await SB.toggleRemoteRelation(remoteUserId(), 'wishlist_items', p.offerId, index < 0);
    } catch (error) {
      toast(error.message || 'علاقه‌مندی ذخیره نشد.');
    }
  }
  render();
}

async function toggleCompare(id) {
  const list = cmp().slice();
  const index = list.indexOf(id);
  if (index >= 0) list.splice(index, 1);
  else {
    if (list.length >= 4) return toast('مقایسه حداکثر ۴ محصول دارد.');
    list.push(id);
  }
  write(K.compare, list);
  remoteState.compareIds = remoteLoggedIn() ? list : remoteState.compareIds;
  if (remoteLoggedIn()) {
    try {
      const p = getProduct(id);
      if (!p?.offerId) throw new Error('Offer محصول پیدا نشد.');
      await SB.toggleRemoteRelation(remoteUserId(), 'compare_items', p.offerId, index < 0);
    } catch (error) {
      toast(error.message || 'مقایسه ذخیره نشد.');
    }
  }
  render();
}

async function addCart(id) {
  const p = getProduct(id);
  if (!p || p.stock <= 0) return toast('این Variant موجود نیست.');
  const list = cart().slice();
  const item = list.find((x) => x.productId === id);
  if (item) item.qty = Math.min(Number(item.qty) + 1, Number(p.stock));
  else list.push({ productId: id, qty: 1 });
  write(K.cart, list);
  syncCounts();
  if (remoteLoggedIn()) {
    try { await SB.setRemoteCartItem(remoteUserId(), p.offerId, item ? item.qty : 1); }
    catch (error) { toast(error.message || 'سبد آنلاین به‌روزرسانی نشد.'); }
  }
  toast('به سبد اضافه شد.');
}

async function updateCart(id, delta) {
  const list = cart().slice();
  const item = list.find((x) => x.productId === id);
  if (!item) return;
  const product = getProduct(id);
  item.qty = Math.max(0, Math.min(Number(item.qty) + delta, Number(product?.stock || 0)));
  const next = list.filter((x) => x.qty > 0);
  write(K.cart, next);
  if (remoteLoggedIn() && product?.offerId) {
    try { await SB.setRemoteCartItem(remoteUserId(), product.offerId, item.qty); }
    catch (error) { toast(error.message || 'سبد آنلاین به‌روزرسانی نشد.'); }
  }
  render();
}

async function removeCart(id) {
  const p = getProduct(id);
  write(K.cart, cart().filter((x) => x.productId !== id));
  if (remoteLoggedIn() && p?.offerId) {
    try { await SB.setRemoteCartItem(remoteUserId(), p.offerId, 0); }
    catch (error) { toast(error.message || 'حذف از سبد آنلاین ناموفق بود.'); }
  }
  render();
}

async function placeOrder() {
  const currentUser = user();
  const t = totals();
  if (!currentUser || !t.items.length) return toast('سبد یا حساب کاربری آماده نیست.');
  if (remoteLoggedIn()) {
    if (!state.selectedAddress) return toast('یک آدرس انتخاب کن.');
    try {
      const result = await SB.createOrder(remoteUserId(), {
        addressId: state.selectedAddress,
        shippingMethodId: state.selectedShipping,
        items: t.items.map((x) => ({ offer_id: x.product.offerId, qty: Number(x.entry.qty) })),
        couponCode: t.rule?.code || null
      });
      const orderId = result?.id;
      if (!orderId) throw new Error('Supabase سفارش را برنگرداند.');
      write(K.cart, []);
      localStorage.removeItem(K.coupon);
      await hydrateRemoteUser();
      go(`/order-success/${encodeURIComponent(orderId)}`);
      toast('سفارش با موفقیت ثبت شد.');
      return;
    } catch (error) {
      console.error(error);
      toast(error.message || 'ثبت سفارش ناموفق بود.');
      return;
    }
  }

  const orderId = `MX-${new Date().getFullYear()}-${String(Date.now()).slice(-7)}`;
  const order = {
    id: orderId,
    date: 'امروز',
    status: 'paid',
    total: t.total,
    items: t.items.map((x) => ({ productId: x.entry.productId, qty: x.entry.qty })),
    addressId: state.selectedAddress,
    shippingId: state.selectedShipping,
    tracking: `MXTRK-${String(Date.now()).slice(-6)}`
  };
  write(K.orders, [order, ...orders()]);
  db.variants = db.variants.map((variant) => {
    const entry = t.items.find((x) => x.entry.productId === variant.id);
    return entry ? { ...variant, stock: Math.max(0, Number(variant.stock) - Number(entry.entry.qty)) } : variant;
  });
  persistCatalog();
  write(K.cart, []);
  localStorage.removeItem(K.coupon);
  go(`/order-success/${encodeURIComponent(orderId)}`);
}

function couponModal() {
  const list = coupons();
  openModal(`<div class="modal-card"><button class="icon-btn close" data-action="modal-close">×</button><span class="eyebrow">COUPON</span><h2>کد تخفیف</h2><div class="coupon-list">${list.filter((x) => x.active !== false).map((c) => `<button data-coupon="${esc(c.code)}"><b>${esc(c.code)}</b><span>${esc(c.label || '')}</span></button>`).join('')}</div>${coupon() ? '<button class="filter-clear" data-action="clear-coupon">حذف کد فعال</button>' : ''}</div>`);
  bind();
}

function applyCoupon(code) {
  const c = coupons().find((x) => x.code === code && x.active !== false);
  const t = totals();
  if (!c) return toast('کد نامعتبر است.');
  if (t.subtotal < Number(c.min || 0)) return toast(`حداقل سبد ${money(c.min)} است.`);
  write(K.coupon, { code: c.code });
  closeModal();
  render();
  toast('کد تخفیف اعمال شد.');
}

function openModal(html) {
  const modal = $('#modal-layer');
  modal.hidden = false;
  modal.innerHTML = `<div class="modal-backdrop" data-action="modal-close"></div>${html}`;
}

function closeModal() {
  const modal = $('#modal-layer');
  modal.hidden = true;
  modal.innerHTML = '';
}

function quick(id) {
  const p = getProduct(id);
  if (!p) return;
  openModal(`<section class="modal-card quick"><button class="icon-btn close" data-action="modal-close">×</button><div>${phoneArt(p, true)}</div><div><span class="eyebrow">${esc(brand(p)?.nameEn || '')}</span><h2>${esc(model(p)?.nameFa || p.titleFa)}</h2><p>${fa(p.ram)}GB · ${p.storage >= 1024 ? '1TB' : `${fa(p.storage)}GB`} · ${esc(pcolor(p)?.nameFa || '')}</p><strong>${money(p.price)}</strong><div class="hero-actions"><a class="button dark" href="/product/${esc(p.slug)}" data-route="/product/${esc(p.slug)}">صفحه محصول</a><button class="button" data-action="add-cart" data-id="${esc(p.id)}">افزودن به سبد</button></div></div></section>`);
  bind();
}

function openSearch() {
  $('#search-drawer').hidden = false;
  document.body.classList.add('search-open');
  requestAnimationFrame(() => {
    $('#global-search')?.focus();
    searchRender(state.search);
  });
}

function closeSearch() {
  document.body.classList.remove('search-open');
  $('#search-drawer').hidden = true;
}

function searchRender(query) {
  const value = query.trim().toLowerCase();
  const meta = $('#search-meta');
  const results = $('#search-results');
  if (!value) {
    meta.textContent = 'محبوب‌ها را سریع پیدا کن';
    results.innerHTML = `<div class="search-quick">${db.brands.slice(0, 8).map((b) => `<button data-search="${esc(b.nameFa)}">${esc(b.nameFa)}</button>`).join('')}</div>`;
    bindSearchQuick();
    return;
  }
  const brandHits = db.brands.filter((b) => `${b.nameFa} ${b.nameEn}`.toLowerCase().includes(value)).slice(0, 4);
  const seriesHits = db.series.filter((s) => `${s.nameFa} ${s.nameEn}`.toLowerCase().includes(value)).slice(0, 4);
  const productHits = products.filter((p) => `${p.titleFa} ${p.titleEn} ${brand(p)?.nameFa || ''} ${serie(p)?.nameFa || ''}`.toLowerCase().includes(value)).slice(0, 7);
  meta.textContent = `${fa(brandHits.length + seriesHits.length + productHits.length)} نتیجه`;
  results.innerHTML = `${brandHits.length ? `<div class="search-group"><span class="eyebrow">BRANDS</span>${brandHits.map((b) => `<a class="search-row" href="/brand/${esc(b.slug)}" data-route="/brand/${esc(b.slug)}">${brandMark(b)}<span><b>${esc(b.nameFa)}</b><small>${esc(b.nameEn)}</small></span>${ic('arr')}</a>`).join('')}</div>` : ''}${seriesHits.length ? `<div class="search-group"><span class="eyebrow">SERIES</span>${seriesHits.map((s) => `<a class="search-row" href="/series/${esc(s.slug)}" data-route="/series/${esc(s.slug)}"><b class="search-letter">${esc(s.nameEn?.[0] || 'S')}</b><span><b>${esc(s.nameFa)}</b><small>${esc(s.nameEn)}</small></span>${ic('arr')}</a>`).join('')}</div>` : ''}${productHits.length ? `<div class="search-group"><span class="eyebrow">PRODUCTS</span>${productHits.map((p) => `<a class="search-row" href="/product/${esc(p.slug)}" data-route="/product/${esc(p.slug)}">${phoneArt(p)}<span><b>${esc(p.titleFa)}</b><small>${money(p.price)}</small></span>${ic('arr')}</a>`).join('')}</div>` : '<div class="empty">نتیجه‌ای پیدا نشد.</div>'}`;
}

function bindSearchQuick() {
  $$('#search-results [data-search]').forEach((el) => el.addEventListener('click', () => {
    state.search = el.dataset.search;
    $('#global-search').value = state.search;
    searchRender(state.search);
  }));
}

function renderCompareBar() {
  const list = cmp().map(getProduct).filter(Boolean);
  const bar = $('#compare-bar');
  if (!list.length) {
    bar.hidden = true;
    bar.innerHTML = '';
    return;
  }
  bar.hidden = false;
  bar.innerHTML = `<div class="container compare-bar-inner"><span><b>${fa(list.length)}</b> محصول</span><div>${list.map((p) => `<small>${esc(model(p)?.nameFa || p.titleFa)}</small>`).join('')}</div><a class="button dark" href="/compare" data-route="/compare">مقایسه</a></div>`;
  bind();
}

function applyFilters() {
  const url = new URL('/products', location.origin);
  Object.entries(state.filters).forEach(([key, value]) => { if (value) url.searchParams.set(key, value); });
  if (state.sort !== 'featured') url.searchParams.set('sort', state.sort);
  go(`${url.pathname}${url.search}`, true);
}

function toast(message) {
  const node = document.createElement('div');
  node.className = 'toast';
  node.textContent = message;
  document.body.appendChild(node);
  requestAnimationFrame(() => node.classList.add('show'));
  setTimeout(() => {
    node.classList.remove('show');
    setTimeout(() => node.remove(), 180);
  }, 1700);
}

/* ------------------------- ADMIN / PRODUCTION ------------------------- */

const ADMIN_TABS = [
  ['dashboard', 'داشبورد', '⌂'],
  ['brands', 'برندها', 'B'],
  ['series', 'سری‌ها', 'S'],
  ['models', 'مدل‌ها', 'M'],
  ['variants', 'Variantها', 'V'],
  ['inventory', 'موجودی', 'I'],
  ['orders', 'سفارش‌ها', 'O'],
  ['customers', 'مشتری‌ها', 'C'],
  ['coupons', 'کدهای تخفیف', '%'],
  ['content', 'محتوا', 'A'],
  ['analytics', 'تحلیل', '↗']
];

function adminRoute(path) {
  pageMeta('مدیریت Mobilex', 'پنل مدیریت محلی Mobilex.');
  if (!adminSession()?.active) return adminLoginPage();
  const tab = path.split('/')[2] || state.adminTab || 'dashboard';
  state.adminTab = ADMIN_TABS.some((x) => x[0] === tab) ? tab : 'dashboard';
  return adminPage(state.adminTab);
}

function adminLoginPage() {
  pageMeta('مدیریت Mobilex', 'ورود به پنل مدیریت Mobilex.');
  if (remoteState.configured) {
    return page(`${breadcrumbs([{ label: 'مدیریت' }])}<div class="admin-login"><span class="eyebrow">SUPABASE ADMIN</span><h1>پنل مدیریت.</h1><p>ورود مدیریت با حساب Supabase انجام می‌شود؛ نقش admin یا manager باید برای حساب ثبت شده باشد.</p><form id="admin-auth-form" class="admin-login-card"><label>ایمیل<input id="admin-email" name="email" type="email" autocomplete="email" required></label><label>رمز عبور<input id="admin-password" name="password" type="password" autocomplete="current-password" required></label><button class="button dark full" type="submit">ورود به مدیریت</button><small>PIN دمو در حالت Supabase غیرفعال است.</small></form></div>`, 'admin-page');
  }
  return page(`${breadcrumbs([{ label: 'مدیریت' }])}<div class="admin-login"><span class="eyebrow">LOCAL ADMIN</span><h1>پنل مدیریت.</h1><p>حالت محلی فاز ۵ فعال است.</p><div class="admin-login-card"><label>PIN آزمایشی<input id="admin-pin" inputmode="numeric" maxlength="4" placeholder="••••" type="password"></label><button class="button dark full" data-action="admin-login">ورود به پنل</button><small>PIN دمو: 2468</small></div></div>`, 'admin-page');
}

function adminPage(tab) {
  const sections = {
    dashboard: adminDashboard(),
    brands: adminEntityTable('brands', 'برندها', db.brands, ['nameFa', 'nameEn', 'slug']),
    series: adminEntityTable('series', 'سری‌ها', db.series, ['nameFa', 'nameEn', 'brandId']),
    models: adminEntityTable('models', 'مدل‌ها', db.models, ['nameFa', 'nameEn', 'brandId', 'seriesId']),
    variants: adminVariantTable(),
    inventory: adminInventory(),
    orders: adminOrders(),
    customers: adminCustomers(),
    coupons: adminCoupons(),
    content: adminContent(),
    analytics: adminAnalytics()
  }[tab] || adminDashboard();
  return page(`<div class="admin-shell"><aside class="admin-sidebar"><div class="admin-brand"><span class="brand-mark">M</span><div><b>Mobilex Admin</b><small>Phase 5</small></div></div>${ADMIN_TABS.map(([id, label, icon]) => `<a class="admin-tab ${id === tab ? 'active' : ''}" href="/admin/${id}" data-route="/admin/${id}"><span>${icon}</span>${label}</a>`).join('')}<button class="admin-tab danger" data-action="admin-logout"><span>×</span>خروج مدیریت</button></aside><div class="admin-main"><div class="admin-top"><div><span class="eyebrow">ADMIN / ${esc(tab.toUpperCase())}</span><h1>${esc(ADMIN_TABS.find((x) => x[0] === tab)?.[1] || 'داشبورد')}.</h1></div><div class="admin-top-actions">${remoteState.configured ? `<span class="pill">Supabase Connected</span>` : `<button class="button" data-action="admin-reset">ریست داده نمایشی</button>`}<a class="button dark" href="/" data-route="/">نمایش فروشگاه</a></div></div>${sections}</div></div>`, 'admin-page');
}

function adminDashboard() {
  const ordersList = orders();
  const totalSales = ordersList.filter((o) => o.status !== 'cancelled').reduce((sum, o) => sum + Number(o.total || 0), 0);
  const lowStock = products.filter((p) => Number(p.stock) <= 3).length;
  const customers = customerList().length;
  return `<div class="admin-kpis"><article><span>فروش ثبت‌شده</span><strong>${money(totalSales)}</strong><small>${remoteState.configured ? 'بر اساس سفارش‌های Supabase' : 'بر اساس سفارش‌های محلی'}</small></article><article><span>سفارش‌ها</span><strong>${fa(ordersList.length)}</strong><small>در وضعیت‌های مختلف</small></article><article><span>محصولات / Variant</span><strong>${fa(products.length)}</strong><small>از ساختار فعال کاتالوگ</small></article><article><span>موجودی کم</span><strong>${fa(lowStock)}</strong><small>۳ عدد یا کمتر</small></article><article><span>مشتری‌ها</span><strong>${fa(customers)}</strong><small>${remoteState.configured ? 'از پروفایل‌های Supabase' : 'از سفارش و حساب‌های محلی'}</small></article></div><div class="admin-dashboard-grid"><section class="admin-card"><div class="admin-card-head"><div><span class="eyebrow">RECENT ORDERS</span><h2>آخرین سفارش‌ها</h2></div><a href="/admin/orders" data-route="/admin/orders">همه ${ic('arr')}</a></div>${ordersList.slice(0, 5).map(orderAdminRow).join('')}</section><section class="admin-card"><div class="admin-card-head"><div><span class="eyebrow">LOW STOCK</span><h2>موجودی حساس</h2></div><a href="/admin/inventory" data-route="/admin/inventory">مدیریت ${ic('arr')}</a></div>${products.filter((p) => p.stock <= 3).slice(0, 5).map((p) => `<div class="admin-mini-row"><div>${phoneArt(p)}<span><b>${esc(p.titleFa)}</b><small>${esc(p.sku)}</small></span></div><strong>${fa(p.stock)} عدد</strong></div>`).join('') || '<p class="muted">موجودی کم نداریم.</p>'}</section></div><section class="admin-card production-check"><div class="admin-card-head"><div><span class="eyebrow">PRODUCTION CHECK</span><h2>وضعیت آماده‌سازی</h2></div></div><div class="check-grid"><span class="done">✓ ساختار ۷ فایل</span><span class="done">✓ SPA Routing</span><span class="done">✓ Local Commerce</span><span class="done">✓ Admin UI</span><span class="done">✓ SEO Meta</span><span class="done">✓ Error Fallback</span><span class="done">✓ Supabase Data Layer</span><span class="done">✓ Auth + RLS Ready</span><span>○ Payment Gateway</span></div></section>`;
}

function orderAdminRow(order) {
  const st = statusMap[order.status] || statusMap.pending;
  return `<div class="admin-table-row"><div><b>${esc(order.id)}</b><small>${esc(order.date)} · ${esc(st.label)}</small></div><strong>${money(order.total)}</strong><select data-admin-order-status="${esc(order.id)}"><option value="pending" ${order.status === 'pending' ? 'selected' : ''}>در انتظار پرداخت</option><option value="paid" ${order.status === 'paid' ? 'selected' : ''}>پرداخت موفق</option><option value="processing" ${order.status === 'processing' ? 'selected' : ''}>آماده‌سازی</option><option value="shipped" ${order.status === 'shipped' ? 'selected' : ''}>ارسال</option><option value="delivered" ${order.status === 'delivered' ? 'selected' : ''}>تحویل</option><option value="cancelled" ${order.status === 'cancelled' ? 'selected' : ''}>لغو</option></select></div>`;
}

function adminEntityTable(type, title, rows, fields) {
  const labels = { nameFa: 'نام فارسی', nameEn: 'نام انگلیسی', slug: 'Slug', brandId: 'Brand', seriesId: 'Series' };
  return `<section class="admin-card"><div class="admin-card-head"><div><span class="eyebrow">${esc(type.toUpperCase())}</span><h2>${esc(title)}</h2></div><button class="button dark" data-admin-add="${esc(type)}">+ افزودن</button></div><div class="admin-table-scroll"><table class="admin-table"><thead><tr><th>شناسه</th>${fields.map((f) => `<th>${esc(labels[f] || f)}</th>`).join('')}<th>عملیات</th></tr></thead><tbody>${rows.map((row) => `<tr><td><code>${esc(row.id)}</code></td>${fields.map((f) => `<td>${esc(displayAdminField(type, row, f))}</td>`).join('')}<td><button class="filter-clear" data-admin-edit="${esc(type)}" data-id="${esc(row.id)}">ویرایش</button><button class="filter-clear" data-admin-delete="${esc(type)}" data-id="${esc(row.id)}">حذف</button></td></tr>`).join('')}</tbody></table></div></section>`;
}

function displayAdminField(type, row, field) {
  if (field === 'brandId') return getBrand(row.brandId)?.nameFa || row.brandId;
  if (field === 'seriesId') return getSeries(row.seriesId)?.nameFa || row.seriesId;
  return row[field];
}

function adminVariantTable() {
  return `<section class="admin-card"><div class="admin-card-head"><div><span class="eyebrow">VARIANTS</span><h2>Variantها.</h2></div><button class="button dark" data-admin-add="variants">+ افزودن</button></div><div class="admin-table-scroll"><table class="admin-table"><thead><tr><th>SKU</th><th>مدل</th><th>RAM</th><th>حافظه</th><th>رنگ</th><th>قیمت</th><th>موجودی</th><th>عملیات</th></tr></thead><tbody>${db.variants.map((v) => `<tr><td><code>${esc(v.sku || '')}</code></td><td>${esc(getModel(v.modelId)?.nameFa || '')}</td><td>${fa(v.ram)}GB</td><td>${v.storage >= 1024 ? '1TB' : `${fa(v.storage)}GB`}</td><td>${esc(pcolor(v)?.nameFa || '')}</td><td>${money(v.price)}</td><td>${fa(v.stock)}</td><td><button class="filter-clear" data-admin-edit="variants" data-id="${esc(v.id)}">ویرایش</button><button class="filter-clear" data-admin-delete="variants" data-id="${esc(v.id)}">حذف</button></td></tr>`).join('')}</tbody></table></div></section>`;
}

function adminInventory() {
  const low = [...products].sort((a, b) => a.stock - b.stock);
  return `<section class="admin-card"><div class="admin-card-head"><div><span class="eyebrow">INVENTORY</span><h2>کنترل موجودی.</h2></div><span class="pill">${fa(low.filter((p) => p.stock <= 3).length)} حساس</span></div><div class="inventory-grid">${low.map((p) => `<article class="inventory-card"><div>${phoneArt(p)}<div><b>${esc(p.titleFa)}</b><small>${esc(p.sku)}</small></div></div><strong class="inventory-number ${p.stock <= 3 ? 'warn' : ''}">${fa(p.stock)}</strong><div class="inventory-actions"><button data-stock-step="${esc(p.id)}" data-delta="-1">−</button><button data-stock-step="${esc(p.id)}" data-delta="1">+</button><button data-stock-set="${esc(p.id)}">تعیین عدد</button></div></article>`).join('')}</div></section>`;
}

function adminOrders() {
  return `<section class="admin-card"><div class="admin-card-head"><div><span class="eyebrow">ORDERS</span><h2>مدیریت سفارش‌ها.</h2></div><span class="pill">${fa(orders().length)} سفارش</span></div><div class="admin-order-list">${orders().map(orderAdminRow).join('')}</div></section>`;
}

function customerList() {
  if (remoteState.configured && Array.isArray(remoteState.customers)) {
    return remoteState.customers.map((c) => ({
      name: c.display_name || 'کاربر Mobilex',
      email: c.email || '—',
      phone: c.phone || '—',
      orders: Number(c.order_count || 0),
      spent: Number(c.spent_toman || 0)
    }));
  }
  const map = new Map();
  const current = user();
  if (current) map.set(current.email, { ...current, orders: 0, spent: 0 });
  orders().forEach((o) => {
    const key = current?.email || 'demo@mobilex.local';
    const customer = map.get(key) || { name: 'کاربر Mobilex', email: key, phone: '—', orders: 0, spent: 0 };
    customer.orders += 1;
    customer.spent += Number(o.total || 0);
    map.set(key, customer);
  });
  return [...map.values()];
}

function adminCustomers() {
  const customers = customerList();
  return `<section class="admin-card"><div class="admin-card-head"><div><span class="eyebrow">CUSTOMERS</span><h2>مشتری‌ها.</h2></div><span class="pill">${fa(customers.length)} مشتری</span></div><div class="admin-table-scroll"><table class="admin-table"><thead><tr><th>نام</th><th>ایمیل</th><th>تلفن</th><th>سفارش</th><th>مجموع خرید</th></tr></thead><tbody>${customers.map((c) => `<tr><td>${esc(c.name)}</td><td dir="ltr">${esc(c.email)}</td><td dir="ltr">${esc(c.phone || '—')}</td><td>${fa(c.orders)}</td><td>${money(c.spent)}</td></tr>`).join('') || '<tr><td colspan="5">مشتری‌ای ثبت نشده است.</td></tr>'}</tbody></table></div></section>`;
}

function adminCoupons() {
  const list = coupons();
  return `<section class="admin-card"><div class="admin-card-head"><div><span class="eyebrow">COUPONS</span><h2>کدهای تخفیف.</h2></div><button class="button dark" data-admin-add="coupons">+ افزودن</button></div><div class="admin-table-scroll"><table class="admin-table"><thead><tr><th>کد</th><th>نوع</th><th>مقدار</th><th>حداقل</th><th>وضعیت</th><th>عملیات</th></tr></thead><tbody>${list.map((c) => `<tr><td><code>${esc(c.code)}</code></td><td>${c.kind === 'percent' ? 'درصدی' : 'ثابت'}</td><td>${c.kind === 'percent' ? `${fa(c.value)}٪` : money(c.value)}</td><td>${money(c.min || 0)}</td><td><span class="status-chip ${c.active === false ? 'off' : ''}">${c.active === false ? 'غیرفعال' : 'فعال'}</span></td><td><button class="filter-clear" data-admin-toggle-coupon="${esc(c.code)}">تغییر وضعیت</button><button class="filter-clear" data-admin-delete="coupons" data-id="${esc(c.code)}">حذف</button></td></tr>`).join('')}</tbody></table></div></section>`;
}

function adminContent() {
  const c = content();
  return `<section class="admin-card"><div class="admin-card-head"><div><span class="eyebrow">CONTENT</span><h2>محتوای اصلی.</h2></div>${remoteState.configured ? `<span class="pill">Supabase</span>` : `<span class="pill">Local Draft</span>`}</div><form id="content-form" class="admin-form-grid"><label>Eyebrow<input name="heroEyebrow" value="${esc(c.heroEyebrow)}"></label><label>عنوان Hero<textarea name="heroTitle" rows="2">${esc(c.heroTitle)}</textarea></label><label>متن Hero<textarea name="heroText" rows="4">${esc(c.heroText)}</textarea></label><label>عنوان Banner<input name="bannerTitle" value="${esc(c.bannerTitle)}"></label><label>متن Banner<textarea name="bannerText" rows="4">${esc(c.bannerText)}</textarea></label><div class="form-actions"><button class="button dark" type="submit">ذخیره محتوا</button><button class="button" type="button" data-action="content-reset">بازگشت به محتوای اصلی</button></div></form></section>`;
}

function adminAnalytics() {
  const list = orders().filter((o) => o.status !== 'cancelled');
  const revenue = list.reduce((sum, o) => sum + Number(o.total || 0), 0);
  const average = list.length ? Math.round(revenue / list.length) : 0;
  const statusEntries = Object.entries(statusMap).map(([key, meta]) => ({ key, label: meta.label, count: orders().filter((o) => o.status === key).length })).filter((x) => x.count);
  return `<section class="admin-card"><div class="admin-card-head"><div><span class="eyebrow">ANALYTICS</span><h2>تحلیل ساده فروش.</h2></div>${remoteState.configured ? `<span class="pill">Supabase</span>` : `<span class="pill">Local data</span>`}</div><div class="analytics-kpis"><div><span>Revenue</span><b>${money(revenue)}</b></div><div><span>Average order</span><b>${money(average)}</b></div><div><span>Best selling</span><b>${esc(bestSellingName())}</b></div></div><div class="analytics-bars">${statusEntries.map((s) => `<div><span>${esc(s.label)}</span><i><b style="width:${Math.min(100, s.count / Math.max(1, orders().length) * 100)}%"></b></i><strong>${fa(s.count)}</strong></div>`).join('')}</div><div class="notice">آمار سفارش‌ها و فروش از دیتای واقعی Supabase خوانده می‌شود و RLS دسترسی پنل را کنترل می‌کند.</div></section>`;
}

function bestSellingName() {
  if (remoteState.configured && Array.isArray(remoteState.sales) && remoteState.sales.length) {
    return remoteState.sales[0]?.title_fa_snapshot || '—';
  }
  const counts = {};
  orders().forEach((o) => o.items.forEach((i) => { counts[i.productId] = (counts[i.productId] || 0) + Number(i.qty || 0); }));
  const id = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
  return getProduct(id)?.titleFa || '—';
}

function openAdminForm(type, id = '') {
  const row = type === 'brands' ? db.brands.find((x) => x.id === id) : type === 'series' ? db.series.find((x) => x.id === id) : type === 'models' ? db.models.find((x) => x.id === id) : type === 'variants' ? db.variants.find((x) => x.id === id) : type === 'coupons' ? coupons().find((x) => x.code === id) : null;
  const isEdit = Boolean(row);
  let html = '';
  if (type === 'brands') html = adminBrandForm(row);
  if (type === 'series') html = adminSeriesForm(row);
  if (type === 'models') html = adminModelForm(row);
  if (type === 'variants') html = adminVariantForm(row);
  if (type === 'coupons') html = adminCouponForm(row);
  openModal(`<section class="modal-card admin-modal"><button class="icon-btn close" data-action="modal-close">×</button><span class="eyebrow">${isEdit ? 'EDIT' : 'CREATE'} / ${esc(type.toUpperCase())}</span>${html}</section>`);
  bind();
}

function adminBrandForm(row = {}) {
  return `<form id="admin-form" data-admin-type="brands"><input type="hidden" name="id" value="${esc(row.id || '')}"><label>نام فارسی<input name="nameFa" required value="${esc(row.nameFa || '')}"></label><label>نام انگلیسی<input name="nameEn" required value="${esc(row.nameEn || '')}"></label><label>Slug<input name="slug" required value="${esc(row.slug || '')}"></label><label>Mark<input name="mark" value="${esc(row.mark || '')}" maxlength="2"></label><label>Tone<input name="tone" value="${esc(row.tone || 'plain')}"></label><label class="inline-check"><input type="checkbox" name="featured" ${row.featured ? 'checked' : ''}> نمایش در صفحه اصلی</label><button class="button dark full" type="submit">ذخیره برند</button></form>`;
}

function adminSeriesForm(row = {}) {
  return `<form id="admin-form" data-admin-type="series"><input type="hidden" name="id" value="${esc(row.id || '')}"><label>برند<select name="brandId" required>${db.brands.map((b) => `<option value="${esc(b.id)}" ${row.brandId === b.id ? 'selected' : ''}>${esc(b.nameFa)}</option>`).join('')}</select></label><label>نام فارسی<input name="nameFa" required value="${esc(row.nameFa || '')}"></label><label>نام انگلیسی<input name="nameEn" required value="${esc(row.nameEn || '')}"></label><label>Slug<input name="slug" required value="${esc(row.slug || '')}"></label><label>توضیح<input name="description" value="${esc(row.description || '')}"></label><button class="button dark full" type="submit">ذخیره سری</button></form>`;
}

function adminModelForm(row = {}) {
  return `<form id="admin-form" data-admin-type="models"><input type="hidden" name="id" value="${esc(row.id || '')}"><input type="hidden" name="categoryId" value="${esc(row.categoryId || 'phones')}"><label>برند<select name="brandId" required>${db.brands.map((b) => `<option value="${esc(b.id)}" ${row.brandId === b.id ? 'selected' : ''}>${esc(b.nameFa)}</option>`).join('')}</select></label><label>سری<select name="seriesId" required>${db.series.map((s) => `<option value="${esc(s.id)}" ${row.seriesId === s.id ? 'selected' : ''}>${esc(s.nameFa)}</option>`).join('')}</select></label><label>نام فارسی<input name="nameFa" required value="${esc(row.nameFa || '')}"></label><label>نام انگلیسی<input name="nameEn" required value="${esc(row.nameEn || '')}"></label><label>Slug<input name="slug" required value="${esc(row.slug || '')}"></label><label>Rating<input name="rating" type="number" step="0.1" min="0" max="5" value="${esc(row.rating || 4.5)}"></label><label>Reviews<input name="reviews" type="number" min="0" value="${esc(row.reviews || 0)}"></label><label>Display<input name="display" value="${esc(row.specs?.display || '')}"></label><label>Camera<input name="camera" value="${esc(row.specs?.camera || '')}"></label><label>Chip<input name="chip" value="${esc(row.specs?.chip || '')}"></label><label>Battery<input name="battery" value="${esc(row.specs?.battery || '')}"></label><button class="button dark full" type="submit">ذخیره مدل</button></form>`;
}

function adminVariantForm(row = {}) {
  return `<form id="admin-form" data-admin-type="variants"><input type="hidden" name="id" value="${esc(row.id || '')}"><input type="hidden" name="slug" value="${esc(row.slug || row.id || '')}"><label>مدل<select name="modelId" required>${db.models.map((m) => `<option value="${esc(m.id)}" ${row.modelId === m.id ? 'selected' : ''}>${esc(m.nameFa)}</option>`).join('')}</select></label><label>RAM<select name="ram">${[8,12,16,24].map((v) => `<option ${Number(row.ram) === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label><label>حافظه<select name="storage">${[128,256,512,1024].map((v) => `<option value="${v}" ${Number(row.storage) === v ? 'selected' : ''}>${v >= 1024 ? '1TB' : `${v}GB`}</option>`).join('')}</select></label><label>رنگ<select name="colorId">${(remoteState.ready ? (db.colors || []) : seedColors).map((c) => `<option value="${esc(c.id)}" ${row.colorId === c.id ? 'selected' : ''}>${esc(c.name_fa || c.nameFa)}</option>`).join('')}</select></label><label>قیمت<input name="price" type="number" required value="${esc(row.price || '')}"></label><label>قیمت قبلی<input name="oldPrice" type="number" value="${esc(row.oldPrice || 0)}"></label><label>موجودی<input name="stock" type="number" min="0" required value="${esc(row.stock ?? 0)}"></label><label>SKU<input name="sku" required value="${esc(row.sku || '')}"></label><label>گارانتی<input name="warranty" value="${esc(row.warranty || '۱۸ ماه گارانتی معتبر')}"></label><label>ارسال<input name="delivery" value="${esc(row.delivery || 'ارسال سریع ۱ تا ۲ روزه')}"></label><button class="button dark full" type="submit">ذخیره Variant</button></form>`;
}

function adminCouponForm(row = {}) {
  return `<form id="admin-form" data-admin-type="coupons"><input type="hidden" name="id" value="${esc(row.id || '')}"><input type="hidden" name="originalCode" value="${esc(row.code || '')}"><label>کد<input name="code" required value="${esc(row.code || '')}"></label><label>نوع<select name="kind"><option value="percent" ${row.kind === 'percent' ? 'selected' : ''}>درصدی</option><option value="fixed" ${row.kind === 'fixed' ? 'selected' : ''}>مبلغ ثابت</option></select></label><label>مقدار<input name="value" type="number" required value="${esc(row.value || '')}"></label><label>حداقل سبد<input name="min" type="number" value="${esc(row.min || 0)}"></label><label>حداکثر تخفیف<input name="max" type="number" value="${esc(row.max || 0)}"></label><label>توضیح<input name="label" value="${esc(row.label || '')}"></label><label class="inline-check"><input type="checkbox" name="active" ${row.active !== false ? 'checked' : ''}> فعال</label><button class="button dark full" type="submit">ذخیره کد</button></form>`;
}

async function saveAdminForm(form) {
  const type = form.dataset.adminType;
  const data = new FormData(form);
  const id = data.get('id');
  try {
    if (remoteLoggedIn() && ['admin', 'manager'].includes(remoteState.role)) {
      if (type === 'brands') {
        await SB.adminUpsert('brands', {
          id: id || uid('brand'), slug: data.get('slug'), name_fa: data.get('nameFa'), name_en: data.get('nameEn'),
          mark: data.get('mark') || data.get('nameEn')?.[0] || 'B', tone: data.get('tone') || 'plain',
          is_featured: form.querySelector('[name="featured"]')?.checked || false, is_active: true
        });
      }
      if (type === 'series') {
        await SB.adminUpsert('series', {
          id: id || uid('series'), slug: data.get('slug'), brand_id: data.get('brandId'), name_fa: data.get('nameFa'), name_en: data.get('nameEn'), description: data.get('description') || '', is_active: true
        });
      }
      if (type === 'models') {
        await SB.adminUpsert('models', {
          id: id || uid('model'), slug: data.get('slug'), series_id: data.get('seriesId'), category_id: data.get('categoryId') || 'phones',
          name_fa: data.get('nameFa'), name_en: data.get('nameEn'), rating: Number(data.get('rating') || 4.5), review_count: Number(data.get('reviews') || 0),
          specs: { display: data.get('display') || '', camera: data.get('camera') || '', chip: data.get('chip') || '', battery: data.get('battery') || '' }, is_active: true
        });
      }
      if (type === 'variants') {
        const variantId = id || uid('variant');
        const existing = db.variants.find((x) => x.id === id);
        const offerId = existing?.offerId || `offer-${variantId}`;
        await SB.adminUpsert('variants', {
          id: variantId, slug: data.get('slug') || variantId, model_id: data.get('modelId'), ram_gb: Number(data.get('ram')),
          storage_gb: Number(data.get('storage')), color_id: data.get('colorId'), sku: data.get('sku') || `MX-${variantId.toUpperCase()}`, is_active: true
        });
        await SB.adminUpsert('offers', {
          id: offerId, variant_id: variantId, seller_id: 'mobilex-main', price_toman: Number(data.get('price') || 0),
          old_price_toman: Number(data.get('oldPrice') || 0), warranty_text: data.get('warranty') || '', delivery_text: data.get('delivery') || '', is_default: true, is_active: true
        });
        const existingInventory = await SB.get('inventory', { select: 'offer_id', offer_id: `eq.${offerId}`, limit: '1' });
        if (existingInventory?.length) await SB.adminSetStock(offerId, Number(data.get('stock') || 0));
        else await SB.post('inventory', { offer_id: offerId, stock_qty: Number(data.get('stock') || 0), reserved_qty: 0, low_stock_threshold: 3 }, { returning: true });
      }
      if (type === 'coupons') {
        const row = {
          id: data.get('couponId') || '', code: String(data.get('code')).toUpperCase(), kind: data.get('kind'), value: Number(data.get('value') || 0),
          min: Number(data.get('min') || 0), max: Number(data.get('max') || 0), label: data.get('label') || '', active: form.querySelector('[name="active"]')?.checked !== false
        };
        await SB.adminSaveCoupon(row);
      }
      await refreshRemoteData({ catalog: type !== 'coupons', admin: true });
      if (type === 'coupons') {
        remoteState.coupons = await SB.loadCoupons({ admin: true });
        render();
      }
      closeModal();
      toast('اطلاعات در Supabase ذخیره شد.');
      return;
    }

    // Local fallback.
    if (type === 'brands') {
      const row = { id: id || uid('brand'), nameFa: data.get('nameFa'), nameEn: data.get('nameEn'), slug: data.get('slug'), mark: data.get('mark') || data.get('nameEn')?.[0] || 'B', tone: data.get('tone') || 'plain', featured: form.querySelector('[name="featured"]')?.checked || false };
      upsert(db.brands, row);
    }
    if (type === 'series') {
      upsert(db.series, { id: id || uid('series'), brandId: data.get('brandId'), nameFa: data.get('nameFa'), nameEn: data.get('nameEn'), slug: data.get('slug'), description: data.get('description') || '' });
    }
    if (type === 'models') {
      upsert(db.models, { id: id || uid('model'), brandId: data.get('brandId'), seriesId: data.get('seriesId'), nameFa: data.get('nameFa'), nameEn: data.get('nameEn'), slug: data.get('slug'), rating: Number(data.get('rating') || 4.5), reviews: Number(data.get('reviews') || 0), specs: { display: data.get('display') || '', camera: data.get('camera') || '', chip: data.get('chip') || '', battery: data.get('battery') || '' } });
    }
    if (type === 'variants') {
      const row = { id: id || uid('variant'), modelId: data.get('modelId'), ram: Number(data.get('ram')), storage: Number(data.get('storage')), colorId: data.get('colorId'), price: Number(data.get('price')), oldPrice: Number(data.get('oldPrice') || 0), stock: Number(data.get('stock') || 0), sku: data.get('sku'), warranty: data.get('warranty'), delivery: data.get('delivery') };
      row.slug = row.id;
      upsert(db.variants, row);
    }
    if (type === 'coupons') {
      const list = coupons();
      const original = data.get('originalCode');
      const existingIndex = original ? list.findIndex((x) => x.code === original) : -1;
      const row = { code: String(data.get('code')).toUpperCase(), kind: data.get('kind'), value: Number(data.get('value')), min: Number(data.get('min') || 0), max: Number(data.get('max') || 0), label: data.get('label') || '', active: form.querySelector('[name="active"]')?.checked !== false };
      if (existingIndex >= 0) list[existingIndex] = row; else list.unshift(row);
      write(K.coupons, list);
    }
    if (type !== 'coupons') persistCatalog();
    closeModal();
    render();
    toast('اطلاعات ذخیره شد.');
  } catch (error) {
    console.error(error);
    toast(error.message || 'ذخیره اطلاعات ناموفق بود.');
  }
}

function upsert(list, row) {
  const i = list.findIndex((x) => x.id === row.id);
  if (i >= 0) list[i] = row; else list.unshift(row);
}

async function deleteAdmin(type, id) {
  if (!confirm('این مورد حذف شود؟')) return;
  try {
    if (remoteLoggedIn() && ['admin', 'manager'].includes(remoteState.role)) {
      if (type === 'brands' && db.series.some((s) => s.brandId === id)) return toast('اول Seriesهای این Brand را حذف یا منتقل کن.');
      if (type === 'series' && db.models.some((m) => m.seriesId === id)) return toast('اول Modelهای این Series را حذف یا منتقل کن.');
      if (type === 'models' && db.variants.some((v) => v.modelId === id)) return toast('اول Variantهای این Model را حذف یا منتقل کن.');
      if (type === 'variants') {
        const row = db.variants.find((v) => v.id === id);
        if (row?.offerId) {
          await SB.adminDelete('inventory', 'offer_id', row.offerId);
          await SB.adminDelete('offers', 'id', row.offerId);
        }
        await SB.adminDelete('variants', 'id', id);
      } else if (type === 'coupons') {
        const row = coupons().find((c) => c.code === id);
        if (row?.id) await SB.adminDeleteCoupon(row.id);
      } else {
        await SB.adminDelete(type, 'id', id);
      }
      await refreshRemoteData({ catalog: type !== 'coupons', admin: true });
      if (type === 'coupons') remoteState.coupons = await SB.loadCoupons({ admin: true });
      render();
      toast('حذف در Supabase انجام شد.');
      return;
    }

    if (type === 'brands') {
      if (db.series.some((s) => s.brandId === id)) return toast('اول Seriesهای این Brand را حذف یا منتقل کن.');
      db.brands = db.brands.filter((x) => x.id !== id);
    }
    if (type === 'series') {
      if (db.models.some((m) => m.seriesId === id)) return toast('اول Modelهای این Series را حذف یا منتقل کن.');
      db.series = db.series.filter((x) => x.id !== id);
    }
    if (type === 'models') {
      if (db.variants.some((v) => v.modelId === id)) return toast('اول Variantهای این Model را حذف یا منتقل کن.');
      db.models = db.models.filter((x) => x.id !== id);
    }
    if (type === 'variants') db.variants = db.variants.filter((x) => x.id !== id);
    if (type === 'coupons') write(K.coupons, coupons().filter((x) => x.code !== id));
    if (type !== 'coupons') persistCatalog();
    render();
    toast('حذف انجام شد.');
  } catch (error) {
    console.error(error);
    toast(error.message || 'حذف ناموفق بود.');
  }
}

async function adjustStock(id, delta) {
  const row = db.variants.find((x) => x.id === id);
  if (!row) return;
  const next = Math.max(0, Number(row.stock) + Number(delta));
  if (remoteLoggedIn() && row.offerId) {
    try { await SB.adminSetStock(row.offerId, next); await refreshRemoteData({ catalog: true, admin: true }); toast('موجودی در Supabase به‌روزرسانی شد.'); }
    catch (error) { toast(error.message || 'موجودی ذخیره نشد.'); }
    return;
  }
  row.stock = next;
  persistCatalog();
  render();
}

async function setStock(id) {
  const row = db.variants.find((x) => x.id === id);
  if (!row) return;
  const value = prompt('موجودی جدید را وارد کن:', String(row.stock));
  if (value === null) return;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return toast('عدد موجودی معتبر نیست.');
  if (remoteLoggedIn() && row.offerId) {
    try { await SB.adminSetStock(row.offerId, Math.floor(number)); await refreshRemoteData({ catalog: true, admin: true }); toast('موجودی ذخیره شد.'); }
    catch (error) { toast(error.message || 'موجودی ذخیره نشد.'); }
    return;
  }
  row.stock = Math.floor(number);
  persistCatalog();
  render();
}

async function updateOrderStatus(id, status) {
  try {
    if (remoteLoggedIn() && ['admin', 'manager'].includes(remoteState.role)) {
      await SB.adminUpdateOrderStatus(id, status, 'به‌روزرسانی از پنل Mobilex');
      remoteState.orders = await SB.getOrders(remoteUserId(), { admin: true });
      write(K.orders, remoteState.orders);
      render();
      toast('وضعیت سفارش در Supabase به‌روزرسانی شد.');
      return;
    }
    const list = orders();
    const row = list.find((x) => x.id === id);
    if (!row) return;
    row.status = status;
    write(K.orders, list);
    render();
    toast('وضعیت سفارش به‌روزرسانی شد.');
  } catch (error) {
    console.error(error);
    toast(error.message || 'وضعیت سفارش ذخیره نشد.');
  }
}

async function toggleCoupon(code) {
  const list = coupons().slice();
  const row = list.find((x) => x.code === code);
  if (!row) return;
  row.active = row.active === false;
  if (remoteLoggedIn() && row.id) {
    try {
      await SB.adminSaveCoupon(row);
      remoteState.coupons = await SB.loadCoupons({ admin: true });
      render();
      return;
    } catch (error) { toast(error.message || 'وضعیت کد تخفیف ذخیره نشد.'); return; }
  }
  write(K.coupons, list);
  render();
}

function resetDemo() {
  if (!confirm('همه داده‌های نمایشی فاز ۵ به حالت اولیه برگردند؟')) return;
  localStorage.removeItem(K.catalog);
  localStorage.removeItem(K.coupons);
  localStorage.removeItem(K.content);
  initCatalog();
  render();
  toast('داده‌های نمایشی ریست شد.');
}

async function saveContent(form) {
  const data = new FormData(form);
  const payload = {
    heroEyebrow: data.get('heroEyebrow'),
    heroTitle: data.get('heroTitle'),
    heroText: data.get('heroText'),
    bannerTitle: data.get('bannerTitle'),
    bannerText: data.get('bannerText')
  };
  if (remoteLoggedIn() && ['admin', 'manager'].includes(remoteState.role)) {
    try {
      await SB.adminSaveContent(payload);
      remoteState.content = payload;
      closeModal();
      render();
      toast('محتوا در Supabase ذخیره شد.');
      return;
    } catch (error) { toast(error.message || 'محتوا ذخیره نشد.'); return; }
  }
  write(K.content, payload);
  render();
  toast('محتوا ذخیره شد.');
}


async function handleAccountLogin(form) {
  try {
    const data = new FormData(form);
    await remoteLogin(String(data.get('email') || '').trim(), String(data.get('password') || ''));
    toast('ورود موفق بود.');
  } catch (error) { toast(error.message || 'ورود ناموفق بود.'); }
}

async function handleAccountSignup(form) {
  try {
    const data = new FormData(form);
    await remoteSignup(String(data.get('name') || '').trim(), String(data.get('email') || '').trim(), String(data.get('password') || ''), String(data.get('phone') || '').trim());
  } catch (error) { toast(error.message || 'ثبت‌نام ناموفق بود.'); }
}

async function handleAdminAuth(form) {
  try {
    const data = new FormData(form);
    await remoteLogin(String(data.get('email') || '').trim(), String(data.get('password') || ''));
    if (!['admin', 'manager'].includes(remoteState.role)) {
      await remoteLogout();
      throw new Error('این حساب دسترسی مدیریت ندارد.');
    }
    write(K.admin, { active: true, role: remoteState.role, at: new Date().toISOString() });
    go('/admin/dashboard');
    toast('ورود مدیریت موفق بود.');
  } catch (error) { toast(error.message || 'ورود مدیریت ناموفق بود.'); }
}

async function cancelUserOrder(id) {
  if (!remoteLoggedIn()) return toast('لغو سفارش فقط بعد از اتصال Supabase فعال است.');
  if (!confirm('سفارش لغو شود؟')) return;
  try {
    await SB.cancelOrder(id);
    remoteState.orders = await SB.getOrders(remoteUserId());
    write(K.orders, remoteState.orders);
    render();
    toast('سفارش لغو شد و موجودی برگشت داده شد.');
  } catch (error) { toast(error.message || 'لغو سفارش ناموفق بود.'); }
}

function bind() {
  $$('[data-route]').forEach((link) => link.addEventListener('click', (event) => {
    if (link.target === '_blank') return;
    event.preventDefault();
    go(link.getAttribute('href') || link.dataset.route || '/');
  }));

  $$('[data-action]').forEach((el) => el.addEventListener('click', () => {
    const action = el.dataset.action;
    const id = el.dataset.id;
    if (action === 'search') openSearch();
    else if (action === 'close-search') closeSearch();
    else if (action === 'menu') $('#mobile-menu').hidden = !$('#mobile-menu').hidden;
    else if (action === 'wishlist') go('/wishlist');
    else if (action === 'cart') go('/cart');
    else if (action === 'account') go('/account');
    else if (action === 'wish') toggleWish(id);
    else if (action === 'compare' || action === 'compare-remove') toggleCompare(id);
    else if (action === 'add-cart') addCart(id);
    else if (action === 'quick') quick(id);
    else if (action === 'clear-compare') { write(K.compare, []); render(); }
    else if (action === 'coupon') couponModal();
    else if (action === 'modal-close') closeModal();
    else if (action === 'login-demo') { write(K.user, demoUser); write(K.addresses, demoAddresses); render(); }
    else if (action === 'logout') { if (remoteLoggedIn()) void remoteLogout(); else { localStorage.removeItem(K.user); render(); } }
    else if (action === 'cancel-order') void cancelUserOrder(id);
    else if (action === 'checkout-next') { if (state.checkoutStep < 4) state.checkoutStep += 1; render(); }
    else if (action === 'checkout-back') { if (state.checkoutStep > 1) state.checkoutStep -= 1; render(); }
    else if (action === 'place-order') placeOrder();
    else if (action === 'filters-open') { state.filtersOpen = true; render(); }
    else if (action === 'filters-close') { state.filtersOpen = false; render(); }
    else if (action === 'clear-filters') go('/products');
    else if (action === 'apply-filters') applyFilters();
    else if (action === 'clear-coupon') { localStorage.removeItem(K.coupon); closeModal(); render(); }
    else if (action === 'reload') location.reload();
    else if (action === 'admin-login') handleAdminLogin();
    else if (action === 'admin-logout') { if (remoteLoggedIn()) void remoteLogout(); else { localStorage.removeItem(K.admin); go('/'); } }
    else if (action === 'admin-reset') resetDemo();
    else if (action === 'content-reset') { localStorage.removeItem(K.content); render(); }
  }));

  $$('[data-cart-plus]').forEach((el) => el.addEventListener('click', () => updateCart(el.dataset.cartPlus, 1)));
  $$('[data-cart-minus]').forEach((el) => el.addEventListener('click', () => updateCart(el.dataset.cartMinus, -1)));
  $$('[data-cart-remove]').forEach((el) => el.addEventListener('click', () => removeCart(el.dataset.cartRemove)));
  $$('[data-storage]').forEach((el) => el.addEventListener('click', () => { state.filters.storage = state.filters.storage === el.dataset.storage ? '' : el.dataset.storage; render(); }));
  $$('[data-ram]').forEach((el) => el.addEventListener('click', () => { state.filters.ram = state.filters.ram === el.dataset.ram ? '' : el.dataset.ram; render(); }));
  $$('[data-color]').forEach((el) => el.addEventListener('click', () => { state.filters.color = state.filters.color === el.dataset.color ? '' : el.dataset.color; render(); }));
  $$('[data-default-address]').forEach((el) => el.addEventListener('click', async () => { const id = el.dataset.defaultAddress; state.selectedAddress = id; write(K.addresses, addresses().map((a) => ({ ...a, default: a.id === id }))); if (remoteLoggedIn()) { try { await SB.setDefaultAddress(remoteUserId(), id); await refreshRemoteData({ userData: true }); return; } catch (error) { toast(error.message || 'آدرس پیش‌فرض ذخیره نشد.'); } } render(); }));
  $$('[data-step]').forEach((el) => el.addEventListener('click', () => { state.checkoutStep = Number(el.dataset.step); render(); }));
  $$('[data-coupon]').forEach((el) => el.addEventListener('click', () => applyCoupon(el.dataset.coupon)));
  $$('[data-admin-add]').forEach((el) => el.addEventListener('click', () => openAdminForm(el.dataset.adminAdd)));
  $$('[data-admin-edit]').forEach((el) => el.addEventListener('click', () => openAdminForm(el.dataset.adminEdit, el.dataset.id)));
  $$('[data-admin-delete]').forEach((el) => el.addEventListener('click', () => deleteAdmin(el.dataset.adminDelete, el.dataset.id)));
  $$('[data-stock-step]').forEach((el) => el.addEventListener('click', () => adjustStock(el.dataset.stockStep, Number(el.dataset.delta))));
  $$('[data-stock-set]').forEach((el) => el.addEventListener('click', () => setStock(el.dataset.stockSet)));
  $$('[data-admin-order-status]').forEach((el) => el.addEventListener('change', () => updateOrderStatus(el.dataset.adminOrderStatus, el.value)));
  $$('[data-admin-toggle-coupon]').forEach((el) => el.addEventListener('click', () => toggleCoupon(el.dataset.adminToggleCoupon)));

  $('#catalog-sort')?.addEventListener('change', (e) => { state.sort = e.target.value; applyFilters(); });
  $('#filter-series')?.addEventListener('change', (e) => { state.filters.series = e.target.value; });
  $('#filter-rating')?.addEventListener('change', (e) => { state.filters.rating = e.target.value; });
  $('#min-price')?.addEventListener('input', (e) => { state.filters.min = e.target.value; });
  $('#max-price')?.addEventListener('input', (e) => { state.filters.max = e.target.value; });
  $$('input[name="brand-filter"]').forEach((el) => el.addEventListener('change', () => { state.filters.brand = el.value; }));
  $$('input[name="addr"]').forEach((el) => el.addEventListener('change', () => { state.selectedAddress = el.value; }));
  $$('input[name="ship"]').forEach((el) => el.addEventListener('change', () => { state.selectedShipping = el.value; render(); }));
  $('#brand-search')?.addEventListener('input', (e) => {
    const url = new URL('/brands', location.origin);
    if (e.target.value.trim()) url.searchParams.set('q', e.target.value.trim());
    go(`${url.pathname}${url.search}`, true);
  });
  $('#global-search')?.addEventListener('input', (e) => { state.search = e.target.value; searchRender(state.search); });
  $('#admin-pin')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleAdminLogin(); });
  $('#content-form')?.addEventListener('submit', (e) => { e.preventDefault(); void saveContent(e.target); });
  $('#admin-form')?.addEventListener('submit', (e) => { e.preventDefault(); void saveAdminForm(e.target); });
  $('#account-login-form')?.addEventListener('submit', (e) => { e.preventDefault(); void handleAccountLogin(e.target); });
  $('#account-signup-form')?.addEventListener('submit', (e) => { e.preventDefault(); void handleAccountSignup(e.target); });
  $('#admin-auth-form')?.addEventListener('submit', (e) => { e.preventDefault(); void handleAdminAuth(e.target); });
}

async function handleAdminLogin() {
  if (remoteState.configured) {
    const email = $('#admin-email')?.value?.trim();
    const password = $('#admin-password')?.value || '';
    if (!email || !password) return toast('ایمیل و رمز عبور را وارد کن.');
    const form = $('#admin-auth-form');
    if (form) return handleAdminAuth(form);
    return;
  }
  const pin = $('#admin-pin')?.value?.trim();
  if (pin !== '2468') return toast('PIN آزمایشی صحیح نیست.');
  write(K.admin, { active: true, role: 'admin', at: new Date().toISOString() });
  go('/admin/dashboard');
}

document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    openSearch();
  }
  if (event.key === 'Escape') {
    closeSearch();
    closeModal();
  }
});

window.addEventListener('popstate', render);
window.addEventListener('error', (event) => console.error('Mobilex runtime error:', event.error || event.message));
window.addEventListener('unhandledrejection', (event) => console.error('Mobilex promise error:', event.reason));

initCatalog();
if (!user()) write(K.addresses, demoAddresses);

try {
  const redirect = sessionStorage.getItem('mobilex-redirect');
  if (redirect && redirect !== location.pathname) {
    sessionStorage.removeItem('mobilex-redirect');
    history.replaceState({}, '', redirect);
  } else {
    sessionStorage.removeItem('mobilex-redirect');
  }
} catch {}

render();
void bootSupabase();
