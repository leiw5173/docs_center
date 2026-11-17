# 主仓库与后端接口契约 v1

两个仓库独立安装、测试和部署。主仓库不读取后端数据库或运行配置，不访问生产 OSS/Redis。接口消息只包含来源、固定 SHA、发布清单和检查/执行信息。

## 后端 → 主仓库：候选通知

后端验证业务仓库 Webhook 签名、合并状态、注册来源与分支，将事件存入耐久队列。治理模式下不创建发布执行任务，而是调用 GitHub：

```text
POST /repos/leiw5173/docs_center/dispatches
event_type: document-source-merged
client_payload: {repository: "owner/repo", commit: "40位SHA", pullRequest: 业务PR号}
```

成功投递后状态为 `FORWARDED`，表示进入候选流程，不代表已发布。GitHub 暂不可用则保持 `PENDING`。重复或旧事件由候选生成器幂等处理；历史分叉拒绝自动替换。

## 主仓库 → 后端：登记配置

```text
POST /admin/documents/governance/registration
X-Document-Release-Token: 受保护环境中的专用凭据
{governanceRepository, governanceCommit, pullRequest, registry}
```

后端从 GitHub 重新核实登记 PR：确实合并、目标分支正确、合并人员有文档维护权限、预览检查通过、提交中的 registry 与请求一致。登记来源及 Webhook 路由后，为固定当前版本生成耐久首轮候选事件。已有正文的来源身份/前缀迁移会拒绝，须制定迁移计划；不会通过登记操作隐式删除仓库。

## 主仓库 → 后端：候选预览

```text
POST /admin/documents/previews
X-Document-Preview-Token: 专用预览凭据
请求体：候选 manifest
响应：application/zip 静态预览包
```

后端重新拉取固定提交，检查正文和资源哈希，使用与正式发布相同的 CommonMark 渲染器及锚点规则，生成目录入口、HTML、资源和清单。该过程只在请求内存中生成产物，不修改正式数据库、发布指针或外部同步队列。GitHub 后端预览任务执行默认分支代码，从 PR 的固定 head SHA 取得清单，成功后上传私有预览 Artifact；没有预览服务配置时明确失败，不能跳过并假装通过。

## 主仓库 → 后端：发布固定清单

```text
POST /admin/documents/releases
X-Document-Release-Token: 同上
{governanceRepository, governanceCommit, pullRequest, manifest}
```

`manifest` 含 `groupId`、`groupRepositories`、语言、目录子类和各来源固定提交、正文/资源 SHA-256、引用、迁移映射、标签、反馈和人工核对项。后端验证 PR 与清单来源，并重新读取固定正文和资源、逐项比对哈希。

所有来源在同一事务切换。任一来源失败则整批不生效；相同清单重复调用返回 `ALREADY_PUBLISHED`，旧合并事件不得覆盖新版本。受理后返回 `PUBLISHING` 或 `CATALOG_PUBLISHED` 及 `releaseId`。`GET /admin/documents/releases/{releaseId}` 查询持久结果，仍使用发布凭据；最终状态为 `PUBLISHING`、`SUCCEEDED`、`FAILED` 或 `SUPERSEDED`。仅本地模式会明确说明未启用外部同步。最终回报等待本组已配置同步全部完成，再以幂等评论回写原 PR；发送失败持久重试，不能把受理或单个来源成功当成整组成功。

地址迁移和标签随发布事务写入；官网可通过 `GET /document/resolve?language=zh&sourcePath=...` 查询目标路径和标签。不可见正文不通过别名暴露；历史 `release` 链接保持固定。

## 上线检查与回滚边界

本实现保证候选隔离、固定 SHA/哈希检查和数据库事务回滚。流程中的上线后检查（页面打不开、正文渲染失败、线上清单不一致）、上一完整版本部署回滚与通知，需要部署执行方提供探测和恢复接口后继续接入。目前不把这些未接入能力标为发布验收通过。

新增关联组清单位于 `document-center/releases/<language>/<groupId>.json`，分支为 `document-release/<language>/<groupId>`。旧版单语言清单仍可读取。组内来源原子切换，独立组只更新各自来源的版本、标签和修订记录，不覆盖其他组。

登记 PR 使用 `registry.change.repositoryId` 指明本次接入/调整项；仅对该项注册、生成首轮通知，已有来源不随一次新接入而批量重发。分类可按现有节点 ID 或完整名称路径定位，非法目标不允许部分生效。
