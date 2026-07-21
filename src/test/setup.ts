import '@testing-library/jest-dom/vitest';

// Stripe price IDs are read (and validated) at module load in src/lib/stripe-config.ts.
// Any test that transitively imports that module needs these present, exactly as
// the production Vercel environment supplies them. Tests that specifically exercise
// the missing/empty-var behaviour override or delete these via process.env + a fresh
// dynamic import.
process.env.STRIPE_PRICE_PLUS_MONTHLY ??= 'price_test_plus_monthly';
process.env.STRIPE_PRICE_PLUS_YEARLY ??= 'price_test_plus_yearly';
process.env.STRIPE_PRICE_PRO_MONTHLY ??= 'price_test_pro_monthly';
process.env.STRIPE_PRICE_PRO_YEARLY ??= 'price_test_pro_yearly';
process.env.STRIPE_PRICE_MAX_MONTHLY ??= 'price_test_max_monthly';
process.env.STRIPE_PRICE_MAX_YEARLY ??= 'price_test_max_yearly';
process.env.STRIPE_PRICE_ULTRA_MONTHLY ??= 'price_test_ultra_monthly';
process.env.STRIPE_PRICE_ULTRA_YEARLY ??= 'price_test_ultra_yearly';
process.env.STRIPE_PRICE_AI_MONTHLY ??= 'price_test_ai_monthly';
