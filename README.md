# Elysia App

跨境电商定价系统桌面端，采用 `Tauri + React + TypeScript`，支持 Windows、Linux、macOS（含 Apple Silicon）。

## 功能

- 本地优先数据存储，API 不可用时仍可继续使用
- 商品、站点、物流价卡、上架价格的桌面端管理
- 单站点查看与双站点左右对比
- 基于需求文档的费用、利润、毛利率计算
- 与服务器 API 的手动推送 / 拉取同步

## 运行

```bash
npm install
npm run tauri dev
```

仅前端调试：

```bash
npm run dev
```

## 架构说明

- 应用数据默认保存在桌面端本地 `localStorage`
- 服务器 API 仅在用户主动同步时参与
- 任一端故障都不会阻断另一端工作
