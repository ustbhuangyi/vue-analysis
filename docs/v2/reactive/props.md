# Props (v2.6.11)

`Props` 作为组件的核心特性之一，也是我们平时开发 Vue 项目中接触最多的特性之一，它可以让组件的功能变得丰富，也是父子组件通讯的一个渠道。那么它的实现原理是怎样的，我们来一探究竟。

## 规范化

在初始化 `props` 之前，首先会对 `props` 做一次 `normalize`，它发生在 `mergeOptions` 的时候，在 `src/core/util/options.js` 中：

```js
export function mergeOptions (
  parent: Object,
  child: Object,
  vm?: Component
): Object {
  // ...
  normalizeProps(child, vm)
  // ...
}

function normalizeProps (options: Object, vm: ?Component) {
  const props = options.props
  if (!props) return
  const res = {}
  let i, val, name
  if (Array.isArray(props)) {
    i = props.length
    while (i--) {
      val = props[i]
      if (typeof val === 'string') {
        name = camelize(val)
        res[name] = { type: null }
      } else if (process.env.NODE_ENV !== 'production') {
        warn('props must be strings when using array syntax.')
      }
    }
  } else if (isPlainObject(props)) {
    for (const key in props) {
      val = props[key]
      name = camelize(key)
      res[name] = isPlainObject(val)
        ? val
        : { type: val }
    }
  } else if (process.env.NODE_ENV !== 'production') {
    warn(
      `Invalid value for option "props": expected an Array or an Object, ` +
      `but got ${toRawType(props)}.`,
      vm
    )
  }
  options.props = res
}
```

合并配置我们在组件化章节讲过，它主要就是处理我们定义组件的对象 `option`，然后挂载到组件的实例 `this.$options` 中。

我们接下来重点看 `normalizeProps` 的实现，其实这个函数的主要目的就是把我们编写的 `props` 转成对象格式，因为实际上 `props` 除了对象格式，还允许写成数组格式。

当 `props` 是一个数组，每一个数组元素 `prop` 只能是一个 `string`，表示 `prop` 的 `key`，转成驼峰格式，`prop` 的类型为空。

当 `props` 是一个对象，对于 `props` 中每个 `prop` 的 `key`，我们会转驼峰格式，而它的 `value`，如果不是一个对象，我们就把它规范成一个对象。

如果 `props` 既不是数组也不是对象，就抛出一个警告。

举个例子：

```js
export default {
  props: ['name', 'nick-name']
}
```

经过 `normalizeProps` 后，会被规范成：

```js
options.props = {
  name: { type: null },
  nickName: { type: null }
}
```

```js
export default {
  props: {
    name: String,
    nickName: {
      type: Boolean
    }
  }
}
```

经过 `normalizeProps` 后，会被规范成：

```js
options.props = {
  name: { type: String },
  nickName: { type: Boolean }
}
```

由于对象形式的 `props` 可以指定每个 `prop` 的类型和定义其它的一些属性，推荐用对象形式定义 `props`。

## 初始化

`Props` 的初始化主要发生在 `new Vue` 中的 `initState` 阶段，在 `src/core/instance/state.js` 中：

