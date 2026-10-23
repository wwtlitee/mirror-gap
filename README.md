# 镜隙 · Mirror Gap v8.5.0

玩家驾驶机械果蝇，运输补给、接通信号与规划充能路线，和一只由连接组约束神经网络自主控制的果蝇共同生活。实际进食会触发学习回路，改变内部突触；撤去食物后，可以观察它是否追随学过的中性气味。

**[公开试玩 / Play](https://mirror-gap-tapeout.mirror-gap-fly-daily.workers.dev/)** · [源码 / Source](https://github.com/wwtlitee/mirror-gap) · [参赛演示与下载 / Release](https://github.com/wwtlitee/mirror-gap/releases/tag/v8.5.0)

六章十二段合作流程、自由生活与两种可重玩试炼。完整新存档流程已实际跑通；公网导入、键盘飞行、电路试炼和成绩保留的9项浏览器检查通过。桌面与触屏均有操作入口。真实手机和外部玩家体验仍需进一步收集。

**English:** Pilot a mechanical fly whose scent signals are gated by TapeOut circuits. Deliver real food and live alongside an autonomous, connectome-constrained neural companion. Actual eating changes internal synaptic weights. Removing food lets you observe its response without a scripted route or guaranteed success.

## 本地运行

需要 Node.js 22.16 或更高。全新下载的独立源码目录执行：

```powershell
npm ci --ignore-scripts
npm run build:static
$env:MIRROR_PREVIEW_PORT='4255'
npm run preview
```

打开 [双果蝇合作](http://127.0.0.1:4255/coop.html)、[日常之家](http://127.0.0.1:4255/) 或 [独立训练室](http://127.0.0.1:4255/training.html)。静态试玩在浏览器本地运行，不要求Python或服务端模型。维护者当前开发副本使用只读链接的node_modules，清理安装应在独立导出目录进行。

## 操作与存档

- WASD飞行，Space上升，Shift下降；E领取、投递或操作附近装置。
- 1选择A、2选择B、0关闭；实际释放受电路相位、脉冲和电量约束。
- P暂停；菜单支持导入、导出和确认后新游戏。触屏提供对应按钮。
- 玩家控制机械果蝇，神经果蝇自主运动。学习由真实消费触发，投递本身不会授予奖励。
- 身体、权重、机械和关卡保存在同一份本地备份；神经活动瞬态按模型的存档机制恢复。清除浏览器数据前应主动导出。

## TapeOut怎样参与

机械信号使用X Layer处理器#1的XOR网表以及#4引用的双LATCH电路。XOR决定A/B编码，真实LATCH状态序列约束脉冲释放；游戏提供400ms输入时钟，使1.2秒电路周期能够覆盖3秒进食教学窗口。固定网表在本地逐拍执行。

菜单可只读联网核验网表与实际输出向量，展示区块收据；尚未核验或核验失败时有明确状态。试玩无需钱包签名，身体与记忆保存在浏览器。

## 神经学习与复现

原4386神经元运动网络保持自主控制，中性A/B作用于蘑菇体学习回路中的946个可塑性权重。实际消费触发250ms教学窗口；合作流程记录气味、摄食、自然奖励窗和本段权重变化，再进行撤食观察。

实验协议在 [config/](config/)，来源与许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。受控实验、自由试玩记录与完整游戏验收分开记录；继续用于开发的种子不会再称为新鲜独立样本。

```powershell
npm run check
node scripts/check-entry.mjs
```

可选浏览器工具需安装Playwright，或通过PLAYWRIGHT_MODULE_URL指定本地入口；脚本使用隔离无头浏览器。部分历史研究工具还需要研究数据或Python环境，不属于静态试玩的启动依赖。

### 可复核的学习结果

- 完整通关开发个体的当次撤食结果：偏好指数−0.0305，接近无偏好；不宣称每次都能被引导。
- 另一份真实开发个体检查点的q-only对照：同身体、同原脑起点，仅替换q；两种气味位置中，训练q相对训练前q的偏好增量为+0.1863、+0.3194，恢复q逐帧重现。这是已有开发个体，N=1，不是新独立样本。
- 此前16个独立种子的开发队列保留失败，两个布局各12/16达标；它早于当前食物进场修复，不能当成当前整款游戏的新队列验证。

公开的生成测试个体及证据摘要在 `tests/fixtures/entry-learning-v8.5.0/` 和 `config/entry-evidence-8.5.0.json`。复现q-only对照：

```powershell
node scripts/audit-native-coop-learning.mjs tests/fixtures/entry-learning-v8.5.0/trained-start.json tests/fixtures/entry-learning-v8.5.0/pre-training.json output/q-audit
```

### 参赛新增与持续使用

本次活动期间新增独立机械角色、真实运输与电量、TapeOut信号、六章战役、实际摄食学习判定、撤食观察、合作存档和两种试炼。原来的房间、日常生命仿真与素材是已有基础，来源与许可按下方清单保留。

目标用户为喜欢数字宠物、合作探索和可解释生命模拟的玩家，以及科学教育与创意编程社区。以免费浏览器试玩触达，计划通过独立付费版、额外栖息地和合作关卡包持续开发；当前没有收费功能或收入验证。玩家持续使用的理由是保留同一个体的身体与记忆、共同生活和挑战可重复的运输/电路试炼。

## 独立部署与源码导出

npm run deploy:static 使用独立的wrangler.coop.jsonc，新站根入口指向合作页面；部署者配置Cloudflare认证。该入口与旧之家站点分开。

node scripts/export-entry-source.mjs --out <仓库外的新目录> 生成带SHA清单的评审源码，保留必要配置与许可。本机pdoc、运行存档、输出日志与凭据不在导出范围。
