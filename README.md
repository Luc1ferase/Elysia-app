# Elysia App

跨境电商定价系统桌面端，采用 `Tauri + React + TypeScript`，支持 Windows、Linux、macOS（含 Apple Silicon）。

## 功能

- 本地优先数据存储，API 不可用时仍可继续使用
- 商品、物流、上架记录、定价、站点配置分标签页管理
- 商品按国家/站点分表浏览，并维护国家级 SKU
- 单站点查看与双站点左右对比
- 基于需求文档的费用、利润、毛利率计算
- 与服务器 API 的手动推送 / 拉取同步
- 每10分钟自动推送到服务器
- 业务洞察可视化：站点利润对比图表、商品成本TOP10图表
- 商品父子分组展开/收起功能
- 实时同步状态显示

## 运行

```bash
npm install
npm run import:workbook
npm run validate:formulas
npm run tauri dev
```

仅前端调试：

```bash
npm run dev
```

## 架构说明

- 应用工作区默认保存在桌面端本地 `IndexedDB`，同步配置保存在 `localStorage`
- 服务器 API 仅在用户主动同步时参与
- 任一端故障都不会阻断另一端工作

## Excel 模板导入

- 将原始工作簿导出的 JSON 放在仓库根目录
- 在 `elysia-app` 下运行 `npm run import:workbook`
- 启动后点击界面内的“导入 Excel 站点模板”即可把站点参数和物流价卡载入本地工作区
- 点击“导入 Excel 样例全量数据”可同时载入样例商品与上架记录
- 工作区支持导出为 JSON，并可再次从界面导回
- 运行 `npm run validate:formulas` 可用 `formula_validation_fixture.json` 对拍桌面端公式
