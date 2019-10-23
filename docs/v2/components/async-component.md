# 异步组件

在我们平时的开发工作中，为了减少首屏代码体积，往往会把一些非首屏的组件设计成异步组件，按需加载。Vue 也原生支持了异步组件的能力，如下：

```js
Vue.component('async-example', function (resolve, reject) {
   // 这个特殊的 require 语法告诉 webpack
   // 自动将编译后的代码分割成不同的块，
   // 这些块将通过 Ajax 请求自动下载。
   require(['./my-async-component'], resolve)
})
```

示例中可以看到，Vue 注册的组件不再是一个对象，而是一个工厂函数，函数有两个参数 `resolve` 和 `reject`，函数内部用 `setTimout` 模拟了异步，实际使用可能是通过动态请求异步组件的 JS 地址，最终通过执行 `resolve` 方法，它的参数就是我们的异步组件对象。

在了解了异步组件如何注册后，我们从源码的角度来分析一下它的实现。

上一节我们分析了组件的注册逻辑，由于组件的定义并不是一个普通对象，所以不会执行 `Vue.extend` 的逻辑把它变成一个组件的构造函数，但是它仍然可以执行到 `createComponent` 函数，我们再来对这个函数做回顾，它的定义在 `src/core/vdom/create-component/js` 中：

```js
export function createComponent (
  Ctor: Class<Component> | Function | Object | void,
  data: ?VNodeData,
  context: Component,
  children: ?Array<VNode>,
  tag?: string
): VNode | Array<VNode> | void {
  if (isUndef(Ctor)) {
    return
  }

  const baseCtor = context.$options._base

  // plain options object: turn it into a constructor
  if (isObject(Ctor)) {
    Ctor = baseCtor.extend(Ctor)
  }
  
  // ...

  // async component
  let asyncFactory
  if (isUndef(Ctor.cid)) {
    asyncFactory = Ctor
    Ctor = resolveAsyncComponent(asyncFactory, baseCtor, context)
    if (Ctor === undefined) {
      // return a placeholder node for async component, which is rendered
      // as a comment node but preserves all the raw information for the node.
      // the information will be used for async server-rendering and hydration.
      return createAsyncPlaceholder(
        asyncFactory,
        data,
        context,
        children,
        tag
      )
    }
  }
}
```

我们省略了不必要的逻辑，只保留关键逻辑，由于我们这个时候传入的 `Ctor` 是一个函数，那么它也并不会执行 `Vue.extend` 逻辑，因此它的 `cid` 是 `undefiend`，进入了异步组件创建的逻辑。这里首先执行了 `Ctor = resolveAsyncComponent(asyncFactory, baseCtor, context)` 方法，它的定义在 `src/core/vdom/helpers/resolve-async-component.js` 中：

```js
export function resolveAsyncComponent (
  factory: Function,
  baseCtor: Class<Component>,
  context: Component
): Class<Component> | void {
  if (isTrue(factory.error) && isDef(factory.errorComp)) {
    return factory.errorComp
  }

  if (isDef(factory.resolved)) {
    return factory.resolved
  }

  if (isTrue(factory.loading) && isDef(factory.loadingComp)) {
    return factory.loadingComp
  }

  if (isDef(factory.contexts)) {
    // already pending
    factory.contexts.push(context)
  } else {
    const contexts = factory.contexts = [context]
    let sync = true

    const forceRender = () => {
      for (let i = 0, l = contexts.length; i < l; i++) {
        contexts[i].$forceUpdate()
      }
    }

    const resolve = once((res: Object | Class<Component>) => {
      // cache resolved
      factory.resolved = ensureCtor(res, baseCtor)
      // invoke callbacks only if this is not a synchronous resolve
      // (async resolves are shimmed as synchronous during SSR)
      if (!sync) {
        forceRender()
      }
    })

    const reject = once(reason => {
      process.env.NODE_ENV !== 'production' && warn(
        `Failed to resolve async component: ${String(factory)}` +
        (reason ? `\nReason: ${reason}` : '')
      )
      if (isDef(factory.errorComp)) {
        factory.error = true
        forceRender()
      }
    })

    const res = factory(resolve, reject)

    if (isObject(res)) {
      if (typeof res.then === 'function') {
        // () => Promise
        if (isUndef(factory.resolved)) {
          res.then(resolve, reject)
        }
      } else if (isDef(res.component) && typeof res.component.then === 'function') {
        res.component.then(resolve, reject)

        if (isDef(res.error)) {
          factory.errorComp = ensureCtor(res.error, baseCtor)
        }

        if (isDef(res.loading)) {
          factory.loadingComp = ensureCtor(res.loading, baseCtor)
          if (res.delay === 0) {
            factory.loading = true
          } else {
            setTimeout(() => {
              if (isUndef(factory.resolved) && isUndef(factory.error)) {
                factory.loading = true
                forceRender()
              }
            }, res.delay || 200)
          }
        }

        if (isDef(res.timeout)) {
          setTimeout(() => {
            if (isUndef(factory.resolved)) {
              reject(
                process.env.NODE_ENV !== 'production'
                  ? `timeout (${res.timeout}ms)`
                  : null
              )
            }
          }, res.timeout)
        }
      }
    }

    sync = false
    // return in case resolved synchronously
    return factory.loading
      ? factory.loadingComp
      : factory.resolved
  }
}
```

