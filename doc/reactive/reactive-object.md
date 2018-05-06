# 响应式对象

可能很多小伙伴之前都了解过 Vue.js 实现响应式的核心是利用了 ES5 的 `Object.defineProperty`，这也是为什么 Vue.js 不能兼容 IE8 及以下浏览器的原因，我们先来对它有个直观的认识。

## Object.defineProperty    

`Object.defineProperty` 方法会直接在一个对象上定义一个新属性，或者修改一个对象的现有属性， 并返回这个对象，先来看一下它的语法：

```js
Object.defineProperty(obj, prop, descriptor)
```

`obj` 是要在其上定义属性的对象；`prop` 是要定义或修改的属性的名称；`descriptor` 是将被定义或修改的属性描述符。

比较核心的是 `descriptor`，它有很多可选键值，具体的可以去参阅它的[文档](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/Object/defineProperty)。这里我们最关心的是 `get` 和 `set`，`get` 是一个给属性提供的 getter 方法，当我们访问了该属性的时候会触发 getter 方法；`set` 是一个给属性提供的 setter 方法，当我们对该属性做修改的时候会触发 setter 方法。

一旦对象拥有了 getter 和 setter，我们可以简单地把这个对象称为响应式对象。那么 Vue.js 把哪些对象变成了响应式对象了呢，接下来我们从源码层面分析。

## initState

在 Vue 的初始化阶段，`_init` 方法执行的时候，会执行 `initState(vm)` 方法，它的定义在 `src/core/instance/state.js` 中。

```js
export function initState (vm: Component) {
  vm._watchers = []
  const opts = vm.$options
  if (opts.props) initProps(vm, opts.props)
  if (opts.methods) initMethods(vm, opts.methods)
  if (opts.data) {
    initData(vm)
  } else {
    observe(vm._data = {}, true /* asRootData */)
  }
  if (opts.computed) initComputed(vm, opts.computed)
  if (opts.watch && opts.watch !== nativeWatch) {
    initWatch(vm, opts.watch)
  }
}
```
`initState` 方法主要是对 `props`、`methods`、`data`、`computed` 和 `wathcer` 等属性做了初始化操作。这里我们重点分析 `props` 和 `data`，对于其它属性的初始化我们之后再详细分析。

- initProps

