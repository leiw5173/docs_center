# 文档治理主仓库

本仓库用于统一维护文档来源、目录、语言、引用关系和发布审核记录，由文档团队通过 GitHub Issue 与 Pull Request 协作维护。文档正文保存在各业务仓库。

## 仓库任务

- 登记来源仓库、分支、语言和目标目录。
- 维护目录归属、文档引用、地址迁移、标签与反馈。
- 检查候选文档的链接、资源、目录结构和配套信息。
- 生成候选发布清单，记录来源修订、检查结果和预览。
- 由文档团队核对并手动合并发布 PR，保留变更与确认记录。

## 查看真实来源

当前已核实 14 个真实来源仓库，13 个已登记到现有五栏目；课程仓库保留为待归类来源。

- [来源仓库与正文入口](docs/source-import.md)
- [来源登记](document-center/registry.json)
- [完整核验清单](document-center/source-inventory.json)

## 日常维护

1. **接入或调整来源**：提交[文档仓库接入或调整](https://github.com/leiw5173/docs_center/issues/new?template=document-registration.yml)申请，填写来源仓库、语言、目标栏目和目录信息，由文档团队核对登记 PR。
2. **更新文档内容**：在对应业务仓库修改正文、资源、目录 `index.md` 和排序信息，按该仓库规则提交、合并 PR；在本仓库跟进对应的候选发布 PR。
3. **处理检查问题**：查看 PR 检查报告和预览。正文、资源、目录链接问题回业务仓库修正；地址迁移、引用、标签或反馈通过[治理信息表单](https://github.com/leiw5173/docs_center/issues/new?template=document-governance.yml)补充。一般问题也可提交[文档反馈](https://github.com/leiw5173/docs_center/issues/new?template=document-feedback.yml)。
4. **确认发布清单**：文档团队核对内容完整性、引用影响、语言状态、目录排序、预览及版本归档，确认检查通过后手动合并发布 PR。

来源登记不等于发布。是否可以发布，以相应 PR 的检查结果和文档团队确认为准。

## 维护约定

- 中文与英文分别维护；英文缺失本身不阻断中文，跨语言引用需单独核对。
- 有直接或间接引用关系的文档整体核对，避免分开更新造成断链。
- 新修订更新现有候选 PR 后，需要重新检查与确认。
- 小修也需文档团队确认；版本变更需核对旧版归档。
- 地址变更需登记迁移关系，保留既有链接的可追溯性。
- 测试数据与真实来源分开，待归类来源确认位置后再登记。

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

`demo` 生成合成数据预览；`check` 根据候选清单检查固定来源修订，并输出报告和静态预览。预览可在本地解压查看。自动检查用于辅助发现问题，内容完整性与发布确认仍由文档团队负责。
