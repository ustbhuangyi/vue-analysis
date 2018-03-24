## 派发更新

通过上一节分析我们了解了响应式数据依赖收集过程，收集的目的就是为了当我们修改数据的时候，可以对相关的依赖派发更新，那么这一节我们来详细分析这个过程。

我们先来回顾一下 setter 部分的逻辑，代码的定义在 `src/core/observer/index.js` 中。

```js
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

  const setter = property && property.set

  let childOb = !shallow && observe(val)
  Object.defineProperty(obj, key, {
    enumerable: true,
    configurable: true,
    set: function reactiveSetter (newVal) {
      const value = getter ? getter.call(obj) : val
      if (newVal === value || (newVal !== newVal && value !== value)) {
        return
      }
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
    },
    // ...
  })
}
```

setter 的逻辑有 2 个关键的点，一个是 `childOb = !shallow && observe(newVal)`，如果 `shallow` 为 false 的情况，会对新设置的值变成一个响应式对象；另一个是 `dep.notify()`，通知所有的订阅者，这是本节的关键，接下来我会带大家完整的分析整个派发更新的过程。

## 过程分析

当我们在组件中对响应的数据做了修改，就会触发 setter 的逻辑，最后调用 `dep.notify()` 方法，
它是 `Dep` 的一个实例方法，定义在 `src/core/observer/dep.js` 中。

```js
class Dep {
  // ...
  notify () {
  // stabilize the subscriber list first
    const subs = this.subs.slice()
    for (let i = 0, l = subs.length; i < l;     i++) {
      subs[i].update()
    }
  }
}
```

这里的逻辑非常简单，遍历所有的 `subs`，也就是 `Watcher` 的实例数组，然后调用每一个 `Watcher` 实例的 `update` 方法，它的定义在 `src/core/observer/watcher.js` 中。

```js
class Watcher {
  // ...
  update () {
    if (this.lazy) {
      this.dirty = true
    } else if (this.sync) {
      this.run()
    } else {
      queueWatcher(this)
    }
  }
}  
```

这里对于 `Watcher` 的不同状态，会执行不同的逻辑，`lazy` 和 `sync` 等状态的分析我会之后抽一小节详细介绍，在一般组件数据更新的场景，会走到最后一个 `queueWatcher(this)` 的逻辑，`queueWatcher` 的定义在 `src/core/observer/scheduler.js` 中。

```js
const queue: Array<Watcher> = []
let has: { [key: number]: ?true } = {}
let waiting = false
let flushing = false
export function queueWatcher (watcher: Watcher) {
  const id = watcher.id
  if (has[id] == null) {
    has[id] = true
    if (!flushing) {
      queue.push(watcher)
    } else {
      let i = queue.length - 1
      while (i > index && queue[i].id > watcher.id) {
        i--
      }
      queue.splice(i + 1, 0, watcher)
    }
    // queue the flush
    if (!waiting) {
      waiting = true
      nextTick(flushSchedulerQueue)
    }
  }
}
```

这里引入了一个队列的概念，这也是 Vue 在做派发更新的时候的一个优化的点，它并不会每次数据改变都触发 `Watcher` 实例的回调，而是把这些 Watcher 先添加到一个队列里，然后在 `nextTick` 后执行 `flushSchedulerQueue`。

这里有几个细节要注意一下，首先用 `has` 对象保证同一个 `Watcher` 只添加一次；接着对 `flushing` 的判断，else 部分的逻辑稍后我会讲；最后通过 `wating` 保证对 `nextTick(flushSchedulerQueue)` 的调用逻辑只有一次，另外 `nextTick` 的实现我之后会抽一小节专门去讲，目前就可以理解它是在下一个 tick，也就是异步的去执行 `flushSchedulerQueue`。

接下来我们来看 `flushSchedulerQueue` 的实现，它的定义在 `src/core/observer/scheduler.js` 中。

```js
let flushing = false
let index = 0
function flushSchedulerQueue () {
  flushing = true
  let watcher, id

  // 对队列按 watcher 的 id 从小到大做排序，
  queue.sort((a, b) => a.id - b.id)

  // 这里不能缓存队列的长度，因为它在遍历的过程中可能会发生变化
  for (index = 0; index < queue.length; index++) {
    watcher = queue[index]
    id = watcher.id
    has[id] = null
    watcher.run()
    // 在开发阶段，检查并停止循环更新
    if (process.env.NODE_ENV !== 'production' && has[id] != null) {
      circular[id] = (circular[id] || 0) + 1
      if (circular[id] > MAX_UPDATE_COUNT) {
        warn(
          'You may have an infinite update loop ' + (
            watcher.user
              ? `in watcher with expression "${watcher.expression}"`
              : `in a component render function.`
          ),
          watcher.vm
        )
        break
      }
    }
  }

  // ...

  resetSchedulerState()

  // ...
}
```

