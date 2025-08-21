#!/bin/bash

# Reclaim Extension 快速开发模式
# 跳过检查，直接启动开发服务器

set -e

# 颜色输出
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}🚀 Reclaim Extension - 快速开发模式${NC}"
echo -e "${YELLOW}⚡ 跳过依赖检查，直接启动...${NC}"
echo ""

echo -e "${GREEN}🌐 开发服务器: ${BLUE}http://localhost:3005${NC}"
echo -e "${GREEN}📋 基础测试页面: ${BLUE}http://localhost:3005/test-example.html${NC}"
echo -e "${GREEN}🧪 完整测试页面: ${BLUE}http://localhost:3005/quick-test-with-provider.html${NC}"
echo -e "${GREEN}🔐 真实 Provider 测试: ${BLUE}http://localhost:3005/real-provider-test.html${NC}"
echo -e "${GREEN}🌐 独立测试页面: ${BLUE}http://localhost:3005/standalone-provider-test.html${NC}"
echo -e "${GREEN}📊 官方SDK测试: ${BLUE}http://localhost:3005/official-sdk-test.html${NC}"
echo ""
echo -e "${YELLOW}💡 提示: 按 Ctrl+C 停止服务器${NC}"
echo ""

# 复制测试页面到build目录
if [ -f "test-example.html" ]; then
    cp test-example.html build/ 2>/dev/null || true
fi
if [ -f "quick-test-with-provider.html" ]; then
    cp quick-test-with-provider.html build/ 2>/dev/null || true
fi
if [ -f "provider-setup-guide.html" ]; then
    cp provider-setup-guide.html build/ 2>/dev/null || true
fi
if [ -f "real-provider-test.html" ]; then
    cp real-provider-test.html build/ 2>/dev/null || true
fi
if [ -f "standalone-provider-test.html" ]; then
    cp standalone-provider-test.html build/ 2>/dev/null || true
fi
if [ -f "official-sdk-test.html" ]; then
    cp official-sdk-test.html build/ 2>/dev/null || true
fi

# 设置本地SDK文件和浏览器版本
if [ -f "node_modules/@reclaimprotocol/js-sdk/dist/index.js" ]; then
    mkdir -p build/js
    cp node_modules/@reclaimprotocol/js-sdk/dist/index.js build/js/reclaim-sdk.js 2>/dev/null || true
    echo -e "${GREEN}📦 本地SDK文件已准备${NC}"
    
    # 构建浏览器版本
    if [ -f "build-browser-sdk.js" ]; then
        echo -e "${YELLOW}🔄 构建浏览器版本SDK...${NC}"
        node build-browser-sdk.js 2>/dev/null && echo -e "${GREEN}✅ 浏览器SDK已构建${NC}" || echo -e "${RED}❌ 浏览器SDK构建失败${NC}"
    fi
fi

# 确保包装器文件存在
if [ ! -f "build/js/reclaim-sdk-wrapper.js" ]; then
    echo -e "${YELLOW}⚠️  包装器文件不存在，正在创建...${NC}"
    mkdir -p build/js
    cat > build/js/reclaim-sdk-wrapper.js << 'EOF'
// 简化的Reclaim SDK包装器 - 增强调试版本
(function() {
    'use strict';
    const originalModule = window.module;
    const originalExports = window.exports;
    window.module = { exports: {} };
    window.exports = window.module.exports;
    
    console.log('🔄 包装器开始执行，准备加载原始SDK...');
    const script = document.createElement('script');
    script.src = '/js/reclaim-sdk.js';
    
    script.onload = function() {
        try {
            const sdkExports = window.module.exports;
            console.log('🔍 SDK导出对象:', sdkExports);
            console.log('🔍 ReclaimProofRequest类型:', typeof sdkExports.ReclaimProofRequest);
            
            // 直接将SDK类暴露到全局变量
            window.ReclaimProofRequest = sdkExports.ReclaimProofRequest;
            window.verifyProof = sdkExports.verifyProof;
            window.ClaimCreationType = sdkExports.ClaimCreationType;
            window.RECLAIM_EXTENSION_ACTIONS = sdkExports.RECLAIM_EXTENSION_ACTIONS;
            window.transformForOnchain = sdkExports.transformForOnchain;
            
            // 同时保留SDK对象
            window.ReclaimSDK = {
                ReclaimProofRequest: sdkExports.ReclaimProofRequest,
                verifyProof: sdkExports.verifyProof,
                ClaimCreationType: sdkExports.ClaimCreationType,
                RECLAIM_EXTENSION_ACTIONS: sdkExports.RECLAIM_EXTENSION_ACTIONS,
                transformForOnchain: sdkExports.transformForOnchain
            };
            
            // 设置加载状态
            window.sdkLoaded = true;
            
            window.module = originalModule;
            window.exports = originalExports;
            console.log('✅ Reclaim SDK 包装器加载成功，全局变量已设置');
            window.dispatchEvent(new CustomEvent('reclaimSDKReady', { detail: window.ReclaimSDK }));
        } catch (error) {
            console.error('❌ SDK包装器处理失败:', error);
            window.module = originalModule;
            window.exports = originalExports;
            window.dispatchEvent(new CustomEvent('reclaimSDKError', { detail: error.message }));
        }
    };
    script.onerror = function() {
        window.module = originalModule;
        window.exports = originalExports;
        console.error('❌ SDK文件加载失败');
        window.dispatchEvent(new CustomEvent('reclaimSDKError', { detail: 'SDK文件加载失败' }));
    };
    document.head.appendChild(script);
})();
EOF
    echo -e "${GREEN}📦 SDK包装器文件已创建${NC}"
fi

# 直接启动开发服务器
npm run dev