`resolveAsyncComponent` 函数的逻辑略复杂，因为它实际上处理了 3 种异步组件的创建方式，除了刚才示例的组件注册方式，还支持 2 种，一种是支持 `Promise` 创建组件的方式，如下：

```js
Vue.component(
  'async-webpack-example',
  // 该 `import` 函数返回一个 `Promise` 对象。
  () => import('./my-async-component')
)
```

另一种是高级异步组件，如下：

```js
const AsyncComp = () => ({
  // 需要加载的组件。应当是一个 Promise
  component: import('./MyComp.vue'),
  // 加载中应当渲染的组件
  loading: LoadingComp,
  // 出错时渲染的组件
  error: ErrorComp,
  // 渲染加载中组件前的等待时间。默认：200ms。
  delay: 200,
  // 最长等待时间。超出此时间则渲染错误组件。默认：Infinity
  timeout: 3000
})
Vue.component('async-example', AsyncComp)
```

那么解下来，我们就根据这 3 种异步组件的情况，来分别去分析 `resolveAsyncComponent` 的逻辑。

## 普通函数异步组件

针对普通函数的情况，前面几个 if 判断可以忽略，它们是为高级组件所用，对于 `factory.contexts` 的判断，是考虑到多个地方同时初始化一个异步组件，那么它的实际加载应该只有一次。接着进入实际加载逻辑，定义了 `forceRender`、`resolve` 和 `reject` 函数，注意 `resolve` 和 `reject` 函数用 `once` 函数做了一层包装，它的定义在 `src/shared/util.js` 中：

````js
/**
 * Ensure a function is called only once.
 */
export function once (fn: Function): Function {
  let called = false
  return function () {
    if (!called) {
      called = true
      fn.apply(this, arguments)
    }
  }
}
````
`once` 逻辑非常简单，传入一个函数，并返回一个新函数，它非常巧妙地利用闭包和一个标志位保证了它包装的函数只会执行一次，也就是确保 `resolve` 和 `reject` 函数只执行一次。

接下来执行 `const res = factory(resolve, reject)` 逻辑，这块儿就是执行我们组件的工厂函数，同时把 `resolve` 和 `reject` 函数作为参数传入，组件的工厂函数通常会先发送请求去加载我们的异步组件的 JS 文件，拿到组件定义的对象 `res` 后，执行 `resolve(res)` 逻辑，它会先执行 `factory.resolved = ensureCtor(res, baseCtor)`：

```js
function ensureCtor (comp: any, base) {
  if (
    comp.__esModule ||
    (hasSymbol && comp[Symbol.toStringTag] === 'Module')
  ) {
    comp = comp.default
  }
  return isObject(comp)
    ? base.extend(comp)
    : comp
}
```
这个函数目的是为了保证能找到异步组件 JS 定义的组件对象，并且如果它是一个普通对象，则调用 `Vue.extend` 把它转换成一个组件的构造函数。

`resolve` 逻辑最后判断了 `sync`，显然我们这个场景下 `sync` 为 false，那么就会执行 `forceRender` 函数，它会遍历 `factory.contexts`，拿到每一个调用异步组件的实例 `vm`, 执行 `vm.$forceUpdate()` 方法，它的定义在 `src/core/instance/lifecycle.js` 中：
 
