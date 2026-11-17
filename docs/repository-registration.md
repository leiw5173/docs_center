# 接入填写指南

打开[文档仓库接入或调整表单](https://github.com/leiw5173/docs_center/issues/new?template=document-registration.yml)，按下表填写。

| 字段 | 填写说明 | 示例 |
| --- | --- | --- |
| 来源仓库 | 填写 GitHub 账户名和仓库名，格式为 `owner/repository`，不带网址前缀 | `example/docs-new` |
| 分支 | 填写实际存放文档的分支。新接入留空默认 `main`；调整已有来源时，留空沿用原分支 | `main` 或 `master` |
| 语言 | 支持多选：只有中文选 `zh`，只有英文选 `en`，中英文都有时同时选择 `zh` 和 `en`。仓库应有对应的 `zh/`、`en/` 文档目录 | 中文：`zh`；英文：`en`；中英文：同时勾选两项 |
| 目标分类 | 从下拉列表选择展示位置，最多为“顶级栏目 / 直接子类”。可选位置见[分类目录表](category-catalog.md) | `操作系统 / Bianbu` |
| 来源标识（可选） | 通常留空，新来源默认用仓库名生成；提示重名时再填写唯一名称，仅使用字母、数字、下划线和短横线。已有来源保留原标识和地址前缀 | 默认 `docs-new`；重名时可填 `teaching-docs-new` |