```js
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
        if (vm.$parent && !isUpdatingChildComponent) {
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
`props` 的初始化主要过程，就是遍历定义的 `props` 配置。遍历的过程主要做两件事情：一个是调用 `defineReactive` 方法把每个 `prop` 对应的值变成响应式，可以通过 `vm._props.xxx` 访问到定义 `props` 中对应的属性。对于 `defineReactive` 方法，我们稍后会介绍；另一个是通过 `proxy` 把 `vm._props.xxx` 的访问代理到 `vm.xxx` 上，我们稍后也会介绍。

- initData

```js
function initData (vm: Component) {
  let data = vm.$options.data
  data = vm._data = typeof data === 'function'
    ? getData(data, vm)
    : data || {}
  if (!isPlainObject(data)) {
    data = {}
    process.env.NODE_ENV !== 'production' && warn(
      'data functions should return an object:\n' +
      'https://vuejs.org/v2/guide/components.html#data-Must-Be-a-Function',
      vm
    )
  }
  // proxy data on instance
  const keys = Object.keys(data)
  const props = vm.$options.props
  const methods = vm.$options.methods
  let i = keys.length
  while (i--) {
    const key = keys[i]
    if (process.env.NODE_ENV !== 'production') {
      if (methods && hasOwn(methods, key)) {
        warn(
          `Method "${key}" has already been defined as a data property.`,
          vm
        )
      }
    }
    if (props && hasOwn(props, key)) {
      process.env.NODE_ENV !== 'production' && warn(
        `The data property "${key}" is already declared as a prop. ` +
        `Use prop default value instead.`,
        vm
      )
    } else if (!isReserved(key)) {
      proxy(vm, `_data`, key)
    }
  }
  // observe data
  observe(data, true /* asRootData */)
}
```

`data` 的初始化主要过程也是做两件事，一个是对定义 `data` 函数返回对象的遍历，通过 `proxy` 把每一个值 `vm._data.xxx` 都代理到 `vm.xxx` 上；另一个是调用 `observe` 方法观测整个 `data` 的变化，把 `data` 也变成响应式，可以通过 `vm._data.xxx` 访问到定义 `data` 返回函数中对应的属性，`observe` 我们稍后会介绍。

可以看到，无论是 `props` 或是 `data` 的初始化都是把它们变成响应式对象，这个过程我们接触到几个函数，接下来我们来详细分析它们。

## proxy

首先介绍一下代理，代理的作用是把 `props` 和 `data` 上的属性代理到 `vm` 实例上，这也就是为什么比如我们定义了如下 props，却可以通过 vm 实例访问到它。

```js
let comP = {
  props: {
    msg: 'hello'
  },
  methods: {
    say() {
      console.log(this.msg)
    }
  }
}
```

我们可以在 `say` 函数中通过 `this.msg` 访问到我们定义在 `props` 中的 `msg`，这个过程发生在 `proxy` 阶段：

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

`proxy` 方法的实现很简单，通过 `Object.defineProperty` 把 `target[sourceKey][key]` 的读写变成了对 `target[key]`  的读写。所以对于 `props` 而言，对 `vm._props.xxx` 的读写变成了 `vm.xxx` 的读写，而对于 `vm._props.xxx` 我们可以访问到定义在 `props` 中的属性，所以我们就可以通过 `vm.xxx` 访问到定义在 `props` 中的 `xxx` 属性了。同理，对于 `data` 而言，对 `vm._data.xxxx` 的读写变成了对 `vm.xxxx` 的读写，而对于 `vm._data.xxxx` 我们可以访问到定义在 `data` 函数返回对象中的属性，所以我们就可以通过 `vm.xxxx` 访问到定义在 `data` 函数返回对象中的 `xxxx` 属性了。

## `observe`

`observe` 的功能就是用来监测数据的变化，它的定义在 `src/core/observer/index.js` 中：

```js
/**
 * Attempt to create an observer instance for a value,
 * returns the new observer if successfully observed,
 * or the existing observer if the value already has one.
 */
export function observe (value: any, asRootData: ?boolean): Observer | void {
  if (!isObject(value) || value instanceof VNode) {
    return
  }
  let ob: Observer | void
  if (hasOwn(value, '__ob__') && value.__ob__ instanceof Observer) {
    ob = value.__ob__
  } else if (
    shouldObserve &&
    !isServerRendering() &&
    (Array.isArray(value) || isPlainObject(value)) &&
    Object.isExtensible(value) &&
    !value._isVue
  ) {
    ob = new Observer(value)
  }
  if (asRootData && ob) {
    ob.vmCount++
  }
  return ob
}
```

`observe` 方法的作用就是给非 VNode 的对象类型数据添加一个 `Observer`，如果已经添加过则直接返回，否则在满足一定条件下去实例化一个 `Observer` 对象实例。接下来我们来看一下 `Observer` 的作用。

## Observer

`Observer` 是一个类，它的作用是给对象的属性添加 getter 和 setter，用于依赖收集和派发更新：

```js
/**
 * Observer class that is attached to each observed
 * object. Once attached, the observer converts the target
 * object's property keys into getter/setters that
 * collect dependencies and dispatch updates.
 */
export class Observer {
  value: any;
  dep: Dep;
  vmCount: number; // number of vms that has this object as root $data

  constructor (value: any) {
    this.value = value
    this.dep = new Dep()
    this.vmCount = 0
    def(value, '__ob__', this)
    if (Array.isArray(value)) {
      const augment = hasProto
        ? protoAugment
        : copyAugment
      augment(value, arrayMethods, arrayKeys)
      this.observeArray(value)
    } else {
      this.walk(value)
    }
  }

