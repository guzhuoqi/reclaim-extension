// 简易后端：用于用官方 Reclaim JS SDK 初始化会话（安全地使用 appSecret）
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { ReclaimProofRequest } = require('@reclaimprotocol/js-sdk');

const app = express();
const PORT = process.env.RECLAIM_BACKEND_PORT || 4000;

app.use(cors());
app.use(bodyParser.json());

// 健康检查
app.get('/health', (_req, res) => res.json({ ok: true }));

// 初始化 session（后端执行签名与注册）
app.post('/session/init', async (req, res) => {
  try {
    const {
      appId = '0x9d82Df8ed9C3B79B406116Da3D7789Baf4187D82',
      appSecret = '0x818b89ef3276834ea4f158469033b85a1535e653e7371ade225c6eee75ee3aa7',
      providerId = '6d3f6753-7ee6-49ee-a545-62f1b1822ae5',
      options = {}
    } = req.body || {};

    const proofReq = await ReclaimProofRequest.init(appId, appSecret, providerId, options);
    const sessionId = proofReq.getSessionId();
    const requestUrl = await proofReq.getRequestUrl();

    res.json({ isSuccess: true, sessionId, requestUrl });
  } catch (error) {
    console.error('[reclaim-backend] init error:', error);
    res.status(500).json({ isSuccess: false, message: error?.message || 'init failed' });
  }
});

app.listen(PORT, () => {
  console.log(`[reclaim-backend] listening on http://localhost:${PORT}`);
});


