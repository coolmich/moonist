// Resolves a public/ asset path ('textures/x.webp') against Vite's base URL,
// so the app works served from a subpath (GitHub Pages project sites). Scene
// modules are imported by node tests, where Vite's env object does not exist —
// there the base falls back to root.
export const assetUrl = (path) =>
  (import.meta.env ? import.meta.env.BASE_URL : '/') + path;
