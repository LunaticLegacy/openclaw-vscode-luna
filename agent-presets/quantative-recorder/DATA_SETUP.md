# DATA_SETUP.md - 数据结构约定

> 本文件定义推荐的数据组织方式。文件不存在时，应视为“尚未初始化”，而不是“运行正常”。

## 推荐目录

```text
data/
  market/
    raw/
    derived/
  portfolio/
  signals/
  journal/
  reference/
```

## 通用字段

所有结构化记录尽量包含这些字段：

- `source`: 数据来源或录入方式
- `capturedAt`: 采集时间
- `market`: 市场标识
- `timezone`: 时区
- `quality`: `ok` / `delayed` / `missing` / `suspect`
- `notes`: 备注或异常说明

## 示例：行情快照

```json
{
  "source": "user-import",
  "capturedAt": "2026-03-10T14:55:00+08:00",
  "market": "CN-A",
  "timezone": "Asia/Shanghai",
  "quality": "ok",
  "symbols": [
    {
      "ticker": "600519.SH",
      "name": "贵州茅台",
      "last": 1688.0,
      "changePct": 0.82,
      "volume": 3256400
    }
  ],
  "notes": "Example only"
}
```

## 示例：组合状态

```json
{
  "source": "manual-confirmed",
  "capturedAt": "2026-03-10T15:05:00+08:00",
  "market": "CN-A",
  "timezone": "Asia/Shanghai",
  "quality": "ok",
  "cash": 1000000,
  "positions": [],
  "exposurePct": 0,
  "maxDrawdownPct": null,
  "notes": "Create only after user or workflow confirms holdings"
}
```

## 示例：信号记录

```json
{
  "source": "manual-analysis",
  "capturedAt": "2026-03-10T15:10:00+08:00",
  "market": "CN-A",
  "timezone": "Asia/Shanghai",
  "quality": "ok",
  "ticker": "300750.SZ",
  "signalType": "momentum-review",
  "score": 1.8,
  "status": "watch",
  "reason": [
    "price above 20-day average",
    "volume expansion not yet confirmed"
  ]
}
```

## 新鲜度默认值

- 盘中行情：15 分钟内视为新鲜
- 日线 / 收盘数据：下一交易日开盘前完成更新
- 组合状态：每次确认有变动后立即更新
- 手续费与规则：以用户确认或官方资料为准，过期必须重验

## 质量标记规则

- `ok`: 来源明确且在有效期内
- `delayed`: 数据存在，但已超过新鲜度阈值
- `missing`: 文件、字段或来源不存在
- `suspect`: 值异常、来源冲突或口径不一致

## 审计要求

- 任何手工修改都应在 `memory/YYYY-MM-DD.md` 中留下原因
- 当两个来源冲突时，不要覆盖旧值；先记录冲突，再等待确认
- 不把演示数据、模板数据或猜测数据写成当前真实状态