```js
export function initState (vm: Component) {
  // ....
  const opts = vm.$options
  if (opts.props) initProps(vm, opts.props)
  // ...
}


function initProps (vm: Component, propsOptions: Object) {
  const propsData = vm.$options.propsData || {}
  const props = vm._props = {}
  // cache prop keys so that future props updates can iterate using Array
  // instead of dynamic object key enumeration.
  const keys = vm.$options._propKeys = []
  const isRoot = !vm.$parent
  // root instance props should be converted
  if (!isRoot) {
    toggleObserving(false)
  }
  for (const key in propsOptions) {
    keys.push(key)
    const value = validateProp(key, propsOptions, propsData, vm)
    /* istanbul ignore else */
    if (process.env.NODE_ENV !== 'production') {
      const hyphenatedKey = hyphenate(key)
      if (isReservedAttribute(hyphenatedKey) ||
          config.isReservedAttr(hyphenatedKey)) {
        warn(
          `"${hyphenatedKey}" is a reserved attribute and cannot be used as component prop.`,
          vm
        )
      }
      defineReactive(props, key, value, () => {
        if (!isRoot && !isUpdatingChildComponent) {
          warn(
            `Avoid mutating a prop directly since the value will be ` +
            `overwritten whenever the parent component re-renders. ` +
            `Instead, use a data or computed property based on the prop's ` +
            `value. Prop being mutated: "${key}"`,
            vm
          )
        }
      })
    } else {
      defineReactive(props, key, value)
    }
    // static props are already proxied on the component's prototype
    // during Vue.extend(). We only need to proxy props defined at
    // instantiation here.
    if (!(key in vm)) {
      proxy(vm, `_props`, key)
    }
  }
  toggleObserving(true)
}
``` 

`initProps` 主要做 3 件事情：校验、响应式和代理。

### 校验

校验的逻辑很简单，遍历 `propsOptions`，执行 `validateProp(key, propsOptions, propsData, vm)` 方法。这里的 `propsOptions` 就是我们定义的 `props` 在规范后生成的 `options.props` 对象，`propsData` 是从父组件传递的 `prop` 数据。所谓校验的目的就是检查一下我们传递的数据是否满足 `prop `的定义规范。再来看一下 `validateProp` 方法，它定义在 `src/core/util/props.js` 中：

```js
export function validateProp (
  key: string,
  propOptions: Object,
  propsData: Object,
  vm?: Component
): any {
  const prop = propOptions[key]
  const absent = !hasOwn(propsData, key)
  let value = propsData[key]
  // boolean casting
  const booleanIndex = getTypeIndex(Boolean, prop.type)
  if (booleanIndex > -1) {
    if (absent && !hasOwn(prop, 'default')) {
      value = false
    } else if (value === '' || value === hyphenate(key)) {
      // only cast empty string / same name to boolean if
      // boolean has higher priority
      const stringIndex = getTypeIndex(String, prop.type)
      if (stringIndex < 0 || booleanIndex < stringIndex) {
        value = true
      }
    }
  }
  // check default value
  if (value === undefined) {
    value = getPropDefaultValue(vm, prop, key)
    // since the default value is a fresh copy,
    // make sure to observe it.
    const prevShouldObserve = shouldObserve
    toggleObserving(true)
    observe(value)
    toggleObserving(prevShouldObserve)
  }
  if (
    process.env.NODE_ENV !== 'production' &&
    // skip validation for weex recycle-list child component props
    !(__WEEX__ && isObject(value) && ('@binding' in value))
  ) {
    assertProp(prop, key, value, vm, absent)
  }
  return value
}
```

`validateProp` 主要就做 3 件事情：处理 `Boolean` 类型的数据，处理默认数据，`prop` 断言，并最终返回 `prop` 的值。

先来看 `Boolean` 类型数据的处理逻辑：

```js
const prop = propOptions[key]
const absent = !hasOwn(propsData, key)
let value = propsData[key]
// boolean casting
const booleanIndex = getTypeIndex(Boolean, prop.type)
if (booleanIndex > -1) {
  if (absent && !hasOwn(prop, 'default')) {
    value = false
  } else if (value === '' || value === hyphenate(key)) {
    // only cast empty string / same name to boolean if
    // boolean has higher priority
    const stringIndex = getTypeIndex(String, prop.type)
    if (stringIndex < 0 || booleanIndex < stringIndex) {
      value = true
    }
  }
}
```

先通过 `const booleanIndex = getTypeIndex(Boolean, prop.type)` 来判断 `prop` 的定义是否是 `Boolean` 类型的。

```js
function getType (fn) {
  const match = fn && fn.toString().match(/^\s*function (\w+)/)
  return match ? match[1] : ''
}

function isSameType (a, b) {
  return getType(a) === getType(b)
}

