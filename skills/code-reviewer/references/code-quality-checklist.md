# 代码质量检查清单

本文档提供全面的代码质量检查要点。

## 目录

1. [接口统一性检查](#1-接口统一性检查)
2. [注释规范检查](#2-注释规范检查)
3. [错误处理检查](#3-错误处理检查)
4. [代码风格检查](#4-代码风格检查)
5. [安全性检查](#5-安全性检查)

---

## 1. 接口统一性检查

### 1.1 命名规范

| 类型 | 命名规范 | 示例 |
|------|---------|------|
| 类/接口 | PascalCase | `UserService`, `HttpClient` |
| 函数/方法 | camelCase/snake_case | `getUserInfo()`, `fetch_data()` |
| 常量 | UPPER_SNAKE_CASE | `MAX_RETRY_COUNT`, `DEFAULT_TIMEOUT` |
| 私有成员 | _leading_underscore | `_internal_cache`, `_private_method()` |
| 模块/包 | lowercase | `user_service`, `http_utils` |

### 1.2 接口设计原则

**一致性检查**
- [ ] 同类操作的函数签名是否一致
- [ ] 参数顺序是否统一（如：source在前，destination在后）
- [ ] 返回值类型是否一致（成功/失败的处理方式统一）
- [ ] 命名是否表达清晰意图

**示例：统一接口设计**
```python
# ✅ 一致的CRUD接口
def create_user(data: UserData) -> Result[User]:
    pass

def get_user(user_id: str) -> Result[User]:
    pass

def update_user(user_id: str, data: UserData) -> Result[User]:
    pass

def delete_user(user_id: str) -> Result[bool]:
    pass

# ❌ 不一致的接口
def createUser(data):  # 命名不一致
    pass

def fetch_user_by_id(id):  # 命名不一致
    pass

def update(user_id, data, options=None):  # 参数不一致
    pass

def removeUser(user_id, force=False):  # 命名和参数都不一致
    pass
```

### 1.3 函数签名检查

```python
# ✅ 良好的函数签名
def process_data(
    data: list[dict],           # 主要输入
    config: ProcessConfig,       # 配置参数
    *,                          # 强制关键字参数分隔
    timeout: int = 30,          # 可选参数
    retry: int = 3,
    callback: Callable | None = None
) -> ProcessingResult:
    """
    清晰、完整的类型注解
    合理的默认参数
    明确的返回值类型
    """
    pass

# ❌ 问题签名
def process(d, cfg, t=30, r=3, cb=None):
    """缺少类型注解，参数名不清晰"""
    pass
```

---

## 2. 注释规范检查

### 2.1 注释类型与用途

| 注释类型 | 用途 | 必须包含 |
|---------|------|---------|
| 文件头注释 | 模块说明、作者、License | 模块功能描述 |
| 类/接口注释 | 类职责、使用示例 | 职责描述、主要方法 |
| 函数/方法注释 | 功能、参数、返回值、异常 | 所有参数和返回值说明 |
| 内联注释 | 复杂逻辑解释 | 为什么而非是什么 |
| TODO/FIXME | 待办事项 | 问题描述、处理人、日期 |

### 2.2 函数注释模板

```python
def function_name(
    param1: type1,
    param2: type2,
    *args,
    **kwargs
) -> return_type:
    """
    简要描述函数功能（一句话）
    
    详细描述函数的行为、使用场景、注意事项等。
    可以包含多行说明。
    
    Args:
        param1: 参数1的描述
        param2: 参数2的描述
        *args: 可变位置参数描述
        **kwargs: 可变关键字参数描述
    
    Returns:
        返回值的详细描述
    
    Raises:
        ValueError: 什么情况下抛出
        TypeError: 什么情况下抛出
    
    Examples:
        >>> function_name("input", 42)
        'result'
        
        >>> function_name("test", timeout=10)
        'result with timeout'
    
    Note:
        额外的注意事项或提示
    """
    pass
```

### 2.3 类注释模板

```python
class DataProcessor:
    """
    数据处理类，提供数据的清洗、转换和验证功能。
    
    该类支持多种数据格式的处理，包括JSON、CSV、XML等。
    处理过程是线程安全的，可以在多线程环境中使用。
    
    Attributes:
        config: 处理器配置
        cache: 内部缓存
    
    Examples:
        >>> processor = DataProcessor(config)
        >>> result = processor.process(data)
        
        >>> with DataProcessor(config) as p:
        ...     p.process_batch(datas)
    
    Note:
        - 处理大数据集时建议使用 process_batch 方法
        - 需要手动调用 close() 或使用上下文管理器
    """
    
    def __init__(self, config: ProcessorConfig):
        """
        初始化处理器。
        
        Args:
            config: 处理器配置对象
        """
        self.config = config
        self.cache = {}
```

### 2.4 注释质量检查

**注释反模式**
```python
# ❌ 废话注释
i = i + 1  # i自增1

# ❌ 过时注释（代码已改，注释未更新）
def calculate(x, y):
    # 返回x和y的和（实际返回乘积）
    return x * y

# ❌ 多余的注释（代码已自解释）
# 检查用户是否激活
if user.is_active:

# ✅ 好的注释：解释为什么
# 使用位运算而不是除法，因为性能关键路径
# 参考: JIRA-1234
value = value >> 1
```

---

## 3. 错误处理检查

### 3.1 异常处理原则

- [ ] 捕获具体异常，而非笼统的 Exception
- [ ] 不要吞掉异常（至少记录日志）
- [ ] 异常信息应包含有用的上下文
- [ ] 资源释放使用 try/finally 或上下文管理器
- [ ] 自定义异常应继承自合适的基类

**示例**
```python
# ❌ 不好的异常处理
def read_file(path):
    try:
        f = open(path)
        return f.read()
    except:  # 捕获所有异常
        return None  # 吞掉异常

# ✅ 好的异常处理
def read_file(path: str) -> str:
    """
    读取文件内容。
    
    Args:
        path: 文件路径
    
    Returns:
        文件内容
    
    Raises:
        FileNotFoundError: 文件不存在
        PermissionError: 无权限访问
        IOError: 其他IO错误
    """
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return f.read()
    except FileNotFoundError:
        logger.error(f"文件不存在: {path}")
        raise
    except PermissionError:
        logger.error(f"无权限访问文件: {path}")
        raise
    except IOError as e:
        logger.exception(f"读取文件失败: {path}, 错误: {e}")
        raise
```

### 3.2 错误返回值处理

```python
# ❌ 忽略错误返回值
result = some_operation()  # 可能返回错误码
process(result)  # 未检查错误

# ✅ 明确处理错误
from typing import Result, Ok, Err

def operation() -> Result[Data, Error]:
    if success:
        return Ok(data)
    return Err(error_info)

match operation():
    case Ok(data):
        process(data)
    case Err(e):
        logger.error(f"操作失败: {e}")
        handle_error(e)
```

---

## 4. 代码风格检查

### 4.1 通用风格原则

| 原则 | 说明 |
|------|------|
| DRY | Don't Repeat Yourself，避免重复代码 |
| KISS | Keep It Simple, Stupid，保持简单 |
| SOLID | 面向对象设计原则 |
| YAGNI | You Aren't Gonna Need It，不实现不需要的功能 |

### 4.2 代码长度控制

```
函数长度：建议 < 50 行，最多 < 100 行
类长度：建议 < 300 行，最多 < 500 行
文件长度：建议 < 500 行，最多 < 1000 行
嵌套深度：建议 < 3 层，最多 < 5 层
```

### 4.3 复杂度检查

```python
# ❌ 高复杂度代码
def process(data, mode, options):
    if mode == 'A':
        if options.get('fast'):
            for item in data:
                if item.valid:
                    process_a_fast(item)
                else:
                    skip(item)
        else:
            for item in data:
                process_a_slow(item)
    elif mode == 'B':
        # ... 更多嵌套

# ✅ 拆分降低复杂度
def process(data: list, mode: str, options: dict) -> None:
    processor = get_processor(mode, options)
    processor.process(data)

def get_processor(mode: str, options: dict) -> Processor:
    processors = {
        'A': lambda opt: FastProcessor() if opt.get('fast') else SlowProcessor(),
        'B': BProcessor,
    }
    return processors.get(mode, DefaultProcessor)(options)
```

---

## 5. 安全性检查

### 5.1 常见安全问题

| 问题类型 | 检查点 | 风险等级 |
|---------|--------|---------|
| SQL注入 | 是否使用参数化查询 | 高 |
| XSS | 是否转义用户输入 | 高 |
| 敏感信息 | 硬编码密钥、密码 | 高 |
| 路径遍历 | 文件路径验证 | 中 |
| 反序列化 | 不信任数据反序列化 | 高 |
| 正则DOS | 正则表达式复杂度 | 中 |

### 5.2 安全检查示例

```python
# ❌ SQL注入风险
query = f"SELECT * FROM users WHERE name = '{user_input}'"

# ✅ 参数化查询
query = "SELECT * FROM users WHERE name = %s"
cursor.execute(query, (user_input,))

# ❌ 路径遍历风险
file_path = f"/data/{user_input}"
with open(file_path) as f:  # user_input 可能是 ../../../etc/passwd
    
# ✅ 路径验证
import os
base_path = "/data"
requested_path = os.path.join(base_path, user_input)
if not os.path.commonpath([base_path, requested_path]) == base_path:
    raise ValueError("非法路径")

# ❌ 敏感信息硬编码
API_KEY = "sk-1234567890abcdef"

# ✅ 环境变量
import os
API_KEY = os.environ.get("API_KEY")
if not API_KEY:
    raise ValueError("API_KEY 未设置")
```

---

## 6. 质量评分标准

| 维度 | 权重 | A(优秀) | B(良好) | C(一般) | D(较差) | F(危险) |
|------|------|---------|---------|---------|---------|---------|
| 接口一致性 | 20% | 完全一致 | 基本一致 | 少量不一致 | 较多不一致 | 混乱 |
| 注释质量 | 20% | 完整规范 | 基本完整 | 部分缺失 | 大量缺失 | 无注释 |
| 错误处理 | 25% | 完善健壮 | 较好 | 基本处理 | 处理不当 | 无处理 |
| 代码风格 | 20% | 优雅简洁 | 良好 | 一般 | 较差 | 混乱 |
| 安全性 | 15% | 无漏洞 | 基本安全 | 小问题 | 较大问题 | 严重漏洞 |

**综合评分**：同性能评分计算方法
