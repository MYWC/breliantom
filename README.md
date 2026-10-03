# Mobilex — Production Candidate + Supabase Ready

Mobilex is a vanilla HTML/CSS/JavaScript mobile store with a deliberately small core architecture.

## Core files

```text
mobilex/
├── index.html
├── styles.css
├── app.js
├── data.js
├── supabase.js
├── 404.html
└── README.md
```

No React, TypeScript, Tailwind, bundler, or component explosion.

## What is connected now

When Supabase credentials are configured in `index.html`, the site uses the real database for:

- Catalog: brands, series, models, variants, offers, inventory
- Supabase Auth: email/password sign in and sign up
- Profile + role detection
- User addresses
- Cart synchronization
- Wishlist synchronization
- Compare synchronization
- Checkout through the secure `create_order` RPC
- Order history and order details
- User order cancellation through `cancel_order`
- Notifications
- Admin catalog CRUD
- Admin inventory updates
- Admin order status updates through `admin_update_order_status`
- Admin customer reporting
- Admin sales reporting
- Coupon management
- Home content management

Without credentials, the same files automatically fall back to the Phase 5 local demo data.

## Configure Supabase

Open `index.html` and replace only these two empty values:

```html
window.MOBILEX_SUPABASE_URL = 'https://YOUR-PROJECT.supabase.co';
window.MOBILEX_SUPABASE_PUBLISHABLE_KEY = 'YOUR-PUBLISHABLE-KEY';
```

Use only the publishable/anon client key. Never place a service-role or secret key in the frontend.

## Database

The final SQL is outside the website's 7-file core and is supplied in the release package under:

```text
supabase/mobilex-final-supabase.sql
```

Run that SQL once in a fresh Supabase project, then create your first user from Authentication and give that user the `admin` role using the SQL shown in `supabase/SUPABASE-SETUP.md`.

## Static hosting

The project is GitHub Pages friendly. `404.html` routes unknown SPA paths back to `/`.

## Important

This release does not include a real payment gateway. Checkout creates a real database order, validates stock, and changes inventory through the database RPC, but payment remains a non-gateway flow until a payment provider is added.

## Validation performed

`node --check` passes for `app.js`, `data.js`, and `supabase.js`.