function getTypeIndex (type, expectedTypes): number {
  if (!Array.isArray(expectedTypes)) {
    return isSameType(expectedTypes, type) ? 0 : -1
  }
  for (let i = 0, len = expectedTypes.length; i < len; i++) {
    if (isSameType(expectedTypes[i], type)) {
      return i
    }
  }
  return -1
}
```

`getTypeIndex` 函数就是找到 `type` 和 `expectedTypes` 匹配的索引并返回。

`prop` 类型定义的时候可以是某个原生构造函数，也可以是原生构造函数的数组，比如：

```js
export default {
  props: {
    name: String,
    value: [String, Boolean]
  }
}
```

如果 `expectedTypes` 是单个构造函数，就执行 `isSameType` 去判断是否是同一个类型；如果是数组，那么就遍历这个数组，找到第一个同类型的，返回它的索引。

回到 `validateProp` 函数，通过 `const booleanIndex = getTypeIndex(Boolean, prop.type)` 得到 `booleanIndex`，如果 `prop.type` 是一个 `Boolean` 类型，则通过 `absent && !hasOwn(prop, 'default')` 来判断如果父组件没有传递这个 `prop` 数据并且没有设置 `default` 的情况，则 `value` 为 false。

接着判断`value === '' || value === hyphenate(key)` 的情况，如果满足则先通过 `const stringIndex = getTypeIndex(String, prop.type)` 获取匹配 `String` 类型的索引，然后判断 `stringIndex < 0 || booleanIndex < stringIndex` 的值来决定 `value` 的值是否为 `true`。这块逻辑稍微有点绕，我们举 2 个例子来说明：

例如你定义一个组件 `Student`:

```js
export default {
  name: String,
  nickName: [Boolean, String]
}
```

然后在父组件中引入这个组件：

```vue
<template>
  <div>
    <student name="Kate" nick-name></student>
  </div>
</template>
```

或者是：

```vue
<template>
  <div>
    <student name="Kate" nick-name="nick-name"></student>
  </div>
