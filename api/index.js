// Vercel serverless entrypoint — wraps the Express app.
const app = require('../src/app');
require('../src/seed').seedIfEmpty();
module.exports = app;
