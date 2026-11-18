# 文档治理主仓库

本仓库用于统一维护文档来源、目录、语言、引用关系和发布审核记录，由文档团队通过 GitHub Issue 与 Pull Request 协作维护。文档正文保存在各业务仓库。

## 仓库任务

- 登记来源仓库、分支、语言和目标目录。
- 维护目录归属、文档引用、地址迁移、标签与反馈。
- 检查候选文档的链接、资源、目录结构和配套信息。
- 生成候选发布清单，记录来源修订、检查结果和预览。
- 由文档团队核对并手动合并发布 PR，保留变更与确认记录。

## 查看真实来源

首批已核实并登记 14 个真实来源仓库。课程仓库 `docs-courses` 归入“应用案例 → 教学与实践”；后续接入情况以来源登记为准。

- [来源仓库与正文入口](docs/source-import.md)
- [来源登记](document-center/registry.json)
- [完整核验清单](document-center/source-inventory.json)

## 日常维护

1. **接入或调整来源**：先看[接入填写指南](docs/repository-registration.md)及[分类目录表](docs/category-catalog.md)，再提交[文档仓库接入或调整](https://github.com/leiw5173/docs_center/issues/new?template=document-registration.yml)申请。填写来源仓库、语言并选择中文目标分类；来源标识和地址自动生成或沿用，接入 PR 同时包含来源登记与首版清单，接入检查、内容检查和预览通过后，由文档团队确认并只合并一次。
2. **更新文档内容**：在对应业务仓库修改正文、资源、目录 `index.md` 和排序信息，按该仓库规则提交、合并 PR；在本仓库跟进对应的候选发布 PR。
3. **处理检查问题**：查看 PR 检查报告和预览。正文、资源、目录链接问题回业务仓库修正；地址迁移、引用、标签或反馈通过[治理信息表单](https://github.com/leiw5173/docs_center/issues/new?template=document-governance.yml)补充。一般问题也可提交[文档反馈](https://github.com/leiw5173/docs_center/issues/new?template=document-feedback.yml)。
4. **确认发布清单**：文档团队核对内容完整性、引用影响、语言状态、目录排序、预览及版本归档，确认检查通过后手动合并发布 PR。

提交接入申请不等于发布。新接入在同一个 PR 中完成登记和首版审核，合并后统一执行；日常更新继续通过候选发布 PR 确认。

目录子类随登记和候选清单维护。发布以仓库为最小单位，按直接、间接文档引用组成关联组；同组复用待发布 PR，不同组独立审核。检查状态和最终发布结果回写到相应 PR，任务受理不等于发布完成。

新仓库接入后，按 [新仓库注册与业务 PR 合并两类测试](docs/maintenance-acceptance.md) 验收；可使用 [测试文档样例](examples/business-repository) 准备内容。

已完成的真实测试及 Issue、PR、检查和结果记录见 [维护流程验收记录](docs/maintenance-acceptance-results.md)。

## 已发布文档巡检

每周一北京时间 09:20 自动运行。也可以从 Actions 的 [Document audit](https://github.com/leiw5173/docs_center/actions/workflows/document-audit.yml) 点击 **Run workflow**。勾选「只生成报告」可预查结果。

巡检同时读取官网已发布中英文文档和治理仓库已确认的固定清单。逐项结果在运行摘要和报告附件中。每类发现汇总为一条开放的「文档巡检」Issue，同类的新发现会更新现有 Issue。文档团队按报告修复来源或治理映射，并确认后关闭 Issue。

首次完整读取目录时建立基线。后续巡检以基线核对版本变化、归档和旧地址，并列出直接及间接引用。外站链接、不同路径的翻译配对和归档结果由文档团队核实。正文读取失败会进入覆盖异常报告。

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
```

`demo` 生成合成数据预览；`check` 可按候选清单路径检查固定来源修订，并输出报告和静态预览。关联组清单位于 `document-center/releases/<语言>/<关联组 ID>.json`。预览可在本地解压查看。自动检查用于辅助发现问题，内容完整性与发布确认仍由文档团队负责。