</template>
```

第一种情况没有写属性的值，满足 `value === ''`，第二种满足 `value === hyphenate(key)` 的情况，另外 `nickName` 这个 `prop` 的类型是 `Boolean` 或者是 `String`，并且满足 `booleanIndex < stringIndex`，所以对 `nickName` 这个 `prop` 的 `value` 为 `true`。

接下来看一下默认数据处理逻辑：

```js
// check default value
if (value === undefined) {
  value = getPropDefaultValue(vm, prop, key)
  // since the default value is a fresh copy,
  // make sure to observe it.
  const prevShouldObserve = shouldObserve
  toggleObserving(true)
  observe(value)
  toggleObserving(prevShouldObserve)
}
```

当 `value` 的值为 `undefined` 的时候，说明父组件根本就没有传这个 `prop`，那么我们就需要通过 `getPropDefaultValue(vm, prop, key)` 获取这个 `prop` 的默认值。我们这里只关注 `getPropDefaultValue` 的实现，`toggleObserving` 和 `observe` 的作用我们之后会说。

```js
function getPropDefaultValue (vm: ?Component, prop: PropOptions, key: string): any {
  // no default, return undefined
  if (!hasOwn(prop, 'default')) {
    return undefined
  }
  const def = prop.default
  // warn against non-factory defaults for Object & Array
  if (process.env.NODE_ENV !== 'production' && isObject(def)) {
    warn(
      'Invalid default value for prop "' + key + '": ' +
      'Props with type Object/Array must use a factory function ' +
      'to return the default value.',
      vm
    )
  }
  // the raw prop value was also undefined from previous render,
  // return previous default value to avoid unnecessary watcher trigger
  if (vm && vm.$options.propsData &&
    vm.$options.propsData[key] === undefined &&
    vm._props[key] !== undefined
  ) {
    return vm._props[key]
  }
  // call factory function for non-Function types
  // a value is Function if its prototype is function even across different execution context
  return typeof def === 'function' && getType(prop.type) !== 'Function'
    ? def.call(vm)
    : def
}
```

检测如果 `prop` 没有定义 `default` 属性，那么返回 `undefined`，通过这块逻辑我们知道除了 `Boolean` 类型的数据，其余没有设置 `default` 属性的 `prop` 默认值都是 `undefined`。

接着是开发环境下对 `prop` 的默认值是否为对象或者数组类型的判断，如果是的话会报警告，因为对象和数组类型的 `prop`，他们的默认值必须要返回一个工厂函数。

接下来的判断是如果上一次组件渲染父组件传递的 `prop` 的值是 `undefined`，则直接返回 上一次的默认值 `vm._props[key]`，这样可以避免触发不必要的 `watcher` 的更新。

最后就是判断 `def` 如果是工厂函数且 `prop` 的类型不是 `Function` 的时候，返回工厂函数的返回值，否则直接返回 `def`。

至此，我们讲完了 `validateProp` 函数的 `Boolean` 类型数据的处理逻辑和默认数据处理逻辑，最后来看一下 `prop` 断言逻辑。

```js
if (
process.env.NODE_ENV !== 'production' &&
// skip validation for weex recycle-list child component props
!(__WEEX__ && isObject(value) && ('@binding' in value))
) {
  assertProp(prop, key, value, vm, absent)
}
```

在开发环境且非 `weex` 的某种环境下，执行 `assertProp` 做属性断言。

```js
function assertProp (
  prop: PropOptions,
  name: string,
  value: any,
  vm: ?Component,
  absent: boolean
) {
  if (prop.required && absent) {
    warn(
      'Missing required prop: "' + name + '"',
      vm
    )
    return
  }
  if (value == null && !prop.required) {
    return
  }
  let type = prop.type
  let valid = !type || type === true
  const expectedTypes = []
  if (type) {
    if (!Array.isArray(type)) {
      type = [type]
    }
    for (let i = 0; i < type.length && !valid; i++) {
      const assertedType = assertType(value, type[i])
      expectedTypes.push(assertedType.expectedType || '')
      valid = assertedType.valid
    }
  }

  if (!valid) {
    warn(
      getInvalidTypeMessage(name, value, expectedTypes),
      vm
    )
    return
  }
  const validator = prop.validator
  if (validator) {
    if (!validator(value)) {
      warn(
        'Invalid prop: custom validator check failed for prop "' + name + '".',
        vm
      )
    }
  }
}
```

`assertProp` 函数的目的是断言这个 `prop` 是否合法。

首先判断如果 `prop` 定义了 `required` 属性但父组件没有传递这个 `prop` 数据的话会报一个警告。

接着判断如果 `value` 为空且 `prop` 没有定义 `required` 属性则直接返回。

然后再去对 `prop` 的类型做校验，先是拿到 `prop` 中定义的类型 `type`，并尝试把它转成一个类型数组，然后依次遍历这个数组，执行 `assertType(value, type[i])` 去获取断言的结果，直到遍历完成或者是 `valid` 为 `true` 的时候跳出循环。

```js
const simpleCheckRE = /^(String|Number|Boolean|Function|Symbol)$/
function assertType (value: any, type: Function): {
  valid: boolean;
  expectedType: string;
} {
  let valid
  const expectedType = getType(type)
  if (simpleCheckRE.test(expectedType)) {
    const t = typeof value
    valid = t === expectedType.toLowerCase()
    // for primitive wrapper objects
    if (!valid && t === 'object') {
      valid = value instanceof type
    }
  } else if (expectedType === 'Object') {
    valid = isPlainObject(value)
  } else if (expectedType === 'Array') {
    valid = Array.isArray(value)
  } else {
    valid = value instanceof type
  }
  return {
    valid,
    expectedType
  }
}
```

`assertType` 的逻辑很简单，先通过 `getType(type)` 获取 `prop` 期望的类型 `expectedType`，然后再去根据几种不同的情况对比 `prop` 的值 `value` 是否和 `expectedType` 匹配，最后返回匹配的结果。

如果循环结束后 `valid` 仍然为 `false`，那么说明 `prop` 的值 `value` 与 `prop` 定义的类型都不匹配，那么就会输出一段通过 `getInvalidTypeMessage(name, value, expectedTypes)` 生成的警告信息，就不细说了。

最后判断当 `prop` 自己定义了 `validator` 自定义校验器，则执行 `validator` 校验器方法，如果校验不通过则输出警告信息。

### 响应式

回到 `initProps` 方法，当我们通过 `const value = validateProp(key, propsOptions, propsData, vm)` 对 `prop` 做验证并且获取到 `prop` 的值后，接下来需要通过 `defineReactive` 把 `prop` 变成响应式。

`defineReactive` 我们之前已经介绍过，这里要注意的是，在开发环境中我们会校验 `prop` 的 `key` 是否是 `HTML` 的保留属性，并且在 `defineReactive` 的时候会添加一个自定义 `setter`，当我们直接对 `prop` 赋值的时候会输出警告：

```js
if (process.env.NODE_ENV !== 'production') {
  const hyphenatedKey = hyphenate(key)
  if (isReservedAttribute(hyphenatedKey) ||
      config.isReservedAttr(hyphenatedKey)) {
    warn(
      `"${hyphenatedKey}" is a reserved attribute and cannot be used as component prop.`,
      vm
    )
  }
  defineReactive(props, key, value, () => {
    if (!isRoot && !isUpdatingChildComponent) {
      warn(
        `Avoid mutating a prop directly since the value will be ` +
        `overwritten whenever the parent component re-renders. ` +
        `Instead, use a data or computed property based on the prop's ` +
        `value. Prop being mutated: "${key}"`,
        vm
      )
    }
  })
} 
```

关于 `prop` 的响应式有一点不同的是当 `vm` 是非根实例的时候，会先执行 `toggleObserving(false)`，它的目的是为了响应式的优化，我们先跳过，之后会详细说明。

### 代理

在经过响应式处理后，我们会把 `prop` 的值添加到 `vm._props` 中，比如 key 为 `name` 的 `prop`，它的值保存在 `vm._props.name` 中，但是我们在组件中可以通过 `this.name` 访问到这个 `prop`，这就是代理做的事情。

```js
// static props are already proxied on the component's prototype
// during Vue.extend(). We only need to proxy props defined at
// instantiation here.
if (!(key in vm)) {
  proxy(vm, `_props`, key)
}
```

通过 `proxy` 函数实现了上述需求。

```js
const sharedPropertyDefinition = {
  enumerable: true,
  configurable: true,
  get: noop,
  set: noop
}

