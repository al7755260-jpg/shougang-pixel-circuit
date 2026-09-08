# 素材与依赖

首钢园扫描转换的体素数据、Blender 场景导出的天空和云、游戏美术为 Alex Li 项目提供的素材。车辆参考图由 ImageGen 生成，车身及独立轮胎模型由 Rodin 生成。本说明记录来源，不改变各素材或生成服务适用的权利和条款。

像素金刚：参考图由 ImageGen 生成，模型由 Rodin Gen-2.5 生成，任务为 `b87c3891-5b96-44a7-8bcf-12eb6cadcb8d`。游戏使用该模型的绑定版本；奔跑、抓取、抛掷和待机动作在 Blender 中按体型与车辆接触点制作。Mixamo 自动绑定未成功，本版本不包含或声称使用 Mixamo 下载的动作。

- Three.js：MIT，见安装包 `node_modules/three/LICENSE`。
- Spark：MIT，见安装包 `node_modules/@sparkjsdev/spark/LICENSE`；原始高斯浏览为本地可选功能。
- fflate：MIT，见安装包 `node_modules/fflate/LICENSE`。
- ws：MIT，见安装包 `node_modules/ws/LICENSE`。
- Vite：MIT，见安装包 `node_modules/vite/LICENSE.md`（开发构建依赖）。
- Press Start 2P 字体：SIL Open Font License 1.1，原许可与来源保留在 `public/assets/font/`。

浏览器发布包附带字体许可与本说明，源代码依赖的完整许可随 npm 包分发。仓库中没有原始 Gaussian PLY、Blender 工程、生成任务记录或访问密钥。
