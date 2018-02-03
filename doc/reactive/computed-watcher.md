# 计算属性 VS 侦听属性

Vue 的组件对象支持了计算属性 `computed` 和侦听属性 `watch` 2 个选项，很多同学不了解什么时候该用 `computed` 什么时候该用 `watch`。先不回答这个问题，我们接下来从源码实现的角度来分析它们两者有什么区别。

## `computed`

计算属性的初始化是发生在 Vue 实例初始化阶段的 `initState` 函数中，执行了 `if (opts.computed) initComputed(vm, opts.computed)`，`initComputed` 的定义在 `src/core/instance/state.js` 中。

```js
function initComputed (vm: Component, computed: Object) {
  const watchers = vm._computedWatchers = Object.create(null)
  
  // ssr 部分可以忽略，简单把它标记为 false
  const isSSR = isServerRendering()

  for (const key in computed) {
    const userDef = computed[key]
    // 尝试拿 getter 方法，拿不到则报警告
    const getter = typeof userDef === 'function' ? userDef : userDef.get
    if (process.env.NODE_ENV !== 'production' && getter == null) {
      warn(
        `Getter is missing for computed property "${key}".`,
        vm
      )
    }

    if (!isSSR) {
      // create internal watcher for the computed property.
      watchers[key] = new Watcher(
        vm,
        getter || noop,
        noop,
        computedWatcherOptions
      )
    }

    if (!(key in vm)) {
      defineComputed(vm, key, userDef)
    } else if (process.env.NODE_ENV !== 'production') {
      if (key in vm.$data) {
        warn(`The computed property "${key}" is already defined in data.`, vm)
      } else if (vm.$options.props && key in vm.$options.props) {
        warn(`The computed property "${key}" is already defined as a prop.`, vm)
      }
    }
  }
}
```
函数首先创建 `vm._computedWatchers` 为一个空对象，接着对 `computed` 对象做遍历，拿到计算属性的每一个 `userDef`，然后尝试获取这个 `userDef` 对应的 `getter` 函数，拿不到则在开发环境下报警告。接下来为每一个 `getter` 创建一个 `watcher`，这个 `watcher` 和渲染 `watcher` 有一点很大的不同，它是一个 `lazy watcher`，因为 `const computedWatcherOptions = { lazy: true }`。`lazy watcher` 的特点是在实例化后，并不会立刻计算 `getter`，它是延迟计算的。最后对判断如果 `key` 不是 `vm` 的属性，则调用 `defineComputed(vm, key, userDef)`，否则判断计算属性对于的 `key` 是否已经被 `data` 或者 `prop` 所占用，如果是的话则在开发环境报相应的警告。
 
 那么接下来需要重点关注 `defineComputed` 的实现，它的定义在 `src/core/instance/state.js` 中。
 
```js
export function defineComputed (
  target: any,
  key: string,
  userDef: Object | Function
) {
  const shouldCache = !isServerRendering()
  if (typeof userDef === 'function') {
    sharedPropertyDefinition.get = shouldCache
      ? createComputedGetter(key)
      : userDef
    sharedPropertyDefinition.set = noop
  } else {
    sharedPropertyDefinition.get = userDef.get
      ? shouldCache && userDef.cache !== false
        ? createComputedGetter(key)
        : userDef.get
      : noop
    sharedPropertyDefinition.set = userDef.set
      ? userDef.set
      : noop
  }
  if (process.env.NODE_ENV !== 'production' &&
      sharedPropertyDefinition.set === noop) {
    sharedPropertyDefinition.set = function () {
      warn(
        `Computed property "${key}" was assigned to but it has no setter.`,
        this
      )
    }
  }
  Object.defineProperty(target, key, sharedPropertyDefinition)
}
```

这段逻辑很简单，其实就是利用 `Object.defineProperty` 给计算属性对应的 `key` 值添加 getter 和 setter，setter 通常是计算属性是一个对象，并且拥有 `set` 方法的时候才有，否则是一个空函数。在平时的开发场景中，计算属性有 setter 的情况比较少，我们重点关注一下 getter 部分，缓存的配置也先忽略，最终 getter 对应的是 `createComputedGetter(key)` 的返回值，它的定义在 `src/core/instance/state.js` 中。