export function proxy (target: Object, sourceKey: string, key: string) {
  sharedPropertyDefinition.get = function proxyGetter () {
    return this[sourceKey][key]
  }
  sharedPropertyDefinition.set = function proxySetter (val) {
    this[sourceKey][key] = val
  }
  Object.defineProperty(target, key, sharedPropertyDefinition)
}
```

当访问 `this.name` 的时候就相当于访问 `this._props.name`。

其实对于非根实例的子组件而言，`prop` 的代理发生在 `Vue.extend` 阶段，在 `src/core/global-api/extend.js` 中：

```js
Vue.extend = function (extendOptions: Object): Function {
  // ...
  const Sub = function VueComponent (options) {
    this._init(options)
  }
  // ...

  // For props and computed properties, we define the proxy getters on
  // the Vue instances at extension time, on the extended prototype. This
  // avoids Object.defineProperty calls for each instance created.
  if (Sub.options.props) {
    initProps(Sub)
  }
  if (Sub.options.computed) {
    initComputed(Sub)
  }

  // ...
  return Sub
}

function initProps (Comp) {
  const props = Comp.options.props
  for (const key in props) {
    proxy(Comp.prototype, `_props`, key)
  }
}
```

这么做的好处是不用为每个组件实例都做一层 `proxy`，是一种优化手段。

## Props 更新

我们知道，当父组件传递给子组件的 `props` 值变化，子组件对应的值也会改变，同时会触发子组件的重新渲染。那么接下来我们就从源码角度来分析这两个过程。

### 子组件 props 更新

首先，`prop` 数据的值变化在父组件，我们知道在父组件的 `render` 过程中会访问到这个 `prop` 数据，所以当 `prop` 数据变化一定会触发父组件的重新渲染，那么重新渲染是如何更新子组件对应的 `prop` 的值呢？

在父组件重新渲染的最后，会执行 `patch` 过程，进而执行 `patchVnode` 函数，`patchVnode` 通常是一个递归过程，当它遇到组件 `vnode` 的时候，会执行组件更新过程的 `prepatch` 钩子函数，在 `src/core/vdom/patch.js` 中：

```js
function patchVnode (
  oldVnode,
  vnode,
  insertedVnodeQueue,
  ownerArray,
  index,
  removeOnly
) {
  // ...

  let i
  const data = vnode.data
  if (isDef(data) && isDef(i = data.hook) && isDef(i = i.prepatch)) {
    i(oldVnode, vnode)
  }
  // ...
}
```

`prepatch` 函数定义在 `src/core/vdom/create-component.js` 中：

```js
prepatch (oldVnode: MountedComponentVNode, vnode: MountedComponentVNode) {
  const options = vnode.componentOptions
  const child = vnode.componentInstance = oldVnode.componentInstance
  updateChildComponent(
    child,
    options.propsData, // updated props
    options.listeners, // updated listeners
    vnode, // new parent vnode
    options.children // new children
  )
}
```

内部会调用 `updateChildComponent` 方法来更新 `props`，注意第二个参数就是父组件的 `propData`，那么为什么 `vnode.componentOptions.propsData` 就是父组件传递给子组件的 `prop` 数据呢（这个也同样解释了第一次渲染的 `propsData` 来源）？原来在组件的 `render` 过程中，对于组件节点会通过 `createComponent` 方法来创建组件 `vnode`：

```js
export function createComponent (
  Ctor: Class<Component> | Function | Object | void,
  data: ?VNodeData,
  context: Component,
  children: ?Array<VNode>,
  tag?: string
): VNode | Array<VNode> | void {
  // ...

  // extract props
  const propsData = extractPropsFromVNodeData(data, Ctor, tag)

  // ...
  
  const vnode = new VNode(
    `vue-component-${Ctor.cid}${name ? `-${name}` : ''}`,
    data, undefined, undefined, undefined, context,
    { Ctor, propsData, listeners, tag, children },
    asyncFactory
  )

  // ...
  
  return vnode
}
```

在创建组件 `vnode` 的过程中，首先从 `data` 中提取出 `propData`，然后在 `new VNode` 的时候，作为第七个参数 `VNodeComponentOptions` 中的一个属性传入，所以我们可以通过 `vnode.componentOptions.propsData` 拿到 `prop` 数据。

接着看 `updateChildComponent` 函数，它的定义在 `src/core/instance/lifecycle.js` 中：

```js
export function updateChildComponent (
  vm: Component,
  propsData: ?Object,
  listeners: ?Object,
  parentVnode: MountedComponentVNode,
  renderChildren: ?Array<VNode>
) {
  // ...

  // update props
  if (propsData && vm.$options.props) {
    toggleObserving(false)
    const props = vm._props
    const propKeys = vm.$options._propKeys || []
    for (let i = 0; i < propKeys.length; i++) {
      const key = propKeys[i]
      const propOptions: any = vm.$options.props // wtf flow?
      props[key] = validateProp(key, propOptions, propsData, vm)
    }
    toggleObserving(true)
    // keep a copy of raw propsData
    vm.$options.propsData = propsData
  }

  // ...
}
```

我们重点来看更新 `props` 的相关逻辑，这里的 `propsData` 是父组件传递的 `props` 数据，`vm` 是子组件的实例。`vm._props` 指向的就是子组件的 `props` 值，`propKeys` 就是在之前 `initProps` 过程中，缓存的子组件中定义的所有 `prop` 的 `key`。主要逻辑就是遍历 `propKeys`，然后执行 `props[key] = validateProp(key, propOptions, propsData, vm)` 重新验证和计算新的 `prop` 数据，更新 `vm._props`，也就是子组件的 `props`，这个就是子组件  `props` 的更新过程。

### 子组件重新渲染

其实子组件的重新渲染有 2 种情况，一个是 `prop` 值被修改，另一个是对象类型的 `prop` 内部属性的变化。

先来看一下 `prop` 值被修改的情况，当执行 `props[key] = validateProp(key, propOptions, propsData, vm)` 更新子组件 `prop` 的时候，会触发 `prop` 的 `setter` 过程，只要在渲染子组件的时候访问过这个 `prop` 值，那么根据响应式原理，就会触发子组件的重新渲染。

再来看一下当对象类型的 `prop` 的内部属性发生变化的时候，这个时候其实并没有触发子组件 `prop` 的更新。但是在子组件的渲染过程中，访问过这个对象 `prop`，所以这个对象 `prop` 在触发 `getter` 的时候会把子组件的 `render watcher` 收集到依赖中，然后当我们在父组件更新这个对象 `prop` 的某个属性的时候，会触发 `setter` 过程，也就会通知子组件 `render watcher` 的 `update`，进而触发子组件的重新渲染。

以上就是当父组件 `props` 更新，触发子组件重新渲染的 2 种情况。
 
## toggleObserving

最后我们在来聊一下 `toggleObserving`，它的定义在 `src/core/observer/index.js` 中：

```js
export let shouldObserve: boolean = true

