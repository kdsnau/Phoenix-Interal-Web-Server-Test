'use strict';
/** Wrap an async route so thrown errors hit the Express error handler. */
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
module.exports = { ah };