```js
function createComputedGetter (key) {
  return function computedGetter () {
    const watcher = this._computedWatchers && this._computedWatchers[key]
    if (watcher) {
      if (watcher.dirty) {
        watcher.evaluate()
      }
      if (Dep.target) {
        watcher.depend()
      }
      return watcher.value
    }
  }
}
```
`createComputedGetter` 返回一个函数 `computedGetter`，它就是计算属性对应的 getter。

整个计算属性的初始化过程到此结束，那么接下来来我们来通过一个例子来分析当计算属性被访问的时候，它的 getter 逻辑都做了什么。

```js
var vm = new Vue({
  data: {
    firstName: 'Foo',
    lastName: 'Bar'
  },
  computed: {
    fullName: function () {
      return this.firstName + ' ' + this.lastName
    }
  }
})
```
当我们的 `render` 函数执行访问到 `this.fullName` 的时候，就触发了计算属性的 `getter`，它会拿到计算属性对应的 `watcher`，然后判断 `watcher.dirty`，因为在 `watcher` 实例化的时候执行了 `this.dirty = this.lazy`，所以此时 `watcher.dirty` 为 true，执行 `watcher.evaluate()`，它的定义在 `src/core/observer/watcher.js` 中。

```js
class Watcher{
  evaluate () {
    this.value = this.get()
    this.dirty = false
  }
}
```
`evaluate` 的逻辑非常简单，通过 `this.get()` 求值，然后把 `this.dirty` 设置为 false。在求值过程中，会执行 `value = this.getter.call(vm, vm)`，这实际上就是执行了计算属性定义的 `getter` 函数，在我们这个例子就是执行了 `return this.firstName + ' ' + this.lastName`。

这里需要特别注意的是，由于 `this.firstName` 和 `this.lastName` 都是响应式对象，这里会触发它们的 getter，根据我们之前的分析，它们会把自身持有的 `dep` 添加到当前正在计算的 `watcher` 中，显然这个 `watcher` 就是计算属性对应的 `watcher`。

那么执行完 `watcher.evaluate()` 后又会判断 `Dep.target` 执行 `watcher.depend()`，因为首次访问计算属性是在执行 `render` 的时候，此时 `Dep.target` 对应的是渲染 `watcher`，所以 `watcher.depend()` 会被执行，它的定义在 `src/core/observer/watcher.js` 中。

```js
class Watcher{
  depend () {
    let i = this.deps.length
    while (i--) {
      this.deps[i].depend()
    }
  }
}
```
这时候遍历的 `deps`，就是计算属性依赖的响应式数据持有的 `dep`，这里就是 `this.firstName` 和 `this.lastName` 持有的 `dep`，当调用 `dep.depend()`，最终是把这些 `dep` 添加到当前正在计算的 `watcher`，也就是渲染 `watcher` 中，这样做的目的是为了之后我们对计算属性的依赖数据做修改，能够通知到渲染 `watcher` 重新渲染。

最后通过 `return watcher.value` 拿到计算属性对应的值。在了解了计算属性访问的过程后，我们也就明白了，之后除非计算属性依赖的数据发生变化，否则它对应的 `watcher` 始终不会重新求值，而是返回之前的 `value`。

一旦我们对计算属性依赖的数据做修改，则会触发 setter 过程，通知所有订阅它变化的 `watcher` 更新，执行 `watcher.update()` 方法，那么对于计算属性这样的 `lazy watcher`，它仅仅是执行 `this.dirty = true`，只有当下一次计算属性再次被访问的时候，才会真正重新求值。这样的好处就是当我的一个计算属性依赖多个响应式数据并且它们都被修改，也只会当计算属性再次访问的时候只计算一次。

通过以上的分析，我们知道计算属性本质上就是一个 `lazy watcher`，也了解了它的创建过程和被访问触发 getter 的过程，接下来我们来分析一下侦听属性 `watch` 是怎么实现的。

## watch

侦听属性的初始化也是发生在 Vue 的实例初始化阶段的 `initState` 函数中，在 `computed` 初始化之后，执行了：

```js
if (opts.watch && opts.watch !== nativeWatch) {
  initWatch(vm, opts.watch)
}
```
来看一下 `initWatch` 的实现，它的定义在 `src/core/instance/state.js` 中。

