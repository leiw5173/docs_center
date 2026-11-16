# 文档治理主仓库

本仓库对应 `https://github.com/leiw5173/docs_center`，与官网文档后端是**两个独立仓库**。

这里维护来源登记、目录与语言治理、引用关系、候选发布清单、Issue 表单和发布 PR。不存正文副本，不连接生产数据库、Redis 或 OSS。后端负责获取固定来源、转换正文/资源、切换发布版本、执行同步并回报。

## 文档团队操作

1. 新增来源：提交“文档仓库接入或调整”Issue，填写来源、语言、目标栏目、路径前缀和目录层级。机器人生成登记 PR，文档团队核对合并后，后端登记来源并生成首个候选。
2. 日常更新：在业务仓库合并正文、`index.md`、`sidebar_position` 修改。已验签的后端 Webhook 向本仓库发送固定 SHA 事件，自动创建或更新对应语言的发布 PR。
3. 查看 PR 的 `document-release-checks` 检查报告和 `document-release-preview` 后端预览 Artifact。后端按同一清单重新取固定正文/资源，使用正式渲染器生成隔离的静态预览，不切换线上版本。正文、资源、目录链接问题回业务仓库修改；迁移、引用登记、标签、反馈通过“补充发布 PR 的治理信息”Issue 更新 PR，无需编辑 JSON。
4. 文档团队核对预览、完整性和版本归档，手动合并发布 PR。受保护发布工作流通知后端，后端再次核对合并身份、检查结果和固定清单，再执行原子切换。

初始 `document-center/registry.json` 为空，必须通过接入表单登记真实来源；测试夹具不会自动成为正式来源。

## 本地验证

要求 Node.js 22+ 和 Git。

```bash
npm ci --ignore-scripts
npm test
npm run demo -- /tmp/document-governance-preview
node scripts/document-governance/run.cjs check \
  --manifest document-center/releases/zh.json \
  --output /tmp/document-preview/zh
```

`demo` 只生成明确标记的合成预览，不登记真实来源。`check` 只读取固定 Git 对象、生成检查报告和静态预览，不调用后端或修改线上内容。预览下载解压后，从预览目录运行 `python3 -m http.server 8090 --bind 127.0.0.1`，浏览器打开本地地址。

## 接入设置

本仓库只配置：

| 类型 | 名称 | 用途 |
| --- | --- | --- |
| Repository secret | `DOCUMENT_GOVERNANCE_TOKEN` | GitHub App/专用 token，写本仓库分支、PR，查询维护人员权限 |
| Repository variable | `DOCUMENT_GOVERNANCE_MAINTAINERS` | 明确允许的文档维护人员登录名，逗号分隔；个人仓库可配置 `leiw5173` |
| Repository variable | `DOCUMENT_GOVERNANCE_TEAM` / `DOCUMENT_GOVERNANCE_TEAM_ORG` | 可选组织团队，独立于本仓库 owner；与维护人员名单任选或并用 |
| Environment `document-production` secret | `DOCUMENT_RELEASE_TOKEN` | 调用后端发布协议的专用凭据，不是数据库/OSS 凭据 |
| Environment `document-production` variable | `DOCUMENT_PUBLISH_URL` | 后端 HTTPS 基地址 |
| Environment `document-preview` secret | `DOCUMENT_PREVIEW_TOKEN` | 仅调用后端候选预览，无发布权限，必须与 release token 不同 |
| Environment `document-preview` variable | `DOCUMENT_PREVIEW_URL` | 后端 HTTPS 基地址 |

必须将 `document-release-preview` 设为默认分支必需检查（它依赖自动检查通过），要求分支保持最新、保护治理工作流变更，禁止机器人批准/自动合并。后端预览任务执行默认分支的受信代码，只按 PR 固定 head SHA 读取候选清单，不把预览凭据交给 PR 的代码。`document-preview` 允许本仓库 PR 使用；`document-production` 应限制为默认分支。GitHub App/专用 token 创建的 PR 会触发检查；不要改用会抑制后续工作流的默认 `GITHUB_TOKEN` 创建候选 PR。

当前来源抓取支持公开 GitHub 仓库；私有业务源需要单独只读凭据和受信检查执行器，不能把写 token 注入不受信 PR 的检查代码。内部检查可见性由本仓库的访问权限决定，部署前应确认私有权限设置。

## 两仓库协议与范围

见 [流程设计](docs/document-maintenance-workflow.md)、[接口契约](docs/backend-contract.md) 和 [本地验证记录](docs/verification.md)。代码提交和推送不代表 GitHub Actions、真实预览和生产发布已经启用；生产部署尚未执行。

第一版把所有已登记来源的同语言内容整体发布，保守覆盖直接与间接引用。跨语言引用会阻断并提示；英文缺失本身不阻断中文。自动检查辅助发现内容问题，完整性和版本归档仍由文档团队核对。