```js
Vue.prototype.$forceUpdate = function () {
  const vm: Component = this
  if (vm._watcher) {
    vm._watcher.update()
  }
}
```

`$forceUpdate` 的逻辑非常简单，就是调用渲染 `watcher` 的 `update` 方法，让渲染 `watcher` 对应的回调函数执行，也就是触发了组件的重新渲染。之所以这么做是因为 Vue 通常是数据驱动视图重新渲染，但是在整个异步组件加载过程中是没有数据发生变化的，所以通过执行 `$forceUpdate` 可以强制组件重新渲染一次。

## `Promise` 异步组件

```js
Vue.component(
  'async-webpack-example',
  // 该 `import` 函数返回一个 `Promise` 对象。
  () => import('./my-async-component')
)
```
webpack 2+ 支持了异步加载的语法糖：`() => import('./my-async-component')`，当执行完 `res = factory(resolve, reject)`，返回的值就是 ` import('./my-async-component')` 的返回值，它是一个 `Promise` 对象。接着进入 if 条件，又判断了 `typeof res.then === 'function')`，条件满足，执行：

```js
if (isUndef(factory.resolved)) {
  res.then(resolve, reject)
}
```
当组件异步加载成功后，执行 `resolve`，加载失败则执行 `reject`，这样就非常巧妙地实现了配合 webpack 2+ 的异步加载组件的方式（`Promise`）加载异步组件。

## 高级异步组件

由于异步加载组件需要动态加载 JS，有一定网络延时，而且有加载失败的情况，所以通常我们在开发异步组件相关逻辑的时候需要设计 loading 组件和 error 组件，并在适当的时机渲染它们。Vue.js 2.3+ 支持了一种高级异步组件的方式，它通过一个简单的对象配置，帮你搞定 loading 组件和 error 组件的渲染时机，你完全不用关心细节，非常方便。接下来我们就从源码的角度来分析高级异步组件是怎么实现的。

```js
const AsyncComp = () => ({
  // 需要加载的组件。应当是一个 Promise
  component: import('./MyComp.vue'),
  // 加载中应当渲染的组件
  loading: LoadingComp,
  // 出错时渲染的组件
  error: ErrorComp,
  // 渲染加载中组件前的等待时间。默认：200ms。
  delay: 200,
  // 最长等待时间。超出此时间则渲染错误组件。默认：Infinity
  timeout: 3000
})
Vue.component('async-example', AsyncComp)
```
高级异步组件的初始化逻辑和普通异步组件一样，也是执行 `resolveAsyncComponent`，当执行完 `res = factory(resolve, reject)`，返回值就是定义的组件对象，显然满足 `else if (isDef(res.component) && typeof res.component.then === 'function')` 的逻辑，接着执行 `res.component.then(resolve, reject)`，当异步组件加载成功后，执行 `resolve`，失败执行 `reject`。

因为异步组件加载是一个异步过程，它接着又同步执行了如下逻辑：

```js
if (isDef(res.error)) {
  factory.errorComp = ensureCtor(res.error, baseCtor)
}

if (isDef(res.loading)) {
  factory.loadingComp = ensureCtor(res.loading, baseCtor)
  if (res.delay === 0) {
    factory.loading = true
  } else {
    setTimeout(() => {
      if (isUndef(factory.resolved) && isUndef(factory.error)) {
        factory.loading = true
        forceRender()
      }
    }, res.delay || 200)
  }
}

if (isDef(res.timeout)) {
  setTimeout(() => {
    if (isUndef(factory.resolved)) {
      reject(
        process.env.NODE_ENV !== 'production'
          ? `timeout (${res.timeout}ms)`
          : null
      )
    }
  }, res.timeout)
}
```
先判断 `res.error` 是否定义了 error 组件，如果有的话则赋值给 `factory.errorComp`。
接着判断 `res.loading` 是否定义了 loading 组件，如果有的话则赋值给 `factory.loadingComp`，如果设置了 `res.delay` 且为 0，则设置 `factory.loading = true`，否则延时 `delay` 的时间执行：

```js
if (isUndef(factory.resolved) && isUndef(factory.error)) {
    factory.loading = true
    forceRender()
}
```

最后判断 `res.timeout`，如果配置了该项，则在 `res.timout` 时间后，如果组件没有成功加载，执行 `reject`。

