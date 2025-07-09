var webpack = require("webpack"),
  path = require("path"),
  fileSystem = require("fs-extra"),
  env = require("./utils/env"),
  CopyWebpackPlugin = require("copy-webpack-plugin"),
  HtmlWebpackPlugin = require("html-webpack-plugin"),
  TerserPlugin = require("terser-webpack-plugin");
var { CleanWebpackPlugin } = require("clean-webpack-plugin");
var ReactRefreshWebpackPlugin = require("@pmmmwh/react-refresh-webpack-plugin");
var ExtReloader = require('webpack-ext-reloader');
var NodePolyfillPlugin = require('node-polyfill-webpack-plugin');

const ASSET_PATH = process.env.ASSET_PATH || "/";

var alias = {};

// load the secrets
var secretsPath = path.join(__dirname, "secrets." + env.NODE_ENV + ".js");

var fileExtensions = [
  "jpg",
  "jpeg",
  "png",
  "gif",
  "eot",
  "otf",
  "svg",
  "ttf",
  "woff",
  "woff2",
];

if (fileSystem.existsSync(secretsPath)) {
  alias["secrets"] = secretsPath;
}

const isDevelopment = process.env.NODE_ENV !== "production";

var options = {
  mode: process.env.NODE_ENV || "development",
  ignoreWarnings: [
    /Circular dependency between chunks with runtime/,
    /ResizeObserver loop completed with undelivered notifications/,
    /Should not import the named export/,
    /Sass @import rules are deprecated and will be removed in Dart Sass 3.0.0/,
    /Global built-in functions are deprecated and will be removed in Dart Sass 3.0.0./,
    /repetitive deprecation warnings omitted/,
    // Add these to ignore binary module errors
    /Critical dependency: the request of a dependency is an expression/,
    /Module parse failed: Unexpected character/,
    /Can't resolve 'worker_threads'/,
    // Ignore native module errors
    /Can't resolve '\.node'/,
    // Additional ignores
    /Can't resolve 'fs'/,
    /Can't resolve 'child_process'/,
    /node:url/,
  ],

  entry: {
    "background/background": path.join(__dirname, "src", "background", "background.js"),
    "content/content": path.join(__dirname, "src", "content", "content.js"),
    "offscreen/offscreen": path.join(__dirname, "src", "offscreen", "offscreen.js"),
    "interceptor/network-interceptor": path.join(__dirname, "src", "interceptor", "network-interceptor.js"),
    "interceptor/injection-scripts": path.join(__dirname, "src", "interceptor", "injection-scripts.js")
  },
  output: {
    filename: "[name].bundle.js",
    path: path.resolve(__dirname, "build"),
    clean: true,
    publicPath: ASSET_PATH,
    assetModuleFilename: '[name][ext]',
    chunkFilename: "[name].bundle.js",
  },
  module: {
    rules: [
      {
        // look for .css or .scss files
        test: /\.(css|scss)$/,
        // in the `src` directory
        use: [
          {
            loader: "style-loader",
          },
          {
            loader: "css-loader",
            options: { importLoaders: 1 },
          },
          {
            loader: "postcss-loader",
          },
          {
            loader: "sass-loader",
            options: {
              sourceMap: true,
              sassOptions: {
                silenceDeprecations: ["legacy-js-api"],
              }
            },
          },
        ],
      },
      {
        test: new RegExp(".(" + fileExtensions.join("|") + ")$"),
        type: "asset/resource",
        exclude: /node_modules/,
      },
      {
        test: /\.html$/,
        loader: "html-loader",
        exclude: /node_modules/,
      },
      {
        test: /\.(ts|tsx)$/,
        exclude: /node_modules/,
        use: [
          {
            loader: require.resolve("ts-loader"),
            options: {
              transpileOnly: isDevelopment,
            },
          },
        ],
      },
      {
        test: /\.(js|jsx)$/,
        use: [
          {
            loader: "source-map-loader",
          },
          {
            loader: require.resolve("babel-loader"),
            options: {
              plugins: [
                isDevelopment && require.resolve("react-refresh/babel"),
              ].filter(Boolean),
            },
          },
        ],
        exclude: /node_modules/,
      },
      // Add WebAssembly support
      {
        test: /\.wasm$/,
        type: 'webassembly/async',
        // Add this to improve compatibility
        generator: {
          filename: 'wasm/[name][ext]'
        },
      }
    ],
  },
  // Enable WebAssembly
  experiments: {
    asyncWebAssembly: true,
    syncWebAssembly: true,
    topLevelAwait: true,
  },
  resolve: {
    alias: {
      ...alias,
      // Add aliases for problematic modules
      'koffi': false,
      're2': false,
      'worker_threads': path.resolve(__dirname, 'src/utils/mocks/worker-threads-mock.js'),
      'node:url': require.resolve('url/'),
      'react-native-tcp-socket': false,
      // Use process/browser.js instead of process/browser
      'process/browser': require.resolve('process/browser.js'),
      // Mock canvas for jsdom
      'canvas': false,
      // Use our JSDOM mock
      'jsdom': path.resolve(__dirname, 'src/utils/mocks/jsdom-mock.js'),
      // Add WebSocket polyfill for background context
      'ws': path.resolve(__dirname, 'src/utils/websocket-polyfill.js'),
    },
    extensions: fileExtensions
      .map((extension) => "." + extension)
      .concat([".js", ".jsx", ".ts", ".tsx", ".css"]),
    fallback: {
      "stream": require.resolve("stream-browserify"),
      "buffer": require.resolve("buffer/"),
      "crypto": require.resolve("crypto-browserify"),
      "https": require.resolve("https-browserify"),
      "http": require.resolve("stream-http"),
      "path": require.resolve("path-browserify"),
      "zlib": require.resolve("browserify-zlib"),
      "assert": require.resolve("assert/"),
      "url": require.resolve("url/"),
      "util": require.resolve("util/"),
      "os": require.resolve("os-browserify/browser"),
      "vm": require.resolve("vm-browserify"),
      "constants": require.resolve("constants-browserify"),
      "fs": false,
      "net": false,
      "tls": false,
      "child_process": false,
      "worker_threads": false,
      "readline": false,
      "koffi": false,
      're2': false,
    }
  },
  plugins: [
    isDevelopment && new ReactRefreshWebpackPlugin(),
    new CleanWebpackPlugin({ verbose: false }),
    new webpack.ProgressPlugin(),
    // expose and write the allowed env vars on the compiled bundle
    new webpack.EnvironmentPlugin(["NODE_ENV"]),
    new webpack.DefinePlugin({
      'process.env.NODE_ENV': JSON.stringify(env.NODE_ENV),
      'process.env.DEBUG': JSON.stringify(process.env.DEBUG || false),
      'process.env.EXTENSION_ID': JSON.stringify(env.EXTENSION_ID)
    }),
    // Add NodePolyfillPlugin to handle Node.js polyfills
    new NodePolyfillPlugin(),
    // Provide global Buffer and process
    new webpack.ProvidePlugin({
      Buffer: ['buffer', 'Buffer'],
      process: 'process/browser.js',
    }),
    // Ignore specific Node.js specific modules
    new webpack.IgnorePlugin({
      resourceRegExp: /^node:url$/
    }),
    new CopyWebpackPlugin({
      patterns: [
        {
          from: "src/manifest.json",
          to: path.join(__dirname, "build"),
          force: true,
          transform: function (content, path) {
            // generates the manifest file using the package.json informations
            return Buffer.from(
              JSON.stringify({
                description: process.env.npm_package_description,
                version: process.env.npm_package_version,
                ...JSON.parse(content.toString()),
              })
            );
          },
        },
        // Add binary file handling
        {
          from: "src/assets/img/logo.png",
          to: path.join(__dirname, "build", "assets", "img"),
          force: true,
        },
        {
          from: "public", // Copy from the 'public' directory
          to: path.join(__dirname, "build"), // To the root of the 'build' directory
          force: true,
        },
      ],
    }),
    // Use HtmlWebpackPlugin for the offscreen document to ensure proper bundling
    new HtmlWebpackPlugin({
      template: path.join(__dirname, "src", "offscreen", "offscreen.html"),
      filename: "offscreen/offscreen.html",
      chunks: ["offscreen/offscreen"],
      inject: true,
      cache: false,
      minify: false
    }),
  ].filter(Boolean),
  infrastructureLogging: {
    level: "info",
  },
  devServer: {
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    }
  },
};

if (env.NODE_ENV === "development") {
  options.devtool = "cheap-module-source-map";
} else {
  options.devtool = "source-map";
  options.optimization = {
    minimize: true,
    minimizer: [
      new TerserPlugin({
        extractComments: false,
        terserOptions: {
          compress: {
            drop_console: true
          },
        }
      }),
    ],
    splitChunks: false,
  };
}

// Chrome extension specific configuration
const chromeExtensionBoilerplate = {
  // Exclude extension scripts from hot module replacement
  notHotReload: [
    'background/background',
    'content/content', 
    'offscreen/offscreen',
    'interceptor/network-interceptor',
    'interceptor/injection-scripts'
  ]
};

// Add the extension configuration to the options
options.chromeExtensionBoilerplate = chromeExtensionBoilerplate;

module.exports = options;
