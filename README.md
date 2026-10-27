# Swiza ERP — Materials Master

A React + Vite foundation for the Swiza ERP Materials Master, using the existing Supabase project and a navy/emerald responsive UI.

## Run locally

1. Use Node.js 20.19+ or 22.12+.
2. Copy `.env.example` to `.env.local`.
3. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` from the Supabase project's API settings. Use only a publishable/anon key in browser code; never put a service-role or secret key in a `VITE_` variable.
4. Run `npm install`, then `npm run dev`.
5. Run `npm run build` to verify the production bundle.

## Deploy to Vercel

Import this GitHub repository and select branch `feat/swiza-materials-master-foundation` for a preview. Framework preset: Vite; build command: `npm run build`; output directory: `dist`. Add the two environment variables above in Vercel Project Settings, then redeploy.

## Current implementation scope

- Materials master search, filters, create/edit drawer, and CSV export.
- Supabase Auth sign-in/sign-out.
- Company context based on the signed-in user's `user_company_roles` and active `companies` rows.
- Item reads/writes against `public.item_master` and UOM choices from `public.uom_master`.
- Read/write failures are surfaced to the user; the UI does not bypass row-level security.

This is an initial application foundation, not a claim that the entire ERP is implemented. Database writes depend on the existing Supabase RLS policies granting the signed-in user the relevant access. Verify those policies before production use.