在 `resolveAsyncComponent` 的最后有一段逻辑：

```js
sync = false
return factory.loading
  ? factory.loadingComp
  : factory.resolved
```

如果 `delay` 配置为 0，则这次直接渲染 loading 组件，否则则延时 `delay` 执行 `forceRender`，那么又会再一次执行到 `resolveAsyncComponent`。

那么这时候我们有几种情况，按逻辑的执行顺序，对不同的情况做判断。

### 异步组件加载失败
当异步组件加载失败，会执行 `reject` 函数：

```js
const reject = once(reason => {
  process.env.NODE_ENV !== 'production' && warn(
    `Failed to resolve async component: ${String(factory)}` +
    (reason ? `\nReason: ${reason}` : '')
  )
  if (isDef(factory.errorComp)) {
    factory.error = true
    forceRender()
  }
})
```
这个时候会把 `factory.error` 设置为 `true`，同时执行 `forceRender()` 再次执行到 `resolveAsyncComponent`：

```js
if (isTrue(factory.error) && isDef(factory.errorComp)) {
  return factory.errorComp
}
```

那么这个时候就返回 `factory.errorComp`，直接渲染 error 组件。
  
### 异步组件加载成功

当异步组件加载成功，会执行 `resolve` 函数：

```js
const resolve = once((res: Object | Class<Component>) => {
  factory.resolved = ensureCtor(res, baseCtor)
  if (!sync) {
    forceRender()
  }
})
```
首先把加载结果缓存到 `factory.resolved` 中，这个时候因为 `sync` 已经为 false，则执行 `forceRender()` 再次执行到 `resolveAsyncComponent`：

```js
if (isDef(factory.resolved)) {
  return factory.resolved
}
```
那么这个时候直接返回 `factory.resolved`，渲染成功加载的组件。

### 异步组件加载中

如果异步组件加载中并未返回，这时候会走到这个逻辑：

```js
if (isTrue(factory.loading) && isDef(factory.loadingComp)) {
  return factory.loadingComp
}
```

那么则会返回 `factory.loadingComp`，渲染 loading 组件。

### 异步组件加载超时

如果超时，则走到了 `reject` 逻辑，之后逻辑和加载失败一样，渲染 error 组件。

## 异步组件 patch

回到 `createComponent` 的逻辑：

```js
Ctor = resolveAsyncComponent(asyncFactory, baseCtor, context)
if (Ctor === undefined) {
  return createAsyncPlaceholder(
    asyncFactory,
    data,
    context,
    children,
    tag
  )
}
```

如果是第一次执行 `resolveAsyncComponent`，除非使用高级异步组件 `0 delay` 去创建了一个 loading 组件，否则返回是 `undefiend`，接着通过 `createAsyncPlaceholder` 创建一个注释节点作为占位符。它的定义在 `src/core/vdom/helpers/resolve-async-components.js` 中：

```js
export function createAsyncPlaceholder (
  factory: Function,
  data: ?VNodeData,
  context: Component,
  children: ?Array<VNode>,
  tag: ?string
): VNode {
  const node = createEmptyVNode()
  node.asyncFactory = factory
  node.asyncMeta = { data, context, children, tag }
  return node
}
```

实际上就是就是创建了一个占位的注释 VNode，同时把 `asyncFactory` 和 `asyncMeta` 赋值给当前 `vnode`。

当执行 `forceRender` 的时候，会触发组件的重新渲染，那么会再一次执行 `resolveAsyncComponent`，这时候就会根据不同的情况，可能返回 loading、error 或成功加载的异步组件，返回值不为 `undefined`，因此就走正常的组件 `render`、`patch` 过程，与组件第一次渲染流程不一样，这个时候是存在新旧 `vnode` 的，下一章我会分析组件更新的 `patch` 过程。


## 总结

通过以上代码分析，我们对 Vue 的异步组件的实现有了深入的了解，知道了 3 种异步组件的实现方式，并且看到高级异步组件的实现是非常巧妙的，它实现了 loading、resolve、reject、timeout 4 种状态。异步组件实现的本质是 2 次渲染，除了 0 delay 的高级异步组件第一次直接渲染成 loading 组件外，其它都是第一次渲染生成一个注释节点，当异步获取组件成功后，再通过 `forceRender` 强制重新渲染，这样就能正确渲染出我们异步加载的组件了。