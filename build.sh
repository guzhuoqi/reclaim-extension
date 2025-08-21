#!/bin/bash

# Reclaim Extension 构建脚本
# 用于生产环境构建

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

log_error() {
    echo -e "${RED}❌ $1${NC}"
}

echo -e "${BLUE}🔨 Reclaim Extension - 生产构建${NC}"
echo ""

# 检查依赖
log_info "检查项目依赖..."
if [ ! -d "node_modules" ]; then
    log_warning "安装依赖..."
    npm install
fi

# 设置 ZK 资源
log_info "设置零知识证明资源..."
if [ ! -d "build/browser-rpc/resources" ]; then
    if [ -f "setup-reclaim.sh" ]; then
        chmod +x setup-reclaim.sh
        ./setup-reclaim.sh
    fi
fi

# 生产构建
log_info "开始生产构建..."
npm run build

log_success "🎉 构建完成！"
echo ""
echo -e "${GREEN}📦 扩展文件位于: ${BLUE}build/${NC}"
echo -e "${GREEN}🌐 可以加载到浏览器进行测试${NC}"
echo ""
echo -e "${YELLOW}📋 加载步骤:${NC}"
echo -e "  1. 打开 ${BLUE}chrome://extensions/${NC}"
echo -e "  2. 启用 '开发者模式'"
echo -e "  3. 点击 '加载已解压的扩展程序'"
echo -e "  4. 选择 ${BLUE}build/${NC} 目录"
