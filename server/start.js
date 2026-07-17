/**
 * @deprecated Use the bundled production entry instead:
 *   npm run build  →  node ./build/server/prod.js  (npm run start)
 *
 * This file used to document the intended composition but imported
 * non-existent `./realtime/*.js` paths. Staging was falling back to
 * `react-router-serve`, which never attaches Socket.IO.
 */
console.error(
  "[apoaap] server/start.js is obsolete. Run: node ./build/server/prod.js",
);
process.exit(1);
