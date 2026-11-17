# 真实来源导入清单

核验日期：2026-11-16。共核实 14 个公开真实仓库，默认分支均为 `main`；14 个均已登记到当前五栏目；课程仓库按用户确认归入“应用案例 → 教学与实践”。此次只登记来源和核验信息，不复制正文，不生成发布清单，不调用后端，不触发正式发布。

入口：[可执行来源登记](../document-center/registry.json) · [完整机器可读清单](../document-center/source-inventory.json)

## 仓库与正文入口

| 来源仓库 | 中文 Markdown | 英文 Markdown | 默认栏目 | 现有栏目分布 |
| --- | ---: | ---: | --- | --- |
| [docs-ai](https://github.com/spacemit-com/docs-ai) | [46](https://github.com/spacemit-com/docs-ai/tree/main/zh) | [46](https://github.com/spacemit-com/docs-ai/tree/main/en) | AI 开发 | AI 开发、应用案例 |
| [docs-bianbu](https://github.com/spacemit-com/docs-bianbu) | [52](https://github.com/spacemit-com/docs-bianbu/tree/main/zh) | [52](https://github.com/spacemit-com/docs-bianbu/tree/main/en) | 操作系统 | 操作系统 |
| [docs-buildroot](https://github.com/spacemit-com/docs-buildroot) | [174](https://github.com/spacemit-com/docs-buildroot/tree/main/zh) | [174](https://github.com/spacemit-com/docs-buildroot/tree/main/en) | 操作系统 | 操作系统 |
| [docs-chip](https://github.com/spacemit-com/docs-chip) | [44](https://github.com/spacemit-com/docs-chip/tree/main/zh) | [99](https://github.com/spacemit-com/docs-chip/tree/main/en) | 硬件 | 硬件 |
| [docs-cloud](https://github.com/spacemit-com/docs-cloud) | [2](https://github.com/spacemit-com/docs-cloud/tree/main/zh) | [2](https://github.com/spacemit-com/docs-cloud/tree/main/en) | 工具 | 工具 |
| [docs-courses](https://github.com/spacemit-com/docs-courses) | [93](https://github.com/spacemit-com/docs-courses/tree/main/zh) | 未提供 | 应用案例 → 教学与实践 | 用户确认归属，尚未发布 |
| [docs-ecosys](https://github.com/spacemit-com/docs-ecosys) | [8](https://github.com/spacemit-com/docs-ecosys/tree/main/zh) | [2](https://github.com/spacemit-com/docs-ecosys/tree/main/en) | 操作系统 | 操作系统 |
| [docs-events](https://github.com/spacemit-com/docs-events) | [24](https://github.com/spacemit-com/docs-events/tree/main/zh) | 未提供 | 应用案例 | 应用案例 |
| [docs-openharmony](https://github.com/spacemit-com/docs-openharmony) | [48](https://github.com/spacemit-com/docs-openharmony/tree/main/zh) | [2](https://github.com/spacemit-com/docs-openharmony/tree/main/en) | 操作系统 | 操作系统 |
| [docs-openwrt](https://github.com/spacemit-com/docs-openwrt) | [6](https://github.com/spacemit-com/docs-openwrt/tree/main/zh) | [6](https://github.com/spacemit-com/docs-openwrt/tree/main/en) | 操作系统 | 操作系统 |
| [docs-product](https://github.com/spacemit-com/docs-product) | [57](https://github.com/spacemit-com/docs-product/tree/main/zh) | [57](https://github.com/spacemit-com/docs-product/tree/main/en) | 硬件 | 硬件 |
| [docs-ros](https://github.com/spacemit-com/docs-ros) | [260](https://github.com/spacemit-com/docs-ros/tree/main/zh) | [260](https://github.com/spacemit-com/docs-ros/tree/main/en) | AI 开发 | AI 开发、应用案例 |
| [docs-service](https://github.com/spacemit-com/docs-service) | [2](https://github.com/spacemit-com/docs-service/tree/main/zh) | 未提供 | 硬件 | 硬件 |
| [docs-tool](https://github.com/spacemit-com/docs-tool) | [22](https://github.com/spacemit-com/docs-tool/tree/main/zh) | [22](https://github.com/spacemit-com/docs-tool/tree/main/en) | 工具 | 操作系统、工具 |

Markdown 数包含目录 `index.md`，不等同于正文文章数。语言与文件计数根据 GitHub 当前目录核实，并记录语言目录的 Git tree SHA；不根据中文路径推断英文正文齐备。

## 配置依据与发布边界

- 仓库名、默认分支、语言目录和 Markdown 数已在线核对。
- 登记 ID、`prefix`、`rootDep` 沿用新文档后端 2026-11-12 的本地快照；该快照来自原型中的公开来源元数据，不是原生产数据库导出，不能当作生产配置已核实。
- 默认栏目按现有导航的主要归属填写。`docs-ros`、`docs-ai`、`docs-tool` 的跨栏目分布完整记录在 `source-inventory.json`；正式接入发布前仍须保留逐文档导航映射，不能把仓库默认栏目当作所有文档的唯一栏目。
- `docs-courses` 按用户确认登记在“应用案例 → 教学与实践”，父节点为 `cases/cases-teaching-practice`；该节点在现有导航中已存在，子类信息已接入候选清单及发布执行。来源前缀仍为 `courses`，不因展示归属变更而修改来源地址。核验清单中的旧导航计数保留为历史证据，不代表课程已在线上展示。
- 这 14 个来源来自当前本地快照的接入范围，不是整个 GitHub 组织或生产系统的全量清单。
- 不导入 `docs-test` 等合成测试仓库。没有新增来源凭据或生产连接。

后续接入和归类仍通过 Issue/PR 审核；本次导入不代表已完成链接、内容完整性、资源、预览和发布验收。
