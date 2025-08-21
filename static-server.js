const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.STATIC_PORT || 3006;
const BUILD_DIR = path.join(__dirname, 'build');

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Security-Policy', "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: https: http://localhost:4000; connect-src 'self' http://localhost:4000 https: data: blob:; img-src 'self' data: https: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' data: https: http://localhost:4000; style-src 'self' 'unsafe-inline' https:");
  next();
});

app.use(express.static(BUILD_DIR));

app.listen(PORT, () => {
  console.log(`[static-server] serving ${BUILD_DIR} at http://localhost:${PORT}`);
});


