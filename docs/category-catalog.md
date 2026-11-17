# 接入分类目录表

核对日期：2026-11-17。本表与接入表单的“目标分类”使用同一份[分类登记](../document-center/categories.json)。本轮从当前测试站已存在、可接受来源接入的目录核对；正式启用前需按实际启用环境复核。

## 文档团队如何选择

在接入表单选择完整中文分类即可，不需要填写栏目代码、节点 ID 或重复抄写分类路径。选择顶级栏目表示放在该栏目下；选择子类表示放在该子类下。

| 网站栏目 | 内部代码 | 内容归属参考 |
| --- | --- | --- |
| 硬件 | hardware | 芯片、板卡、整机及硬件支持 |
| 操作系统 | os | 系统使用、构建、集成与镜像安装 |
| AI软件栈 | ai | AI 应用、计算软件栈及计算架构 |
| 应用案例 | cases | 应用实践、课程、教学与实践 |
| 常用工具 | tools | 开发工具及工具使用手册 |

## 当前可选位置

<!-- categories:start -->

| 目标分类（表单显示） | 栏目 | 子类节点 ID（自动填写，无需抄写） |
| --- | --- | --- |
| 硬件 | 硬件 | `hardware` |
| 硬件 / 芯片 / K 系列 AI CPU 芯片 | 硬件 | `hardware/hardware-5dcfdf80b583fa3f/csv-a35bc7e7a76efde887af` |
| 硬件 / 芯片 / P 系列电源芯片 | 硬件 | `hardware/hardware-5dcfdf80b583fa3f/csv-bda3c984cf3295872e92` |
| 硬件 / 芯片 / V 系列服务器芯片 | 硬件 | `hardware/hardware-5dcfdf80b583fa3f/csv-3332147b5f8dd5b8b41b` |
| 硬件 / 板卡与整机 / K3 系列 | 硬件 | `hardware/hardware-7e1f3854607bec1f/hardware-0fb98f8a081a35d3` |
| 硬件 / 板卡与整机 / K1 系列 | 硬件 | `hardware/hardware-7e1f3854607bec1f/hardware-cb79ff68db281b7f` |
| 硬件 / 板卡与整机 / V100 系列 | 硬件 | `hardware/hardware-7e1f3854607bec1f/hardware-3fdbf180960383bb` |
| 硬件 / 板卡与整机 / 生态板块与设备 | 硬件 | `hardware/hardware-7e1f3854607bec1f/hardware-ecosystem-devices` |
| 硬件 / 板卡与整机 / 硬件配件 | 硬件 | `hardware/hardware-7e1f3854607bec1f/hardware-138e4a2f6b4047e1` |
| 硬件 / 支持与服务 | 硬件 | `hardware/hardware-dbbe5bbf851d8f07` |
| 操作系统 | 操作系统 | `os` |
| 操作系统 / Bianbu / Bianbu 用户指南 / LXQt / MUSE Pi | 操作系统 | `os/os-27e42591c00b5520/os-c048af055eb09c53/os-58574cb392fa9c27/csv-6931c46cbea9893dd2a4` |
| 操作系统 / Bianbu / Bianbu 用户指南 / LXQt / MUSE Pi / MUSE Pi Pro 拓展 I | 操作系统 | `os/os-27e42591c00b5520/os-c048af055eb09c53/os-58574cb392fa9c27/csv-6931c46cbea9893dd2a4/csv-00c89b75095c39f2530a` |
| 操作系统 / Bianbu / 系统集成 / Bianbu 2.1 | 操作系统 | `os/os-27e42591c00b5520/os-1f5b2a9125308ddf/csv-ebea5827a9462d920be6` |
| 操作系统 / Buildroot / K3 Buildroot / 安全 / CA 开发指南 | 操作系统 | `os/os-f4b5b1e54b76e98d/os-11105ec1c221e6c2/os-a6ac06c57226ace8/csv-fcb1b58ebc97119b4ba5` |
| 操作系统 / OpenHarmony / 技术专题 / AI推理库专题 / SpaceMIT K3 AI 推理库使用文档（llama.cpp C API | 操作系统 | `os/os-8aa903fa0d71df65/os-485e1ca357f61597/os-34f4c3443998f92a/csv-de16ffab15b04b59f84a` |
| 操作系统 / 镜像安装 | 操作系统 | `os/csv-717ffbdfa8cf697ff011` |
| AI软件栈 | AI软件栈 | `ai` |
| 应用案例 | 应用案例 | `cases` |
| 应用案例 / 教学与实践 | 应用案例 | `cases/cases-teaching-practice` |
| 常用工具 | 常用工具 | `tools` |
| 常用工具 / 使用手册 | 常用工具 | `tools/tools-common-manuals` |

<!-- categories:end -->

## 没有合适分类时

提交[文档反馈与治理调整](https://github.com/leiw5173/docs_center/issues/new?template=document-feedback.yml)，问题类型选择“分类新增或调整”，说明父分类、希望新增的名称、内容范围、来源仓库及负责人。不要临时选择无关分类或自行猜测节点 ID。

该反馈由文档团队人工协调，不会自动创建网站分类。确认目录已存在、位置与各发布语言可用后，维护人员通过 PR 同步分类登记、表单及本表；申请人再提交接入表单。分类新增本身不发布正文。

网站上的文章链接、带下级内容的文档入口不一定都是可接入的目录，因此本表不是所有导航文字的清单。目标在执行前仍会校验，已删除或不可用的分类不能靠旧表单放行。

## 维护责任

文档团队负责分类名称、内容边界及归属确认；维护人员负责目录节点与登记的一致性。新增、改名、移动或删除分类均需复核本表和表单，不能只修改显示名称。内部 ID 保持稳定，避免因名称变化而丢失已有归属。

维护人员核对实际目录后，在 PR 中调整 `document-center/categories.json` 及核对日期，运行 `npm run sync:categories` 同步表单选项和本页表格，再运行 `npm test`。测试会检查三者一致性。文档团队日常仍通过分类反馈申请，不需要手工修改这些文件。
