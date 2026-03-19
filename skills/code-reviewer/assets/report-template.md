# Code Review 报告

## 基本信息

| 项目 | 内容 |
|------|------|
| 文件路径 | `{file_path}` |
| 代码语言 | `{language}` |
| 代码行数 | `{lines_of_code}` |
| Review 日期 | `{review_date}` |
| Reviewer | `{reviewer}` |

---

## 评分概览

### 综合评分

```
总评分: {total_score}/100  [评级: {grade}]

性能维度: {performance_score}/100
质量维度: {quality_score}/100
```

### 评分雷达图

```
        时间复杂度
            A
           /|\\
          / | \\
    空间复杂度  |  磁盘IO
         B----+----D
          \\  |  /
           \\ | /
            \\|/
        网络IO  并发安全
             C
```

---

## 详细分析

### 1. 接口一致性分析

**评分**: {interface_score}/100

| 检查项 | 状态 | 说明 |
|--------|------|------|
| 命名规范 | {naming_status} | {naming_detail} |
| 参数一致性 | {param_status} | {param_detail} |
| 返回值一致性 | {return_status} | {return_detail} |

**问题列表**:
{interface_issues}

---

### 2. 注释规范分析

**评分**: {comment_score}/100

| 检查项 | 覆盖率 | 质量评级 |
|--------|--------|---------|
| 模块注释 | {module_coverage}% | {module_grade} |
| 类/接口注释 | {class_coverage}% | {class_grade} |
| 函数注释 | {func_coverage}% | {func_grade} |
| 内联注释 | {inline_coverage}% | {inline_grade} |

**问题列表**:
{comment_issues}

---

### 3. 性能分析

#### 3.1 时间复杂度

**评分**: {time_complexity_score}/100 | **等级**: {time_complexity_grade}

| 函数/代码块 | 当前复杂度 | 建议复杂度 | 风险等级 |
|------------|-----------|-----------|---------|
{time_complexity_table}

#### 3.2 空间复杂度

**评分**: {space_complexity_score}/100 | **等级**: {space_complexity_grade}

| 函数/代码块 | 当前复杂度 | 内存峰值 | 风险等级 |
|------------|-----------|---------|---------|
{space_complexity_table}

#### 3.3 磁盘IO分析

**评分**: {disk_io_score}/100 | **等级**: {disk_io_grade}

| 检查点 | 状态 | 说明 |
|--------|------|------|
| 缓冲/流式处理 | {buffering_status} | {buffering_detail} |
| 文件句柄管理 | {file_handle_status} | {file_handle_detail} |
| 批量操作 | {batch_status} | {batch_detail} |
| 资源释放 | {resource_status} | {resource_detail} |

**问题列表**:
{disk_io_issues}

#### 3.4 网络IO分析

**评分**: {network_io_score}/100 | **等级**: {network_io_grade}

| 检查点 | 状态 | 说明 |
|--------|------|------|
| 超时设置 | {timeout_status} | {timeout_detail} |
| 重试机制 | {retry_status} | {retry_detail} |
| 连接池使用 | {pool_status} | {pool_detail} |
| 并发处理 | {concurrent_status} | {concurrent_detail} |
| 错误处理 | {error_status} | {error_detail} |

**问题列表**:
{network_io_issues}

#### 3.5 并发与锁分析

**评分**: {concurrency_score}/100 | **等级**: {concurrency_grade}

| 检查点 | 状态 | 风险等级 |
|--------|------|---------|
| 死锁风险 | {deadlock_status} | {deadlock_risk} |
| 锁粒度 | {lock_granularity_status} | {lock_granularity_risk} |
| Race Condition | {race_status} | {race_risk} |
| 线程安全类型 | {thread_safe_status} | {thread_safe_risk} |

**死锁分析报告**:
```
潜在死锁场景:
{deadlock_scenarios}

建议修复方案:
{deadlock_solutions}
```

#### 3.6 内存管理分析

**评分**: {memory_score}/100 | **等级**: {memory_grade}

| 检查点 | 状态 | 风险等级 |
|--------|------|---------|
| 内存泄漏风险 | {leak_status} | {leak_risk} |
| 大对象处理 | {large_object_status} | {large_object_risk} |
| 循环引用 | {circular_ref_status} | {circular_ref_risk} |
| 缓存策略 | {cache_status} | {cache_risk} |

---

### 4. 代码质量分析

#### 4.1 错误处理

**评分**: {error_handling_score}/100

| 检查项 | 状态 | 说明 |
|--------|------|------|
| 异常捕获 | {exception_status} | {exception_detail} |
| 错误传播 | {propagation_status} | {propagation_detail} |
| 资源清理 | {cleanup_status} | {cleanup_detail} |
| 错误信息 | {message_status} | {message_detail} |

#### 4.2 代码风格

**评分**: {style_score}/100

| 指标 | 当前值 | 建议值 | 状态 |
|------|--------|--------|------|
| 函数平均行数 | {avg_func_lines} | < 50 | {func_lines_status} |
| 最大嵌套深度 | {max_nesting} | < 4 | {nesting_status} |
| 重复代码块 | {duplicate_blocks} | 0 | {duplicate_status} |
| 圈复杂度(平均) | {avg_complexity} | < 10 | {complexity_status} |

#### 4.3 安全性

**评分**: {security_score}/100

| 检查项 | 风险等级 | 说明 |
|--------|---------|------|
| 注入攻击 | {injection_risk} | {injection_detail} |
| 敏感信息 | {sensitive_risk} | {sensitive_detail} |
| 路径遍历 | {path_risk} | {path_detail} |
| 反序列化 | {deserialize_risk} | {deserialize_detail} |

---

## 问题汇总

### 🔴 严重问题 (P0) - 必须修复

{p0_issues}

### 🟠 重要问题 (P1) - 建议修复

{p1_issues}

### 🟡 一般问题 (P2) - 可选修复

{p2_issues}

### 🟢 建议优化 (P3) - 代码优化建议

{p3_issues}

---

## 修复建议

### 高优先级修复

{high_priority_fixes}

### 性能优化建议

{performance_fixes}

### 代码重构建议

{refactoring_suggestions}

---

## 附件

- 详细JSON报告: `{json_report_path}`
- 原始代码: `{source_code_path}`

---

*报告生成时间: {generation_time}*
*Review Tool: Code Reviewer Skill v1.0*
