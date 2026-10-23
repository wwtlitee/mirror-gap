# 镜隙 · 第三方来源与归因 · v8.5.0

维护：Unclecow；核验日期：2026-10-23。本文记录当前源码、运行数据和素材的来源；不为《镜隙》全部原创代码选择开源许可证。各许可仅适用于对应上游作品。许可原文副本在 [licenses/](licenses/)。

## 程序依赖

版本依据 `package-lock.json`，许可副本来自本机实际安装包；上游链接于 2026-10-23 核验。Three 用于浏览器渲染及模型处理；ethers 用于源码中的服务端地址与签名校验，当前静态构建排除 `wallet-auth.mjs`、`game-store.mjs`，不因此宣称浏览器运行了 ethers。

| 组件 | 作者 / 上游 | 许可副本 |
| --- | --- | --- |
| Three.js 0.186.0 | © 2010–2026 three.js authors；[官方仓库](https://github.com/mrdoob/three.js) | [MIT](licenses/three-0.186.0-MIT.txt) |
| ethers 6.17.0 | © 2016–2025 Richard Moore；[官方仓库](https://github.com/ethers-io/ethers.js) | [MIT](licenses/ethers-6.17.0-MIT.txt) |
| @adraffy/ens-normalize 1.11.1 | [raffy / 官方仓库](https://github.com/adraffy/ens-normalize.js) | [MIT](licenses/ens-normalize-1.11.1-MIT.txt) |
| @noble/curves 1.2.0 | [Paul Miller / 官方仓库](https://github.com/paulmillr/noble-curves) | [MIT](licenses/noble-curves-1.2.0-MIT.txt) |
| @noble/hashes 1.3.2 | [Paul Miller / 官方仓库](https://github.com/paulmillr/noble-hashes) | [MIT](licenses/noble-hashes-1.3.2-MIT.txt) |
| @types/node 22.7.5 | [DefinitelyTyped contributors](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/node) | [MIT](licenses/types-node-22.7.5-MIT.txt) |
| aes-js | [Richard Moore / 官方仓库](https://github.com/ricmoo/aes-js) | [本机包 MIT](licenses/aes-js-installed-4.0.0-beta.5-MIT.txt) |
| tslib 2.7.0 | [Microsoft](https://github.com/microsoft/tslib) | [0BSD](licenses/tslib-2.7.0-0BSD.txt)、[版权通知](licenses/tslib-2.7.0-CopyrightNotice.txt) |
| undici-types 6.19.8 | [Node.js contributors](https://github.com/nodejs/undici) | [MIT](licenses/undici-types-6.19.8-MIT.txt) |
| ws 8.21.0 | [ws contributors](https://github.com/websockets/ws) | [MIT](licenses/ws-8.21.0-MIT.txt) |

`aes-js` 使用官方 `ethers@6.17.0` 声明的 `4.0.0-beta.5`，与实际包许可一致。旧锁文件误写的 `4.1.0-beta.5` 下载地址返回404，已在独立目录重新生成锁文件并通过全新安装、构建及146个关键资源哈希对照；没有修改原项目的依赖链接。类型包列入来源记录，不等同于其在浏览器执行。

## 神经模型与连接组

- **Philip Shiu、Nico Spiller 的 Drosophila brain model**：源于 [philshiu/Drosophila_brain_model](https://github.com/philshiu/Drosophila_brain_model)，MIT，© 2023 Philip Shiu and Nico Spiller；保留[原文](licenses/Drosophila-brain-model-MIT.txt)。本项目功能子图数值主要读取该 MIT 仓库的 `Completeness_783.csv`、`Connectivity_783.parquet`，并参考具名神经元集合；它们是处理后的模型连接表。论文：[Shiu et al., Nature 2024](https://doi.org/10.1038/s41586-024-07763-9)。上游仓库与许可核验：2026-10-23。
- **FlyWire v783 连接表**：归因 FlyWire Consortium，以及 [Dorkenwald et al., Nature 2024](https://doi.org/10.1038/s41586-024-07558-y)。[Zenodo 10676866](https://zenodo.org/records/10676866) 的官方记录/API于 2026-10-23 明确标注 **CC BY 4.0**，包含 `proofread_connections_783.feather` 与 `proofread_root_ids_783.npy`；保留 [CC BY 4.0](licenses/CC-BY-4.0.txt)。该记录同时说明连接数据结合突触检测、神经递质预测及 FlyWire 校对；详见原记录对 Buhmann、Heinrich、Eckstein/Bates 等工作的归因。
- **FlyWire 注释 v3.1.0**：构建时用 `Supplemental_file1_neuron_annotations.tsv` 选择细胞及提供类型、左右侧标签；本仓分发筛选后的子图，不随包重新分发完整 TSV。对应[官方发布](https://github.com/flyconnectome/flywire_annotations/releases/tag/v3.1.0)与[注释论文 Schlegel et al., Nature 2024](https://doi.org/10.1038/s41586-024-07686-5)。截至 2026-10-23，该仓库没有独立 LICENSE 文件；[FlyWire 官方使用指南](https://flywire.ai/guidelines)将公开数据及 Codex 注释指向 **CC BY-NC 4.0**，附[许可原文](licenses/CC-BY-NC-4.0.txt)。该指引对本地 GitHub v3.1.0 注释副本的精确适用范围尚未单独确认。这是注释来源记录，不把处理连接表、事实子图与完整注释原表混为一物，也不将本项目全部原创代码改标为 NC 或宣称获得额外商业授权。
- [Zenodo 10877326](https://zenodo.org/records/10877326) 的 CC BY 4.0 标注对应 Schlegel 等人的补充文件记录。其许可不能自动扩展到所有版本的 GitHub 注释、Codex 数据或其他连接组产品。核验：2026-10-23。

**本项目的修改与科学边界**：功能图为 4,386 神经元、302,896 对有向连接的筛选子图；学习图为 1,259 神经元、73,304 对连接，其中 946 对具有可塑分量。它们约束数字果蝇的仿真连接结构，不构成整只生物大脑的复现。感觉投影、合成 PN 编码、神经增益、需求系统、三维身体动力学、运动校准与任务规则包含本项目工程假设。画面的脑形与抽样连线是示意；发光来自仿真脉冲，不能称为活体神经活动。实际数量和处理方法可对照 `scripts/build-functional-model.py`、`src/functional-connectome.json`、`src/mushroom-connectome.json` 及控制器源码。

## TapeOut

采用 [TAP-02](https://github.com/TapeOutProtocol/TAPs/blob/main/TAPs/TAP-02.md) 的 NAND/LATCH/REF 网表及逐拍语义，规范作者 Alda (@ronesync)；`public/tapeout-circuit.mjs` 是对照 [Python 参考实现](https://github.com/TapeOutProtocol/TAPs/blob/main/assets/tap-02/reference.py)编写的独立 JavaScript 实现。

官方 [TAPs LICENSE](https://github.com/TapeOutProtocol/TAPs/blob/main/LICENSE)于 2026-10-23 核验：TAP 文本、模板与测试向量为 CC0 1.0；`assets/` 示例与参考代码为 MIT，© 2026 TapeOutProtocol。保留[官方原文](licenses/TapeOut-TAPs-LICENSE.txt)与 [CC0](licenses/CC0-1.0.txt)。这不为任意第三方用户电路、合约字节码或 TapeOut 前端指定许可。该 JS 模块自己的许可证见其文件头，不扩展至整个游戏。

## 美术与音频

| 本地内容 | 来源、许可及修改 | 核验 |
| --- | --- | --- |
| `public/assets/kenney-home/` 家具 | [Kenney Furniture Kit](https://kenney.nl/assets/furniture-kit)，本地 2.0，CC0；布置、材质转换及部分几何细化由本项目完成；[原通知](licenses/Kenney-Furniture-Kit-2.0-CC0.txt) | 2026-10-23 |
| 同目录食物 | [Kenney Food Kit](https://kenney.nl/assets/food-kit)，本地 2.0，CC0；当前部分食品由本项目程序模型替代；[原通知](licenses/Kenney-Food-Kit-2.0-CC0.txt) | 2026-10-23 |
| `public/assets/kenney-nature/` | [Kenney Nature Kit](https://kenney.nl/assets/nature-kit)，本地 2.1，CC0；重排、材质与几何细化；[原通知](licenses/Kenney-Nature-Kit-2.1-CC0.txt) | 2026-10-23 |
| `public/assets/ambience/window-rain.ogg` | [Ylmir — Rain (loopable)](https://opengameart.org/content/rain-loopable)，CC0；本地循环、增益混音 | 2026-10-23 |

`public/assets/night-city/ad-atlas.png`、`ad-wide.png`、`ad-street.png`：仓内 [CREDITS.md](public/assets/night-city/CREDITS.md)记录为 2026-09-13 Unclecow 使用内置 imagegen 生成的虚构广告，未提取游戏原作素材。此为本项目生成素材来源说明，不将其归入 Kenney CC0。

`public/assets/natural-surfaces/` 为本项目定制生成的自然材质图。原工程 `GUIDE_全场写实精修与光照.md` v8.1.0c 记载了生成的木纹、石材、亚麻及面包表面图，对应 `walnut-v8.1.0c.png`、`limestone-v8.1.0c.png`、`linen-v8.1.0c.png`、`bread-v8.1.0c.png`；树皮 `bark-v8.1.0c.png` 另有内置 imagegen 生成记录。本仓未附这些历史生成调用日志；这是创作来源与归档范围说明，不将项目生成图自动归入第三方 MIT/CC0。

`public/assets/voices/` 为用户委托制作的 19 套、380 条固定台词 MP3。原工程 v7.0.0 计划记载复用用户已有 Sola Fish Audio 声线；v7.1.0 验收记录新增用户给出的 13 个 Fish ID，合计 19 套、380 条独立人格台词。生成器使用 Fish Audio、`s2.1-pro-free` 与保留的 referenceId，统一响度后输出 24kHz/64kbps；玩家播放同源音频，不在线请求生成服务。2026-10-23 对照原项目生成清单，本仓 380 条 MP3 的 SHA256 全部匹配。来源为项目制作记录及 [Fish Audio](https://fish.audio/) 服务。本仓未附历史生成调用日志；不把合成音频自动套用开源代码的 MIT/CC0，也不因缺调用日志新增发布门槛。

## 分发范围

本通知覆盖上列已核来源。审计时 `scripts/build-static.mjs` 复制整个 Three `examples/jsm/`，其中 `libs/` 含 fflate、potpack、lil-gui 等独立作品；本次未把整个未使用 addon 目录宣称为已完成第三方许可核验。构建维护者正在按实际 addon 导入闭包裁剪并携带本通知与许可副本，最终分发范围以实际构建为准。
