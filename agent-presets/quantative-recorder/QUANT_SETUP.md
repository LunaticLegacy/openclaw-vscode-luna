# QUANT_SETUP.md - 参数与初始化清单

## 预设定位

- 预设别名: Quant Recorder
- 兼容标识: `quantative-recorder`
- 默认市场: 中国 A 股
- 默认货币: CNY
- 默认用途: 研究记录 + 模拟盘复盘
- 默认基准: 沪深 300

## 可编辑参数

| Key | Default | 含义 | 最后确认 |
|-----|---------|------|----------|
| universe_size | 15 | 初始观察池数量 | preset |
| max_position_pct | 15 | 单标的最大仓位百分比 | preset |
| max_total_exposure_pct | 80 | 总仓位上限百分比 | preset |
| stop_loss_pct | 7 | 默认止损参考值 | preset |
| take_profit_review_pct | 15 | 达到后触发复核 | preset |
| sector_cap_pct | 30 | 行业集中度上限 | preset |
| rebalance_cadence | weekly | 默认复盘 / 调仓节奏 | preset |
| quote_freshness_minutes | 15 | 盘中行情默认保鲜阈值 | preset |
| portfolio_mode | paper | `paper` / `journaled-live` / `research-only` | preset |
| slippage_assumption_bps | 10 | 示例滑点假设，需自行确认 | preset |

## 初始化检查清单

- [ ] 确认关注市场、时区和语言
- [ ] 确认是否只做研究或模拟盘
- [ ] 选择并记录数据源
- [ ] 初始化 `data/` 与 `memory/`
- [ ] 确认观察池并更新 `STOCKS.md`
- [ ] 写入私有配置到 `TOOLS.md`
- [ ] 如果存在持仓，确认来源与时间后再录入

## 建议目录

```text
data/
  market/
  portfolio/
  signals/
  journal/
  reference/
memory/
```

## 说明

- 缺目录表示“未初始化”，不是报错
- 如果以后接入脚本、API 或数据库，应单独记录实现方式和验证结果
- A 股默认适用交易时间、最小交易单位、T+1 和涨跌停等制度约束；如切换市场，先更新这里
