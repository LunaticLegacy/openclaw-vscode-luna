# Dochead 注释标准

## 模板规范

### 1. 类/接口注释

```typescript
/**
 * [简要描述类的职责和功能]
 * 
 * @example
 * ```typescript
 * const instance = new ClassName(params);
 * await instance.method();
 * ```
 * 
 * @emits [eventName] - [事件描述]
 */
```

### 2. Public 方法注释

```typescript
/**
 * [简要描述方法功能]
 * 
 * @param [paramName] - [参数描述]
 * @returns [返回值描述]
 * @throws [ErrorType] - [什么情况下抛出]
 * 
 * @example
 * ```typescript
 * const result = await instance.method(param);
 * ```
 */
```

### 3. Private 方法注释（简化版）

```typescript
/**
 * [简要描述方法功能]
 * @param [paramName] - [参数描述]
 * @returns [返回值描述]
 */
```

### 4. Getter/Setter 注释

```typescript
/**
 * 获取 [属性描述]
 */
/**
 * 设置 [属性描述]
 * @param value - [参数描述]
 */
```

### 5. 特殊标记

```typescript
/**
 * @deprecated [废弃原因和替代方案]
 * @internal 内部使用，不推荐外部调用
 * @override 重写父类方法
 * @async 异步方法
 * @generator 生成器函数
 */
```

## 规则

1. **所有 public 方法** 必须有完整的 dochead
2. **所有 private 方法** 至少有简要描述
3. **类/接口** 必须有描述和使用示例
4. **参数** 必须标明类型和用途
5. **返回值** 必须描述内容和可能的情况