  /**
   * Walk through each property and convert them into
   * getter/setters. This method should only be called when
   * value type is Object.
   */
  walk (obj: Object) {
    const keys = Object.keys(obj)
    for (let i = 0; i < keys.length; i++) {
      defineReactive(obj, keys[i])
    }
  }

  /**
   * Observe a list of Array items.
   */
  observeArray (items: Array<any>) {
    for (let i = 0, l = items.length; i < l; i++) {
      observe(items[i])
    }
  }
}
```

`Observer` 的构造函数逻辑很简单，首先实例化 `Dep` 对象，这块稍后会介绍，接着通过执行 `def` 函数把自身实例添加到数据对象 `value` 的 `__ob__` 属性上，`def` 的定义在 `src/core/util/lang.js` 中：

```js
/**
 * Define a property.
 */
export function def (obj: Object, key: string, val: any, enumerable?: boolean) {
  Object.defineProperty(obj, key, {
    value: val,
    enumerable: !!enumerable,
    writable: true,
    configurable: true
  })
}
```

`def` 函数是一个非常简单的`Object.defineProperty` 的封装，这就是为什么我在开发中输出 `data` 上对象类型的数据，会发现该对象多了一个 `__ob__` 的属性。

回到 `Observer` 的构造函数，接下来会对 `value` 做判断，对于数组会调用 `observeArray` 方法，否则对纯对象调用 `walk` 方法。可以看到 `observeArray` 是遍历数组再次调用 `observe` 方法，而 `walk` 方法是遍历对象的 key 调用 `defineReactive` 方法，那么我们来看一下这个方法是做什么的。

## defineReactive

`defineReactive` 的功能就是定义一个响应式对象，给对象动态添加 getter 和 setter，它的定义在 `src/core/observer/index.js` 中：

```js
/**
 * Define a reactive property on an Object.
 */
export function defineReactive (
  obj: Object,
  key: string,
  val: any,
  customSetter?: ?Function,
  shallow?: boolean
) {
  const dep = new Dep()

  const property = Object.getOwnPropertyDescriptor(obj, key)
  if (property && property.configurable === false) {
    return
  }

  // cater for pre-defined getter/setters
  const getter = property && property.get
  const setter = property && property.set
  if ((!getter || setter) && arguments.length === 2) {
    val = obj[key]
  }

  let childOb = !shallow && observe(val)
  Object.defineProperty(obj, key, {
    enumerable: true,
    configurable: true,
    get: function reactiveGetter () {
      const value = getter ? getter.call(obj) : val
      if (Dep.target) {
        dep.depend()
        if (childOb) {
          childOb.dep.depend()
          if (Array.isArray(value)) {
            dependArray(value)
          }
        }
      }
      return value
    },
    set: function reactiveSetter (newVal) {
      const value = getter ? getter.call(obj) : val
      /* eslint-disable no-self-compare */
      if (newVal === value || (newVal !== newVal && value !== value)) {
        return
      }
      /* eslint-enable no-self-compare */
      if (process.env.NODE_ENV !== 'production' && customSetter) {
        customSetter()
      }
      if (setter) {
        setter.call(obj, newVal)
      } else {
        val = newVal
      }
      childOb = !shallow && observe(newVal)
      dep.notify()
    }
  })
}
```

`defineReactive` 函数最开始初始化 `Dep` 对象的实例，接着拿到 `obj` 的属性描述符，然后对子对象递归调用 `observe` 方法，这样就保证了无论 `obj` 的结构多复杂，它的所有子属性也能变成响应式的对象，这样我们访问或修改 `obj` 中一个嵌套较深的属性，也能触发 getter 和 setter。最后利用 `Object.defineProperty` 去给 `obj` 的属性 `key` 添加 getter 和 setter。而关于 getter 和 setter 的具体实现，我们会在之后介绍。

## 总结

这一节我们介绍了响应式对象，核心就是利用 `Object.defineProperty` 给数据添加了 getter 和 setter，目的就是为了在我们访问数据以及写数据的时候能自动执行一些逻辑：getter 做的事情是依赖收集，setter 做的事情是派发更新，那么在接下来的章节我们会重点对这两个过程分析。
 


