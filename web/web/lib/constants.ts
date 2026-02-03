// lib/constants.ts

/**
 * Shared “preview” resolution cap used throughout the app.
 *
 * - Client: overlay precompute + mask editor work at this cap for speed.
 * - Server: auto-mask generation should target the same cap so masks align perfectly.
 */
export const PREVIEW_MAX_SIDE = 1200;
