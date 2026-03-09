<div align="center">

<br />

<img src="https://raw.githubusercontent.com/LunaticLegacy/thinking_graph/main/assets/logo.png" width="120" alt="Thinking Graph Logo" />

# Thinking Graph

### 让思维可见 · 让逻辑可触

(Public Alpha)

**可视化思维与论证关系的开源工具**

[![Python](https://img.shields.io/badge/Python-3.11+-3776AB?logo=python&logoColor=white)](https://python.org)
[![Flask](https://img.shields.io/badge/Flask-3.1+-000000?logo=flask&logoColor=white)](https://flask.palletsprojects.com)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Stars](https://img.shields.io/github/stars/LunaticLegacy/thinking_graph?style=social)](https://github.com/LunaticLegacy/thinking_graph)

[📖 文档](https://github.com/LunaticLegacy/thinking_graph/wiki) · [🚀 在线演示](https://demo.thinking-graph.dev) · [💬 讨论区](https://github.com/LunaticLegacy/thinking_graph/discussions) · [🇺🇸 English](docs/README_EN.md)

<br />

<img src="https://raw.githubusercontent.com/LunaticLegacy/thinking_graph/main/assets/screenshot_cn.png" width="90%" alt="Thinking Graph Screenshot" />

</div>

---

## ✨ 为什么选择 Thinking Graph？

> *"复杂的思考需要被看见，而不是被遗忘在草稿纸的角落。"*

在信息爆炸的时代，我们每天都在接收观点、形成判断、参与讨论。但思维是线性的，而**真正的理解往往是网状的**。

Thinking Graph 帮助你：

- 🧩 **可视化思维过程** —— 将零散的观点组织成清晰的论证网络
- ⚡ **多模态 LLM 支持** —— 本地 NPU 推理或云端 API，随你选择
- 🔍 **智能审计** —— AI 自动检查逻辑冲突与论证完整性
- 📜 **全程可追溯** —— 每一次修改都被记录，思维演化有迹可循

---

## 🚀 五分钟上手

### 安装

```bash
# 克隆仓库
git clone https://github.com/LunaticLegacy/thinking_graph.git
cd thinking_graph

# 创建虚拟环境
python -m venv .venv
source .venv/bin/activate  # Linux/Mac
# 或 .venv\Scripts\activate  # Windows

# 安装依赖
pip install -r requirements.txt
# 如果需要本地运行语言模型
# pip install -r ./requirements-local-llm.txt
```

### 配置

```bash
# 复制配置文件
cp app_config_example.toml app_config.toml
# 正式的配置文集为app_config.toml

# 编辑配置，选择你的 LLM 后端
# - remote_api: DeepSeek / OpenAI / Claude
# - local_api: Ollama / LM Studio / vLLM
# - onnxruntime / openvino: 本地 NPU 加速
```

### 启动

```bash
python main.py
```

打开浏览器访问 `http://localhost:5000`，开始构建你的第一张思维图！

## Production Deployment

For container deployment and multi-user isolation setup, see [DEPLOYMENT.md](DEPLOYMENT.md).

---

## 🎯 核心特性

### 📊 可视化论证网络

- **节点 (Node)**: 代表观点，支持置信度、标签、证据标注
- **连接 (Connection)**: 五种关系类型：supports / opposes / relates / leads_to / derives_from
- **交互式界面**: 拖拽布局、缩放导航、点击编辑

### 🤖 多后端 LLM 集成

| 后端类型 | 延迟 | 隐私 | 适用场景 |
|---------|------|------|---------|
| Remote API | ⚡⚡⚡ | 🔒 | 快速原型、高精度需求 |
| Local API | ⚡⚡ | 🔒🔒 | 平衡性能与隐私 |
| ONNXRuntime | ⚡ | 🔒🔒🔒 | 纯本地、NPU 加速 |
| OpenVINO | ⚡ | 🔒🔒🔒 | Intel NPU 优化 |

### 🔎 智能逻辑审计

内置审计规则：
- ✅ 禁止空内容节点
- ✅ 禁止自环连接
- ✅ 检测矛盾的支撑/反驳关系
- ✅ 验证节点引用完整性

### 📜 完整的审计追踪

每一次创建、修改、删除操作都被记录：

```json
{
  "entity_type": "node",
  "entity_id": "node_abc123",
  "action": "update",
  "actor": "luna",
  "reason": "修正置信度",
  "before_state": { "confidence": 0.7, ... },
  "after_state": { "confidence": 0.85, ... },
  "created_at": "2026-02-24T14:32:00Z"
}
```

支持导出审计报告、验证数据完整性、回溯任意历史版本。

---

## 🏗️ 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  React UI   │  │ Vis.js Graph │  │  Interactive Canvas │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     Flask Backend                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │   Routes    │  │   Services  │  │    Repository       │  │
│  │   (API)     │──│  (Business) │──│   (Data Access)     │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
│         │                                                    │
│         ▼                                                    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              LLM Integration Layer                   │    │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐  │    │
│  │  │ DeepSeek │ │  Ollama  │ │ONNX NPU  │ │OpenVINO│  │    │
│  │  └──────────┘ └──────────┘ └──────────┘ └────────┘  │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     Data Layer                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │   SQLite    │  │  Snapshots  │  │     Audit Log       │  │
│  │  (Nodes &   │  │  (Versioned │  │  (Immutable History)│  │
│  │ Connections)│  │   Graphs)   │  │                     │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## 📦 项目结构

```
thinking_graph/
├── backend/                    # 业务逻辑层
│   ├── services/               # 核心服务
│   │   ├── graph_service.py    # 图操作 CRUD
│   │   └── llm_service.py      # LLM 集成
│   └── repository.py           # 数据访问层
├── config/                     # 配置文件
├── core/                       # 领域核心
│   ├── graph.py                # 图模型与算法
│   └── visualization.py        # 可视化渲染
├── data/                       # 用户数据存储
├── datamodels/                 # 数据模型定义
├── docs/                       # 文档
├── models/                     # LLM 模型存放位置
├── static/                     # 前端资源
├── templates/                  # HTML 模板
├── tests/                      # 测试套件 🚧
├── utils/                      # 工具模块
│   ├── databaseman/            # 数据库管理
│   ├── llm_fetcher/            # LLM 客户端
│   └── llm_npu_module/         # NPU 推理加速
├── web/                        # Web 路由与控制器
├── app_config_example.toml     # 应用配置示例
└── main.py                     # 入口文件
```

---

## 🛣️ 路线图

- [x] 核心图操作 (CRUD)
- [x] 多后端 LLM 支持
- [x] 审计日志系统
- [x] 图快照保存/加载
- [ ] 协作编辑 (WebSocket)
  - [ ] 多用户联合编辑
  - [ ] 用户节点私有编辑权限
  - [ ] 可为连接挂入标签
- [x] 导入/导出 (JSON)
- [ ] 模板库 (论证框架预设)
- [ ] 移动端适配
- [ ] 插件系统

---


## 🤝 贡献指南

我们欢迎所有形式的贡献！

1. **Fork** 本项目
2. 创建你的功能分支：`git checkout -b feature/amazing-feature`
3. 提交改动：`git commit -m 'Add amazing feature'`
4. 推送到分支：`git push origin feature/amazing-feature`
5. 创建 **Pull Request**

查看 [CONTRIBUTING.md](CONTRIBUTING.md) 了解详细规范。

---

## 📄 许可证

[MIT](LICENSE) © 2026 月と猫 - LunaNeko

---

<div align="center">

**[⬆ 回到顶部](#thinking-graph)**

Made with ❤️ and ☕ by [月と猫 - LunaNeko](https://github.com/LunaticLegacy)

</div>