这里有几个重要的逻辑要梳理一下，对于一些分支逻辑如 `keep-alive` 组件相关和之前提到过的 `updated` 钩子函数的执行会略过。

- 队列排序

`queue.sort((a, b) => a.id - b.id)` 对队列做了从小到大的排序，这门做主要有以下要确保以下几点：

1.组件的更新由父到子；因为父组件的创建过程是先于子的，所以 `Watcher` 实例的创建也是先父后子，执行顺序也应该保持先父后子。

2.用户的自定义 `watcher` 要优先于渲染 `watcher` 执行；因为用户自定义 `watcher` 是在渲染 `watcher` 之前创建的。

3.如果一个组件在父组件的 `watcher ` 执行期间被销毁，那么它对于的 `watcher` 执行都可以被跳过。

- 队列遍历

在对 `queue` 排序后，接着就是要对它做遍历，拿到对应的 `watcher`，执行 `watcher.run()`。这里需要注意一个细节，在遍历的时候每次都会对 `queue.length` 求值，因为在 `watcher.run()` 的时候，很可能用户会再次添加新的 `watcher`，这样会再次执行到 `queueWatcher`，如下：

```js
export function queueWatcher (watcher: Watcher) {
  const id = watcher.id
  if (has[id] == null) {
    has[id] = true
    if (!flushing) {
      queue.push(watcher)
    } else {
      let i = queue.length - 1
      while (i > index && queue[i].id > watcher.id) {
        i--
      }
      queue.splice(i + 1, 0, watcher)
    }
    // ...
  }
}
```
可以看到，这时候 `flushing` 为 true，就会执行到 else 的逻辑，然后就会把 `watcher` 按照 `id `的大小顺序添加到队列中，因此 `queue` 的长度发送了变化。

- 状态恢复

这个过程就是执行 `resetSchedulerState` 函数，它的定义在 `src/core/observer/scheduler.js` 中。

```js
const queue: Array<Watcher> = []
let has: { [key: number]: ?true } = {}
let circular: { [key: number]: number } = {}
let waiting = false
let flushing = false
let index = 0
function resetSchedulerState () {
  index = queue.length = activatedChildren.length = 0
  has = {}
  if (process.env.NODE_ENV !== 'production') {
    circular = {}
  }
  waiting = flushing = false
}
```
逻辑非常简单，就是把这些控制流程状态的一些变量恢复到初始值，把 `watcher` 队列清空。

接下来我们继续分析 `watcher.run()` 的逻辑，它的定义在 `src/core/observer/watcher.js` 中。

```js
class Watcher {
  run () {
    if (this.active) {
      const value = this.get()
      if (
        value !== this.value ||
        isObject(value) ||
        this.deep
      ) {
        const oldValue = this.value
        this.value = value
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
    }
  }  
}
```

这段代码的逻辑也很简单，先通过 `this.get()` 得到它当前的值，然后做判断，如果满足新旧值不等、新值是对象类型、`deep` 模式任何一个条件，则执行 `watcher` 的回调，注意回调函数执行的时候会把第一个和第二个参数传入新值 `value` 和旧值 `oldValue`，这就是当我们添加自定义 `watcher` 的时候能在回调函数的参数中拿到新旧值的原因。

那么对于渲染 `watcher` 而言，它的回调函数就是：
```js
updateComponent = () => {
  vm._update(vm._render(), hydrating)
}
```

所以这就是当我们去修改组件相关的响应式数据的时候，会触发组件重新渲染的原因，接着就会重新执行 `patch` 的过程，但它和首次渲染有所不同，之后我们会花一小节去详细介绍。

## 总结

通过这一节的分析，我们对 Vue 数据修改派发更新的过程也有了认识，实际上就是当数据发生变化的时候，触发 setter 逻辑，把在依赖过程中订阅的的所有观察者，也就是 `watcher`，都触发它们的 `update` 过程，这个过程又利用了队列做了进一步优化，在 `nextTick` 后执行所有 `watcher` 的 `run`，最后执行它们的回调函数。`nextTick` 是 Vue 一个比较核心的实现了，下一节我们来重点分析它的实现。