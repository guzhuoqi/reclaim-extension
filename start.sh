#!/bin/bash

# Reclaim Extension 启动脚本
# Author: Assistant
# Description: 一键启动 Reclaim Extension 开发环境

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 输出函数
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

# 横幅
print_banner() {
    echo -e "${BLUE}"
    echo "╔═══════════════════════════════════════════════════════════════╗"
    echo "║                                                               ║"
    echo "║           🔒 Reclaim Extension 开发环境启动器               ║"
    echo "║                                                               ║"
    echo "║  功能：                                                       ║"
    echo "║  • 自动检查和安装依赖                                        ║"
    echo "║  • 启动开发服务器 (localhost:3005)                          ║"
    echo "║  • 构建扩展文件                                              ║"
    echo "║  • 启动测试页面服务器                                        ║"
    echo "║                                                               ║"
    echo "╚═══════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

# 检查依赖
check_dependencies() {
    log_info "检查系统依赖..."
    
    # 检查 Node.js
    if ! command -v node &> /dev/null; then
        log_error "Node.js 未安装，请先安装 Node.js"
        exit 1
    fi
    
    # 检查 npm
    if ! command -v npm &> /dev/null; then
        log_error "npm 未安装，请先安装 npm"
        exit 1
    fi
    
    local node_version=$(node --version)
    local npm_version=$(npm --version)
    log_success "Node.js $node_version ✓"
    log_success "npm $npm_version ✓"
}

# 安装项目依赖
install_dependencies() {
    log_info "检查项目依赖..."
    
    if [ ! -d "node_modules" ]; then
        log_warning "node_modules 不存在，开始安装依赖..."
        npm install
        log_success "依赖安装完成"
    else
        log_success "项目依赖已存在"
    fi
}

# 设置 ZK 资源
setup_zk_resources() {
    log_info "设置零知识证明资源..."
    
    if [ ! -d "build/browser-rpc/resources" ]; then
        log_info "下载和设置 ZK 资源..."
        if [ -f "setup-reclaim.sh" ]; then
            chmod +x setup-reclaim.sh
            ./setup-reclaim.sh
        else
            # 后备方案
            if [ -f "script.sh" ]; then
                chmod +x script.sh
                ./script.sh
            fi
        fi
        log_success "ZK 资源设置完成"
    else
        log_success "ZK 资源已存在"
    fi
}

# 构建扩展
build_extension() {
    log_info "构建 Chrome 扩展..."
    
    # 检查是否需要重新构建
    if [ ! -d "build" ] || [ "src" -nt "build" ]; then
        npm run build
        log_success "扩展构建完成"
    else
        log_success "扩展文件已是最新"
    fi
}

# 复制测试页面到build目录
copy_test_pages() {
    log_info "复制测试页面到build目录..."
    
    # 确保build目录存在
    mkdir -p build
    
    # 复制测试页面
    if [ -f "test-example.html" ]; then
        cp test-example.html build/
        log_success "基础测试页面已复制"
    fi
    
    if [ -f "quick-test-with-provider.html" ]; then
        cp quick-test-with-provider.html build/
        log_success "完整测试页面已复制"
    fi
    
    if [ -f "provider-setup-guide.html" ]; then
        cp provider-setup-guide.html build/
        log_success "设置指南页面已复制"
    fi
    
    if [ -f "real-provider-test.html" ]; then
        cp real-provider-test.html build/
        log_success "真实 Provider 测试页面已复制"
    fi
    
    if [ -f "standalone-provider-test.html" ]; then
        cp standalone-provider-test.html build/
        log_success "独立测试页面已复制"
    fi
    
    if [ -f "official-sdk-test.html" ]; then
        cp official-sdk-test.html build/
        log_success "官方SDK测试页面已复制"
    fi
    
    # 设置本地SDK文件
    if [ -f "node_modules/@reclaimprotocol/js-sdk/dist/index.js" ]; then
        mkdir -p build/js
        cp node_modules/@reclaimprotocol/js-sdk/dist/index.js build/js/reclaim-sdk.js
        log_success "本地SDK文件已准备"
    fi
}

# 启动开发服务器
start_dev_server() {
    log_info "启动开发服务器..."
    log_warning "开发服务器将在 http://localhost:3005 运行"
    log_warning "按 Ctrl+C 停止服务器"
    
    echo ""
    log_info "🌐 可用的测试页面："
    echo -e "${GREEN}  📋 基础测试: ${BLUE}http://localhost:3005/test-example.html${NC}"
    echo -e "${GREEN}  🚀 完整测试: ${BLUE}http://localhost:3005/quick-test-with-provider.html${NC}"
    echo -e "${GREEN}  🔐 真实 Provider: ${BLUE}http://localhost:3005/real-provider-test.html${NC}"
    echo -e "${GREEN}  🌐 独立测试页面: ${BLUE}http://localhost:3005/standalone-provider-test.html${NC}"
    echo -e "${GREEN}  📊 官方SDK测试: ${BLUE}http://localhost:3005/official-sdk-test.html${NC}"
    echo -e "${GREEN}  📖 设置指南: ${BLUE}http://localhost:3005/provider-setup-guide.html${NC}"
    echo ""
    
    log_info "🔧 扩展调试："
    echo -e "${GREEN}  1. 打开 ${BLUE}chrome://extensions/${NC}"
    echo -e "${GREEN}  2. 启用 '开发者模式'${NC}"
    echo -e "${GREEN}  3. 点击 '加载已解压的扩展程序'${NC}"
    echo -e "${GREEN}  4. 选择项目的 ${BLUE}build/${NC} 目录"
    echo ""
    
    npm run dev
}

# 清理函数
cleanup() {
    log_info "正在关闭开发服务器..."
    exit 0
}

# 设置信号处理
trap cleanup SIGINT SIGTERM

# 主函数
main() {
    print_banner
    
    # 检查当前目录
    if [ ! -f "package.json" ]; then
        log_error "请在 Reclaim Extension 项目根目录中运行此脚本"
        exit 1
    fi
    
    # 执行启动步骤
    check_dependencies
    install_dependencies
    setup_zk_resources
    build_extension
    
    log_success "🎉 所有准备工作完成！"
    echo ""
    
    # 复制测试页面
    copy_test_pages
    
    # 启动开发服务器
    start_dev_server
}

# 运行主函数
main "$@"