```js
function initWatch (vm: Component, watch: Object) {
  for (const key in watch) {
    const handler = watch[key]
    if (Array.isArray(handler)) {
      for (let i = 0; i < handler.length; i++) {
        createWatcher(vm, key, handler[i])
      }
    } else {
      createWatcher(vm, key, handler)
    }
  }
}
```
这里就是对 `watch` 对象做遍历，拿到每一个  `handler`，因为 Vue 是支持 `watch` 的同一个 `key` 对应多个 `handler`，所以如果 `handler` 是一个数组，则遍历这个数组，调用 `createWatcher` 方法，否则直接调用 `createWatcher`，它的定义在 `src/core/instance/state.js` 中。

```js
function createWatcher (
  vm: Component,
  keyOrFn: string | Function,
  handler: any,
  options?: Object
) {
  if (isPlainObject(handler)) {
    options = handler
    handler = handler.handler
  }
  if (typeof handler === 'string') {
    handler = vm[handler]
  }
  return vm.$watch(keyOrFn, handler, options)
}
```
这里的逻辑也很简单，首先对 `hanlder` 的类型做判断，拿到它最终的回调函数，最后调用 `vm.$watch(keyOrFn, handler, options)` 函数，`$watch` 是 Vue 原型上的方法，它是在执行 `stateMixin` 的时候定义的，在 `src/core/instance/state.js` 中。

```js
Vue.prototype.$watch = function (
    expOrFn: string | Function,
    cb: any,
    options?: Object
  ): Function {
    const vm: Component = this
    if (isPlainObject(cb)) {
      return createWatcher(vm, expOrFn, cb, options)
    }
    options = options || {}
    options.user = true
    const watcher = new Watcher(vm, expOrFn, cb, options)
    if (options.immediate) {
      cb.call(vm, watcher.value)
    }
    return function unwatchFn () {
      watcher.teardown()
    }
  }
```

也就是说，侦听属性 `watch` 最终会调用 `$watch` 方法，这个方法首先判断 `cb` 如果是一个对象，则调用 `createWatcher` 方法，这是因为 `$watch` 方法是用户可以直接调用的，它可以传递一个对象，也可以传递函数。接着执行 `const watcher = new Watcher(vm, expOrFn, cb, options)` 实例化了一个 `watcher`，这里需要注意一点这是一个 user `watcher`，因为 `options.user = true`。通过实例化 `watcher` 的方式，一旦我们 `watch` 的数据发送变化，它最终会执行 `watcher` 的 `run` 方法，执行回调函数 `cb`，并且如果我们设置了 `immediate` 为 true，则直接会执行回调函数 `cb`。最后返回了一个 `unwatchFn` 方法，它会调用 `teardown` 方法去移除这个 `watcher`。

所以本质上侦听属性也是基于 `Watcher` 实现的，它是一个 `user watcher`。其实 `Watcher` 支持了不同的类型，下面我们梳理一下它有哪些类型以及它们的作用。

## Watcher options

`Watcher` 的构造函数对 `options` 做的了处理，代码如下：

```js
if (options) {
  this.deep = !!options.deep
  this.user = !!options.user
  this.lazy = !!options.lazy
  this.sync = !!options.sync
} else {
  this.deep = this.user = this.lazy = this.sync = false
}
```
所以 `watcher` 总共有 4 种类型，我们来一一分析它们，看看不同的类型执行的逻辑有哪些差别。

- `deep`

通常，如果我们想对一下对象做深度观测的时候，需要设置这个属性为 true，考虑到这种情况：

```js
var vm = new Vue({
  data() {
    a: {
      b: 1
    }
  },
  watch: {
    a: {
      handler(newVal) {
        console.log(newVal)
      }
    }
  }
})
vm.a.b = 2
```
这个时候是不会 log 任何数据的，因为我们是 watch 了 `a` 对象，只触发了 `a` 的 getter，并没有触发 `a.b` 的 getter，所以并没有订阅它的变化，导致我们对 `vm.a.b = 2` 赋值的时候，虽然触发了 setter，但没有可通知的对象，所以也并不会触发 watch 的回调函数了。

而我们只需要对代码做稍稍修改，就可以观测到这个变化了

```js
watch: {
  a: {
    deep: true,
    handler(newVal) {
      console.log(newVal)
    }
  }
}
```

这样就创建了一个 `deep watcher` 了，在 `watcher ` 执行 `get` 求值的过程中有一段逻辑：

