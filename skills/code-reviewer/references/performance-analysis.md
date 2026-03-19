# 性能分析指南

本文档详细描述代码性能分析的各个维度和检查要点。

## 目录

1. [时间复杂度分析](#1-时间复杂度分析)
2. [空间复杂度分析](#2-空间复杂度分析)
3. [磁盘IO分析](#3-磁盘io分析)
4. [网络IO分析](#4-网络io分析)
5. [并发与锁分析](#5-并发与锁分析)
6. [内存管理分析](#6-内存管理分析)

---

## 1. 时间复杂度分析

### 1.1 算法复杂度评估

| 复杂度 | 标识 | 可接受场景 | 需优化场景 |
|--------|------|-----------|-----------|
| O(1) | 常数 | 所有场景 | - |
| O(log n) | 对数 | 大数据量查找 | - |
| O(n) | 线性 | 单次遍历处理 | 嵌套循环 |
| O(n log n) | 线性对数 | 排序操作 | 简单查询 |
| O(n²) | 平方 | 小规模数据(n<1000) | 大规模数据 |
| O(2ⁿ) / O(n!) | 指数/阶乘 | 仅小规模组合问题 | 绝大多数场景 |

### 1.2 常见代码模式检查

**嵌套循环优化**
```python
# ❌ 问题：O(n²) 嵌套循环
for i in range(n):
    for j in range(n):
        process(i, j)

# ✅ 优化：使用哈希表降为 O(n)
lookup = {x: i for i, x in enumerate(data)}
for i in range(n):
    if target - data[i] in lookup:
        process(i, lookup[target - data[i]])
```

**递归深度风险**
```python
# ❌ 问题：递归可能导致栈溢出
def fib(n):
    if n <= 1: return n
    return fib(n-1) + fib(n-2)  # O(2ⁿ)

# ✅ 优化：改为迭代 + 记忆化
from functools import lru_cache
@lru_cache(maxsize=None)
def fib(n):
    if n <= 1: return n
    return fib(n-1) + fib(n-2)
```

---

## 2. 空间复杂度分析

### 2.1 内存使用模式

| 模式 | 空间复杂度 | 风险评估 |
|------|-----------|---------|
| 固定变量 | O(1) | 低风险 |
| 线性集合 | O(n) | 中等风险 |
| 二维矩阵 | O(n²) | 高风险（大数据时）|
| 递归调用栈 | O(depth) | 栈溢出风险 |
| 缓存/记忆化 | O(k) | 内存泄漏风险 |

### 2.2 大数据集合检查要点

**列表/数组拷贝**
```python
# ❌ 问题：不必要的深拷贝
new_list = old_list[:]  # O(n) 空间

# ✅ 优化：使用迭代器或视图
for item in old_list:  # O(1) 额外空间
    process(item)
```

**生成器替代列表**
```python
# ❌ 问题：大量中间列表
result = [x*2 for x in data if x > 0]  # O(n) 空间

# ✅ 优化：使用生成器
result = (x*2 for x in data if x > 0)  # O(1) 空间
```

---

## 3. 磁盘IO分析

### 3.1 检查清单

- [ ] 文件读取是否使用了缓冲/流式处理
- [ ] 大量小文件IO是否合并为批量操作
- [ ] 文件句柄是否正确关闭（with语句）
- [ ] 随机读写 vs 顺序读写优化
- [ ] 日志写入是否异步化
- [ ] 配置/资源文件是否缓存

### 3.2 反模式与优化

**文件读取优化**
```python
# ❌ 问题：一次性读取大文件
data = open('large_file.txt').read()  # 内存溢出风险

# ✅ 优化：流式读取
with open('large_file.txt', 'r') as f:
    for line in f:  # 逐行读取，常数内存
        process(line)
```

**批量写入**
```python
# ❌ 问题：频繁小写入
for record in records:
    with open('log.txt', 'a') as f:
        f.write(record)  # 每次打开文件，磁盘IO开销大

# ✅ 优化：批量写入
with open('log.txt', 'a') as f:
    f.writelines(records)  # 单次打开，缓冲写入
```

### 3.3 磁盘IO评分标准

| 等级 | 描述 | 示例 |
|------|------|------|
| A | 优秀 | 流式处理、异步IO、批量操作 |
| B | 良好 | 有缓冲、批量读取 |
| C | 一般 | 标准文件操作 |
| D | 较差 | 频繁小文件操作 |
| F | 危险 | 大文件一次性读取、资源泄漏 |

---

## 4. 网络IO分析

### 4.1 检查清单

- [ ] 网络请求是否设置了超时
- [ ] 是否实现了重试机制（指数退避）
- [ ] 是否使用连接池（避免频繁创建连接）
- [ ] 大数据传输是否压缩
- [ ] API调用是否批量处理
- [ ] 是否支持异步/并发请求

### 4.2 反模式与优化

**连接池使用**
```python
# ❌ 问题：每次请求新建连接
import requests
for url in urls:
    response = requests.get(url)  # 每次新建TCP连接

# ✅ 优化：使用 Session/连接池
session = requests.Session()
for url in urls:
    response = session.get(url)  # 复用连接
```

**超时设置**
```python
# ❌ 问题：无超时可能导致永久阻塞
response = requests.get(url)

# ✅ 优化：设置合理超时
response = requests.get(url, timeout=(connect_timeout, read_timeout))
```

**异步并发**
```python
# ❌ 问题：同步顺序请求
results = [fetch(url) for url in urls]  # O(n) 时间

# ✅ 优化：异步并发
import asyncio
results = await asyncio.gather(*[fetch_async(url) for url in urls])  # O(1) 时间
```

### 4.3 网络IO评分标准

| 等级 | 描述 | 标准 |
|------|------|------|
| A | 优秀 | 连接池、异步并发、批量请求、压缩 |
| B | 良好 | 有超时、有重试 |
| C | 一般 | 标准同步请求 |
| D | 较差 | 无超时、无重试 |
| F | 危险 | 阻塞主线程、无错误处理 |

---

## 5. 并发与锁分析

### 5.1 死锁风险检查

**死锁四必要条件**
1. 互斥条件
2. 请求与保持条件
3. 不剥夺条件
4. 循环等待条件

**常见死锁模式**

```python
# ❌ 问题：嵌套锁获取顺序不一致（死锁风险）
# 线程A: lock_a -> lock_b
# 线程B: lock_b -> lock_a

def thread_a():
    with lock_a:
        with lock_b:  # 可能死锁
            do_work()

def thread_b():
    with lock_b:
        with lock_a:  # 可能死锁
            do_work()

# ✅ 优化：统一获取顺序
def thread_a():
    with lock_a:
        with lock_b:
            do_work()

def thread_b():
    with lock_a:  # 统一顺序
        with lock_b:
            do_work()
```

```python
# ❌ 问题：锁内调用外部回调（死锁风险）
with lock:
    callback()  # 回调可能尝试获取相同锁

# ✅ 优化：缩小锁范围，避免回调在锁内
data_copy = None
with lock:
    data_copy = data.copy()
callback(data_copy)  # 回调在锁外执行
```

### 5.2 锁粒度检查

| 粒度 | 适用场景 | 风险 |
|------|---------|------|
| 全局锁 | 简单保护共享资源 | 并发度低 |
| 分段锁 | 高并发场景（如 ConcurrentHashMap）| 实现复杂 |
| 读写锁 | 读多写少场景 | - |
| 无锁/CAS | 极致性能要求 | 实现复杂、ABA问题 |

### 5.3 并发安全数据类型

```python
# ❌ 问题：非线程安全的集合操作
from collections import defaultdict
counter = defaultdict(int)

def increment(key):
    counter[key] += 1  # 非原子操作，race condition

# ✅ 优化：使用线程安全类型
from collections import Counter
from threading import Lock

counter = Counter()
lock = Lock()

def increment(key):
    with lock:
        counter[key] += 1
```

### 5.4 并发评分标准

| 等级 | 描述 | 检查点 |
|------|------|--------|
| A | 优秀 | 无锁设计/细粒度锁、无race condition |
| B | 良好 | 正确的锁使用、无死锁风险 |
| C | 一般 | 有锁保护但粒度较粗 |
| D | 较差 | 锁使用不当、潜在race condition |
| F | 危险 | 明显的死锁风险、无并发保护 |

---

## 6. 内存管理分析

### 6.1 内存泄漏检查点

- [ ] 全局缓存是否有淘汰策略（LRU/TTL）
- [ ] 事件监听器是否正确注销
- [ ] 循环引用是否处理（Python: weakref）
- [ ] 大对象是否及时释放引用
- [ ] 线程/协程池是否正确关闭

### 6.2 垃圾回收优化

```python
# ❌ 问题：循环引用导致内存泄漏
class Node:
    def __init__(self):
        self.parent = None
        self.children = []

parent = Node()
child = Node()
parent.children.append(child)
child.parent = parent  # 循环引用

# ✅ 优化：使用 weakref
import weakref
class Node:
    def __init__(self):
        self._parent = None
        self.children = []
    
    @property
    def parent(self):
        return self._parent() if self._parent else None
    
    @parent.setter
    def parent(self, value):
        self._parent = weakref.ref(value) if value else None
```

### 6.3 内存池/对象池

```python
# 高频创建销毁小对象场景使用对象池
class ObjectPool:
    def __init__(self, factory, max_size=100):
        self.factory = factory
        self.max_size = max_size
        self.available = []
        self.in_use = set()
    
    def acquire(self):
        obj = self.available.pop() if self.available else self.factory()
        self.in_use.add(id(obj))
        return obj
    
    def release(self, obj):
        if id(obj) in self.in_use:
            self.in_use.remove(id(obj))
            if len(self.available) < self.max_size:
                self.available.append(obj)
```

---

## 7. 性能评分汇总表

| 维度 | 权重 | A(优秀) | B(良好) | C(一般) | D(较差) | F(危险) |
|------|------|---------|---------|---------|---------|---------|
| 时间复杂度 | 25% | < O(n log n) | O(n log n) | O(n) | O(n²) | > O(n²) |
| 空间复杂度 | 20% | O(1) | O(log n) | O(n) | O(n²) | > O(n²) |
| 磁盘IO | 15% | 流式/异步 | 有缓冲 | 标准操作 | 频繁小IO | 大文件读取/泄漏 |
| 网络IO | 15% | 连接池+并发 | 有超时重试 | 同步请求 | 无超时 | 阻塞/无错误处理 |
| 并发安全 | 15% | 无锁/细粒度 | 正确使用 | 粒度较粗 | 使用不当 | 死锁/race condition |
| 内存管理 | 10% | 对象池 | 及时释放 | 标准GC | 循环引用 | 内存泄漏 |

**综合评分计算**：
```
总分 = Σ(维度得分 × 权重)
其中：A=100, B=85, C=70, D=50, F=30

评级：
- S级：95-100分
- A级：85-94分
- B级：70-84分
- C级：60-69分
- D级：40-59分
- F级：< 40分
```
