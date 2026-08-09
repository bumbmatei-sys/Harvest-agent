/**
 * Shared blog-automation constants.
 *
 * Client-safe on purpose: the cron route enforces the failure cap and AdminBlog
 * tells the admin what the cap is, so both need the number. The route imports
 * `firebase-admin`, so AdminBlog cannot read it from there without dragging
 * server code into the browser bundle — hence this module rather than a literal
 * copied into the UI, which would drift the moment either side changed.
 */

/**
 * Consecutive failed generations before automation turns itself off.
 *
 * There has to be a cap. Without one a permanently-failing tenant is retried
 * for as long as the cron runs — a real RAG query and a real generation call
 * every time, on Harvest's metered spend, producing nothing. Three is enough to
 * ride out a transient AI-service blip and small enough that a genuine breakage
 * costs three calls instead of three hundred.
 */
export const MAX_CONSECUTIVE_FAILURES = 3;