```js
get() {
  let value = this.getter.call(vm, vm)
  // ...
  if (this.deep) {
    traverse(value)
  }
}
```
在对 watch 的表达式或者函数求值后，会调用 `traverse` 函数，它的定义在 `src/core/observer/traverse.js` 中。

```js
import { _Set as Set, isObject } from '../util/index'
import type { SimpleSet } from '../util/index'

const seenObjects = new Set()

export function traverse (val: any) {
  _traverse(val, seenObjects)
  seenObjects.clear()
}

function _traverse (val: any, seen: SimpleSet) {
  let i, keys
  const isA = Array.isArray(val)
  if ((!isA && !isObject(val)) || Object.isFrozen(val)) {
    return
  }
  if (val.__ob__) {
    const depId = val.__ob__.dep.id
    if (seen.has(depId)) {
      return
    }
    seen.add(depId)
  }
  if (isA) {
    i = val.length
    while (i--) _traverse(val[i], seen)
  } else {
    keys = Object.keys(val)
    i = keys.length
    while (i--) _traverse(val[keys[i]], seen)
  }
}

```

`traverse` 的逻辑也很简单，它实际上就是对一个对象做深层递归遍历，因为遍历过程中就是对一个子对象的访问，会触发它们的 getter 过程，这样就可以收集到依赖，也就是订阅它们变化的 `watcher`，这个函数实现还有一个小的优化，遍历过程中会把子响应式对象通过它们的 `dep id` 记录到 `seenObjects`，避免以后重复访问。

那么在执行了 `traverse` 后，我们再对 watch 的对象内部任何一个值做修改，也会调用 `watcher` 的回调函数了。

对 `deep watcher` 的理解非常重要，今后工作中如果大家观测了一个复杂对象，并且会改变对象内部深层某个值的时候也希望触发回调，一定要设置 `deep` 为 true，但是因为设置了 `deep` 后会执行 `traverse` 函数，会有一定的性能开销，所以一定要根据应用场景权衡是否要开启这个配置。

- `user`

前面我们分析过，通过 `vm.$watch` 创建的 `watcher` 是一个 `user watcher`，其实它的功能很简单，在对 `watcher` 求值以及在执行回调函数的时候，会处理一下错误，如下：

```js
get() {
  if (this.user) {
    handleError(e, vm, `getter for watcher "${this.expression}"`)
  } else {
    throw e
  }
},
run() {
  // ...
  if (this.user) {
    try {
      this.cb.call(this.vm, value, oldValue)
    } catch (e) {
      handleError(e, this.vm, `callback for watcher "${this.expression}"`)
    }
  } else {
    this.cb.call(this.vm, value, oldValue)
  }
}
```
`handleError` 在 Vue 中是一个错误捕获并且暴露给用户的一个利器，在之后的章节我会详细介绍。

- `lazy`

`lazy watcher` 几乎就是为计算属性量身定制的，它和普通 `watcher` 的唯一区别就是执行 `wathcer.update()` 的时候，通过 `this.dirty = true` 设置一个标记，并不去执行回调函数，只有当下一次再访问这个计算属性的时候，才会执行 `watcher.evaluate()` 执行它的回调函数。

- `sync`

在我们之前对 `setter` 的分析过程知道，当响应式数据发送变化后，触发了 `watcher.update()`，只是把这个 `watcher` 推送到一个队列中，在 `nextTick` 后才会真正执行 `watcher` 的回调函数。而一旦我们设置了 `sync`，就可以在当前 `Tick` 中同步执行 `watcher` 的回调函数。

```js
update () {
  if (this.lazy) {
    this.dirty = true
  } else if (this.sync) {
    this.run()
  } else {
    queueWatcher(this)
  }
}
```
只有当我们需要 watch 的值的变化到执行 `watcher` 的回调函数是一个同步过程的时候才会去设置该属性为 true。

## 总结

通过这一小节的分析我们对计算属性和侦听属性的实现有了深入的了解，计算属性本质上是 `lazy watcher`，而侦听属性本质上是 `user watcher`。就应用场景而言，计算属性适合用在模板渲染中，某个值是依赖了其它的响应式对象甚至是计算属性计算而来；而侦听属性适用于观测某个值的变化去完成一段复杂的业务逻辑。

同时我们又了解了 `watcher` 的 4 个 `options`，通常我们会在创建 `user watcher` 的时候配置 `deep` 和 `sync`，可以根据不同的场景做相应的配置。








 
