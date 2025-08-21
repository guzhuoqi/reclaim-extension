// Do this as the first thing so that any code reading it knows the right env.
process.env.BABEL_ENV = 'development';
process.env.NODE_ENV = 'development';
process.env.ASSET_PATH = '/';

var WebpackDevServer = require('webpack-dev-server'),
  webpack = require('webpack'),
  config = require('../webpack.config'),
  env = require('./env'),
  path = require('path');

var options = config.chromeExtensionBoilerplate || {};
// Exclude extension scripts from hot reloading to prevent webpack-dev-server logs
var excludeEntriesToHotReload = options.notHotReload || [
  'background/background',
  'content/content', 
  'offscreen/offscreen',
  'interceptor/network-interceptor'
];

// Hot reload disabled to prevent WebSocket CSP issues
// for (var entryName in config.entry) {
//   if (excludeEntriesToHotReload.indexOf(entryName) === -1) {
//     config.entry[entryName] = [
//       'webpack/hot/dev-server',
//       `webpack-dev-server/client?hot=true&hostname=localhost&port=${env.PORT}`,
//     ].concat(config.entry[entryName]);
//   }
// }

delete config.chromeExtensionBoilerplate;

var compiler = webpack(config);

var server = new WebpackDevServer(
  {
    server: {
      type: 'http',
    },
    hot: false,
    liveReload: false,
    client: false,
    webSocketServer: false,
    host: 'localhost',
    port: env.PORT,
    static: {
      directory: path.join(__dirname, '../build'),
    },
    devMiddleware: {
      publicPath: `http://localhost:${env.PORT}/`,
      writeToDisk: true,
    },
    headers: {
      'Access-Control-Allow-Origin': '*',
      // 允许本地后端 4000 端口
      'Content-Security-Policy': "default-src 'self' 'unsafe-inline' 'unsafe-eval' https: data:; connect-src 'self' http://localhost:4000 https: data: blob:;"
    },
    allowedHosts: 'all',
    // 标准代理配置
    proxy: [
      {
        context: ['/api'],
        target: 'http://localhost:4000',
        pathRewrite: { '^/api': '' }, // 将 /api/session/init 重写为 /session/init
        changeOrigin: true,
        secure: false, // 允许 http
      },
    ],
  },
  compiler,
);

(async () => {
  await server.start();
})();