export function toggleObserving (value: boolean) {
  shouldObserve = value
}
```

它在当前模块中定义了 `shouldObserve` 变量，用来控制在 `observe` 的过程中是否需要把当前值变成一个 `Observer` 对象。

那么为什么在 `props` 的初始化和更新过程中，多次执行 `toggleObserving(false)` 呢，接下来我们就来分析这几种情况。

在 `initProps` 的过程中：

```js
const isRoot = !vm.$parent
// root instance props should be converted
if (!isRoot) {
  toggleObserving(false)
}
for (const key in propsOptions) {
  // ...
  const value = validateProp(key, propsOptions, propsData, vm)
  defineReactive(props, key, value)
  // ...
}
toggleObserving(true)
```

对于非根实例的情况，我们会执行 `toggleObserving(false)`，然后对于每一个 `prop` 值，去执行 `defineReactive(props, key, value)` 去把它变成响应式。

回顾一下 `defineReactive` 的定义：

```js
export function defineReactive (
  obj: Object,
  key: string,
  val: any,
  customSetter?: ?Function,
  shallow?: boolean
) {
  // ...
  
  let childOb = !shallow && observe(val)
  Object.defineProperty(obj, key, {
    enumerable: true,
    configurable: true,
    get: function reactiveGetter () {
      // ...
    },
    set: function reactiveSetter (newVal) {
      // ...
    }
  })
}
```

通常对于值 `val` 会执行 `observe` 函数，然后遇到 `val` 是对象或者数组的情况会递归执行 `defineReactive` 把它们的子属性都变成响应式的，但是由于 `shouldObserve` 的值变成了 `false`，这个递归过程被省略了。为什么会这样呢？

因为正如我们前面分析的，对于对象的 `prop` 值，子组件的 `prop` 值始终指向父组件的 `prop` 值，只要父组件的 `prop` 值变化，就会触发子组件的重新渲染，所以这个 `observe` 过程是可以省略的。
 
最后再执行 `toggleObserving(true)` 恢复 `shouldObserve` 为 `true`。

在 `validateProp` 的过程中：

```js
// check default value
if (value === undefined) {
  value = getPropDefaultValue(vm, prop, key)
  // since the default value is a fresh copy,
  // make sure to observe it.
  const prevShouldObserve = shouldObserve
  toggleObserving(true)
  observe(value)
  toggleObserving(prevShouldObserve)
}
```

这种是父组件没有传递 `prop` 值对默认值的处理逻辑，因为这个值是一个拷贝，所以我们需要 `toggleObserving(true)`，然后执行 `observe(value)` 把值变成响应式。

在 `updateChildComponent` 过程中：

```js
// update props
if (propsData && vm.$options.props) {
  toggleObserving(false)
  const props = vm._props
  const propKeys = vm.$options._propKeys || []
  for (let i = 0; i < propKeys.length; i++) {
    const key = propKeys[i]
    const propOptions: any = vm.$options.props // wtf flow?
    props[key] = validateProp(key, propOptions, propsData, vm)
  }
  toggleObserving(true)
  // keep a copy of raw propsData
  vm.$options.propsData = propsData
}
```

其实和 `initProps` 的逻辑一样，不需要对引用类型 `props` 递归做响应式处理，所以也需要 `toggleObserving(false)`。

## 总结

通过这一节的分析，我们了解了 `props` 的规范化、初始化、更新等过程的实现原理；也了解了 Vue 内部对 `props` 如何做响应式的优化；同时还了解到 `props` 的变化是如何触发子组件的更新。了解这些对我们平时对 `props` 的应用，遇到问题时的定位追踪会有很大的帮助。
