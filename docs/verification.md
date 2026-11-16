# 本地验证记录

验证日期：2026-11-16。主仓库独立检出于 `/home/sam/SpacemitDocuments/docs_center`；后端改动位于原 `document-directory-backend` 工作区的 `document-backend` 模块。提交与推送状态以 Git 记录为准；未执行生产部署。

| 检查 | 结果与边界 |
| --- | --- |
| 独立安装 | 主仓库 `npm ci --ignore-scripts` 成功，独立 package/lock，不依赖官网项目 |
| 主仓库测试 | `npm test`：15/15 通过，覆盖固定 Git 对象、正文/资源哈希、链接/锚点、目录、翻译提醒、跨仓库引用、地址/版本变化、静态预览、旧事件与分叉、Issue 字段 |
| 工作流文件 | YAML 与 3 个 Issue 表单可解析；检查与后端预览依赖关系、脚本语法已核对；尚未在 GitHub Actions 实跑 |
| 后端全量回归 | 隔离 Docker + H2 + 禁用容器网络：170 项，167 通过、0 失败、3 跳过 |
| 跳过项 | 1 项需要真实 Redis 环境，2 项 HTTP 数据集测试需要 `DOCUMENT_HTTP_TEST_DATA`；不能把跳过算作通过 |
| 后端针对性回归 | 治理发布类 10/10 通过，覆盖整批事务回滚、幂等、旧发布拒绝、Webhook 只投递候选、正文哈希、地址/标签、登记引导与隔离预览 |
| 浏览器预览 | CI 合成预览及后端实际生成的合成 ZIP 均验证目录跳转、中文锚点、图片、刷新、返回和无 pageerror |
| 官网接入 | `npm run build:dev -- --outDir /tmp/document-governance-site-dist`：类型检查及构建通过；输出到临时目录 |

真实来源 registry 初始为空。后续需要配置 GitHub App/专用 token、文档维护人员、分支保护、预览与正式环境、后端 HTTPS 地址，并验证真实 PR、回报及外部同步。上线后页面探测、完整部署回滚和通知接口尚未接入；当前事务成功只证明本地目录/正文切换成功。

合成产物：`/tmp/document-governance-preview/index.html` 和 `/tmp/document-governance-backend-preview/site/index.html`。这些不是正式文档或生产预览。
