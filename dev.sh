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

echo -e "${GREEN}🌐 主开发服务器: ${BLUE}http://localhost:3005${NC}"
echo -e "${GREEN}🔧 Reclaim 后端服务器: ${BLUE}http://localhost:4000${NC}"
echo -e "${GREEN}📁 静态文件服务器: ${BLUE}http://localhost:3006${NC}"
echo ""
echo -e "${GREEN}🖥️  后端会话测试: ${BLUE}http://localhost:3005/backend-session-test.html${NC}"
echo ""
echo -e "${YELLOW}💡 提示: 按 Ctrl+C 停止所有服务器${NC}"
echo ""

# 启动后端服务器
echo -e "${YELLOW}🚀 启动 Reclaim 后端服务器 (端口4000)...${NC}"
npm run dev:backend &
BACKEND_PID=$!

echo -e "${YELLOW}🌐 启动静态文件服务器 (端口3006)...${NC}"
npm run dev:static &
STATIC_PID=$!

# 等待后端服务启动
sleep 2

echo -e "${GREEN}🎯 后端服务器状态:${NC}"
echo -e "${GREEN}  - Reclaim 后端: ${BLUE}http://localhost:4000${NC}"
echo -e "${GREEN}  - 静态文件服务器: ${BLUE}http://localhost:3006${NC}"
echo ""

# 启动主开发服务器
echo -e "${YELLOW}⚡ 启动主开发服务器 (端口3005)...${NC}"
npm run dev
BACKEND_PID=$!


# 复制测试页面到build目录
echo -e "${YELLOW}🔍 检查 backend-session-test.html 文件...${NC}"
if [ -f "backend-session-test.html" ]; then
    echo -e "${GREEN}✅ 找到源文件 backend-session-test.html${NC}"
    mkdir -p build
    cp backend-session-test.html build/ 
    if [ -f "build/backend-session-test.html" ]; then
        echo -e "${GREEN}📄 backend-session-test.html 已成功复制到build目录${NC}"
    else
        echo -e "${YELLOW}⚠️  拷贝失败，build目录中未找到文件${NC}"
    fi
else
    echo -e "${YELLOW}❌ 未找到 backend-session-test.html 文件${NC}"
fi


# 清理后台进程
cleanup() {
    echo -e "\n${YELLOW}🛑 停止所有服务器...${NC}"
    kill $BACKEND_PID $STATIC_PID 2>/dev/null || true
    exit 0
}

trap cleanup INT TERM
