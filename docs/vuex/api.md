# API

上一节我们对 Vuex 的初始化过程有了深入的分析，在我们构造好这个 `store` 后，需要提供一些 API 对这个 `store` 做存取的操作，那么这一节我们就从源码的角度对这些 API 做分析。
 
## 数据获取

Vuex 最终存储的数据是在 `state` 上的，我们之前分析过在 `store.state` 存储的是 `root state`，那么对于模块上的 `state`，假设我们有 2 个嵌套的 `modules`，它们的 `key` 分别为 `a` 和 `b`，我们可以通过 `store.state.a.b.xxx` 的方式去获取。它的实现是在发生在 `installModule` 的时候：

```js
function installModule (store, rootState, path, module, hot) {
  const isRoot = !path.length
  
  // ...
  // set state
  if (!isRoot && !hot) {
    const parentState = getNestedState(rootState, path.slice(0, -1))
    const moduleName = path[path.length - 1]
    store._withCommit(() => {
      Vue.set(parentState, moduleName, module.state)
    })
  }
  // ...
}
```

在递归执行 `installModule` 的过程中，就完成了整个 `state` 的建设，这样我们就可以通过 `module` 名的 `path` 去访问到一个深层 `module` 的 `state`。

有些时候，我们获取的数据不仅仅是一个 `state`，而是由多个 `state` 计算而来，Vuex 提供了 `getters`，允许我们定义一个 `getter` 函数，如下：

````js
getters: {
  total (state, getters, localState, localGetters) {
    // 可访问全局 state 和 getters，以及如果是在 modules 下面，可以访问到局部 state 和 局部 getters
    return state.a + state.b
  }
}
````

我们在 `installModule` 的过程中，递归执行了所有 `getters` 定义的注册，在之后的 `resetStoreVM` 过程中，执行了 `store.getters` 的初始化工作：

```js
function installModule (store, rootState, path, module, hot) {
  // ...
  const namespace = store._modules.getNamespace(path)
  // ...
  const local = module.context = makeLocalContext(store, namespace, path)

  // ...

  module.forEachGetter((getter, key) => {
    const namespacedType = namespace + key
    registerGetter(store, namespacedType, getter, local)
  })

  // ...
}

function registerGetter (store, type, rawGetter, local) {
  if (store._wrappedGetters[type]) {
    if (process.env.NODE_ENV !== 'production') {
      console.error(`[vuex] duplicate getter key: ${type}`)
    }
    return
  }
  store._wrappedGetters[type] = function wrappedGetter (store) {
    return rawGetter(
      local.state, // local state
      local.getters, // local getters
      store.state, // root state
      store.getters // root getters
    )
  }
}


function resetStoreVM (store, state, hot) {
  // ...
  // bind store public getters
  store.getters = {}
  const wrappedGetters = store._wrappedGetters
  const computed = {}
  forEachValue(wrappedGetters, (fn, key) => {
    // use computed to leverage its lazy-caching mechanism
    computed[key] = () => fn(store)
    Object.defineProperty(store.getters, key, {
      get: () => store._vm[key],
      enumerable: true // for local getters
    })
  })

  // use a Vue instance to store the state tree
  // suppress warnings just in case the user has added
  // some funky global mixins
  // ...
  store._vm = new Vue({
    data: {
      $$state: state
    },
    computed
  })
  // ...
}
```

在 `installModule` 的过程中，为建立了每个模块的上下文环境，
因此当我们访问 `store.getters.xxx` 的时候，实际上就是执行了 `rawGetter(local.state,...)`，`rawGetter` 就是我们定义的 `getter` 方法，这也就是为什么我们的 `getter` 函数支持这四个参数，并且除了全局的 `state` 和 `getter` 外，我们还可以访问到当前 `module` 下的 `state` 和 `getter`。

## 数据存储

Vuex 对数据存储的存储本质上就是对 `state` 做修改，并且只允许我们通过提交 `mutaion` 的形式去修改 `state`，`mutation` 是一个函数，如下：
    
```js
mutations: {
  increment (state) {
    state.count++
  }
}
```

`mutations` 的初始化也是在 `installModule` 的时候：

```js
function installModule (store, rootState, path, module, hot) {
  // ...
  const namespace = store._modules.getNamespace(path)

  // ...
  const local = module.context = makeLocalContext(store, namespace, path)

  module.forEachMutation((mutation, key) => {
    const namespacedType = namespace + key
    registerMutation(store, namespacedType, mutation, local)
  })
  // ...
}

function registerMutation (store, type, handler, local) {
  const entry = store._mutations[type] || (store._mutations[type] = [])
  entry.push(function wrappedMutationHandler (payload) {
    handler.call(store, local.state, payload)
  })
}
```

`store` 提供了`commit` 方法让我们提交一个 `mutation`：

```js
commit (_type, _payload, _options) {
  // check object-style commit
  const {
    type,
    payload,
    options
  } = unifyObjectStyle(_type, _payload, _options)

  const mutation = { type, payload }
  const entry = this._mutations[type]
  if (!entry) {
    if (process.env.NODE_ENV !== 'production') {
      console.error(`[vuex] unknown mutation type: ${type}`)
    }
    return
  }
  this._withCommit(() => {
    entry.forEach(function commitIterator (handler) {
      handler(payload)
    })
  })
  this._subscribers.forEach(sub => sub(mutation, this.state))

  if (
    process.env.NODE_ENV !== 'production' &&
    options && options.silent
  ) {
    console.warn(
      `[vuex] mutation type: ${type}. Silent option has been removed. ` +
      'Use the filter functionality in the vue-devtools'
    )
  }
}
```

这里传入的 `_type` 就是 `mutation` 的 `type`，我们可以从 `store._mutations` 找到对应的函数数组，遍历它们执行获取到每个 `handler` 然后执行，实际上就是执行了 `wrappedMutationHandler(playload)`，接着会执行我们定义的 `mutation` 函数，并传入当前模块的 `state`，所以我们的 `mutation` 函数也就是对当前模块的 `state` 做修改。

需要注意的是， `mutation` 必须是同步函数，但是我们在开发实际项目中，经常会遇到要先去发送一个请求，然后根据请求的结果去修改 `state`，那么单纯只通过 `mutation` 是无法完成需求，因此 Vuex 又给我们设计了一个 `action` 的概念。

`action` 类似于 `mutation`，不同在于 `action` 提交的是 `mutation`，而不是直接操作 `state`，并且它可以包含任意异步操作。例如：

```js
mutations: {
  increment (state) {
    state.count++
  }
},
actions: {
  increment (context) {
    setTimeout(() => {
      context.commit('increment')
    }, 0)
  }
}
```

`actions` 的初始化也是在 `installModule` 的时候：

```js
function installModule (store, rootState, path, module, hot) {
  // ...
  const namespace = store._modules.getNamespace(path)

  // ...
  const local = module.context = makeLocalContext(store, namespace, path)

  module.forEachAction((action, key) => {
    const type = action.root ? key : namespace + key
    const handler = action.handler || action
    registerAction(store, type, handler, local)
}  )
  // ...
}

function registerAction (store, type, handler, local) {
  const entry = store._actions[type] || (store._actions[type] = [])
  entry.push(function wrappedActionHandler (payload, cb) {
    let res = handler.call(store, {
      dispatch: local.dispatch,
      commit: local.commit,
      getters: local.getters,
      state: local.state,
      rootGetters: store.getters,
      rootState: store.state
    }, payload, cb)
    if (!isPromise(res)) {
      res = Promise.resolve(res)
    }
    if (store._devtoolHook) {
      return res.catch(err => {
        store._devtoolHook.emit('vuex:error', err)
        throw err
      })
    } else {
      return res
    }
  })
}
```

`store` 提供了`dispatch` 方法让我们提交一个 `action`：

```js
dispatch (_type, _payload) {
  // check object-style dispatch
  const {
    type,
    payload
  } = unifyObjectStyle(_type, _payload)

  const action = { type, payload }
  const entry = this._actions[type]
  if (!entry) {
    if (process.env.NODE_ENV !== 'production') {
      console.error(`[vuex] unknown action type: ${type}`)
    }
    return
  }

  this._actionSubscribers.forEach(sub => sub(action, this.state))

  return entry.length > 1
    ? Promise.all(entry.map(handler => handler(payload)))
    : entry[0](payload)
}
```

这里传入的 `_type` 就是 `action` 的 `type`，我们可以从 `store._actions` 找到对应的函数数组，遍历它们执行获取到每个 `handler` 然后执行，实际上就是执行了 `wrappedActionHandler(payload)`，接着会执行我们定义的 `action` 函数，并传入一个对象，包含了当前模块下的 `dispatch`、`commit`、`getters`、`state`，以及全局的 `rootState` 和 `rootGetters`，所以我们定义的 `action` 函数能拿到当前模块下的 `commit` 方法。

因此 `action` 比我们自己写一个函数执行异步操作然后提交 `muataion` 的好处是在于它可以在参数中获取到当前模块的一些方法和状态，Vuex 帮我们做好了这些。


## 语法糖

我们知道 `store` 是 `Store` 对象的一个实例，它是一个原生的 Javascript 对象，我们可以在任意地方使用它们。但大部分的使用场景还是在组件中使用，那么我们之前介绍过，在 Vuex 安装阶段，它会往每一个组件实例上混入 `beforeCreate` 钩子函数，然后往组件实例上添加一个 `$store` 的实例，它指向的就是我们实例化的 `store`，因此我们可以在组件中访问到 `store` 的任何属性和方法。

比如我们在组件中访问 `state`：

```js
const Counter = {
  template: `<div>{{ count }}</div>`,
  computed: {
    count () {
      return this.$store.state.count
    }
  }
}
```

但是当一个组件需要获取多个状态时候，将这些状态都声明为计算属性会有些重复和冗余。同样这些问题也在存于 `getter`、`mutation` 和 `action`。

为了解决这个问题，Vuex 提供了一系列 `mapXXX` 辅助函数帮助我们实现在组件中可以很方便的注入 `store` 的属性和方法。

### `mapState`

我们先来看一下 `mapState` 的用法：

```js
// 在单独构建的版本中辅助函数为 Vuex.mapState
import { mapState } from 'vuex'

export default {
  // ...
  computed: mapState({
    // 箭头函数可使代码更简练
    count: state => state.count,

    // 传字符串参数 'count' 等同于 `state => state.count`
    countAlias: 'count',

    // 为了能够使用 `this` 获取局部状态，必须使用常规函数
    countPlusLocalState (state) {
      return state.count + this.localCount
    }
  })
}
```

再来看一下 `mapState` 方法的定义，在 `src/helpers.js` 中：

```js
export const mapState = normalizeNamespace((namespace, states) => {
  const res = {}
  normalizeMap(states).forEach(({ key, val }) => {
    res[key] = function mappedState () {
      let state = this.$store.state
      let getters = this.$store.getters
      if (namespace) {
        const module = getModuleByNamespace(this.$store, 'mapState', namespace)
        if (!module) {
          return
        }
        state = module.context.state
        getters = module.context.getters
      }
      return typeof val === 'function'
        ? val.call(this, state, getters)
        : state[val]
    }
    // mark vuex getter for devtools
    res[key].vuex = true
  })
  return res
})

function normalizeNamespace (fn) {
  return (namespace, map) => {
    if (typeof namespace !== 'string') {
      map = namespace
      namespace = ''
    } else if (namespace.charAt(namespace.length - 1) !== '/') {
      namespace += '/'
    }
    return fn(namespace, map)
  }
}

function normalizeMap (map) {
  return Array.isArray(map)
    ? map.map(key => ({ key, val: key }))
    : Object.keys(map).map(key => ({ key, val: map[key] }))
}
```

首先 `mapState` 是通过执行 `normalizeNamespace` 返回的函数，它接收 2 个参数，其中 `namespace` 表示命名空间，`map` 表示具体的对象，`namespace` 可不传，稍后我们来介绍 `namespace` 的作用。

当执行 `mapState(map)` 函数的时候，实际上就是执行 `normalizeNamespace` 包裹的函数，然后把 `map` 作为参数 `states` 传入。

`mapState` 最终是要构造一个对象，每个对象的元素都是一个方法，因为这个对象是要扩展到组件的 `computed` 计算属性中的。函数首先执行 `normalizeMap` 方法，把这个 `states` 变成一个数组，数组的每个元素都是 `{key, val}` 的形式。接着再遍历这个数组，以 `key` 作为对象的 `key`，值为一个 `mappedState` 的函数，在这个函数的内部，获取到 `$store.getters` 和 `$store.state`，然后再判断数组的 `val` 如果是一个函数，执行该函数，传入 `state` 和 `getters`，否则直接访问 `state[val]`。

比起一个个手动声明计算属性，`mapState` 确实要方便许多，下面我们来看一下 `namespace` 的作用。

当我们想访问一个子模块的 `state` 的时候，我们可能需要这样访问：

```js
computed: {
  mapState({
    a: state => state.some.nested.module.a,
    b: state => state.some.nested.module.b
  })
},
```

这样从写法上就很不友好，`mapState` 支持传入 `namespace`， 因此我们可以这么写：

```js
computed: {
  mapState('some/nested/module', {
    a: state => state.a,
    b: state => state.b
  })
},
```

这样看起来就清爽许多。在 `mapState` 的实现中，如果有 `namespace`，则尝试去通过 `getModuleByNamespace(this.$store, 'mapState', namespace)` 对应的 `module`，然后把 `state` 和 `getters` 修改为 `module` 对应的 `state` 和 `getters`。

```js
function getModuleByNamespace (store, helper, namespace) {
  const module = store._modulesNamespaceMap[namespace]
  if (process.env.NODE_ENV !== 'production' && !module) {
    console.error(`[vuex] module namespace not found in ${helper}(): ${namespace}`)
  }
  return module
}
```

我们在 Vuex 初始化执行 `installModule` 的过程中，初始化了这个映射表：

```js
function installModule (store, rootState, path, module, hot) {
  // ...
  const namespace = store._modules.getNamespace(path)

  // register in namespace map
  if (module.namespaced) {
    store._modulesNamespaceMap[namespace] = module
  }

  // ...
}
```

### `mapGetters`

我们先来看一下 `mapGetters` 的用法：

```js
import { mapGetters } from 'vuex'

export default {
  // ...
  computed: {
    // 使用对象展开运算符将 getter 混入 computed 对象中
    mapGetters([
      'doneTodosCount',
      'anotherGetter',
      // ...
    ])
  }
}
```

和 `mapState` 类似，`mapGetters` 是将 `store` 中的 `getter` 映射到局部计算属性，来看一下它的定义：

```js
export const mapGetters = normalizeNamespace((namespace, getters) => {
  const res = {}
  normalizeMap(getters).forEach(({ key, val }) => {
    // thie namespace has been mutate by normalizeNamespace
    val = namespace + val
    res[key] = function mappedGetter () {
      if (namespace && !getModuleByNamespace(this.$store, 'mapGetters', namespace)) {
        return
      }
      if (process.env.NODE_ENV !== 'production' && !(val in this.$store.getters)) {
        console.error(`[vuex] unknown getter: ${val}`)
        return
      }
      return this.$store.getters[val]
    }
    // mark vuex getter for devtools
    res[key].vuex = true
  })
  return res
})
```

`mapGetters` 也同样支持 `namespace`，如果不写 `namespace` ，访问一个子 `module` 的属性需要写很长的 `key`，一旦我们使用了 `namespace`，就可以方便我们的书写，每个 `mappedGetter` 的实现实际上就是取 `this.$store.getters[val]`。

### `mapMutations`

我们可以在组件中使用 `this.$store.commit('xxx')` 提交 `mutation`，或者使用 `mapMutations` 辅助函数将组件中的 `methods` 映射为 `store.commit` 的调用。

我们先来看一下 `mapMutations` 的用法：

```js
import { mapMutations } from 'vuex'

export default {
  // ...
  methods: {
    ...mapMutations([
      'increment', // 将 `this.increment()` 映射为 `this.$store.commit('increment')`

      // `mapMutations` 也支持载荷：
      'incrementBy' // 将 `this.incrementBy(amount)` 映射为 `this.$store.commit('incrementBy', amount)`
    ]),
    ...mapMutations({
      add: 'increment' // 将 `this.add()` 映射为 `this.$store.commit('increment')`
    })
  }
}
```

`mapMutations` 支持传入一个数组或者一个对象，目标都是组件中对应的 `methods` 映射为 `store.commit` 的调用。来看一下它的定义：

```js
export const mapMutations = normalizeNamespace((namespace, mutations) => {
  const res = {}
  normalizeMap(mutations).forEach(({ key, val }) => {
    res[key] = function mappedMutation (...args) {
      // Get the commit method from store
      let commit = this.$store.commit
      if (namespace) {
        const module = getModuleByNamespace(this.$store, 'mapMutations', namespace)
        if (!module) {
          return
        }
        commit = module.context.commit
      }
      return typeof val === 'function'
        ? val.apply(this, [commit].concat(args))
        : commit.apply(this.$store, [val].concat(args))
    }
  })
  return res
})
```

可以看到 `mappedMutation` 同样支持了 `namespace`，并且支持了传入额外的参数 `args`，作为提交 `mutation` 的 `payload`，最终就是执行了 `store.commit` 方法，并且这个 `commit` 会根据传入的 `namespace` 映射到对应 `module` 的 `commit` 上。

### `mapActions`

我们可以在组件中使用 `this.$store.dispatch('xxx')` 提交 `action`，或者使用 `mapActions` 辅助函数将组件中的 `methods` 映射为 `store.dispatch` 的调用。

`mapActions` 在用法上和 `mapMutations` 几乎一样，实现也很类似：

```js
export const mapActions = normalizeNamespace((namespace, actions) => {
  const res = {}
  normalizeMap(actions).forEach(({ key, val }) => {
    res[key] = function mappedAction (...args) {
      // get dispatch function from store
      let dispatch = this.$store.dispatch
      if (namespace) {
        const module = getModuleByNamespace(this.$store, 'mapActions', namespace)
        if (!module) {
          return
        }
        dispatch = module.context.dispatch
      }
      return typeof val === 'function'
        ? val.apply(this, [dispatch].concat(args))
        : dispatch.apply(this.$store, [val].concat(args))
    }
  })
  return res
})
```

和 `mapMutations` 的实现几乎一样，不同的是把 `commit` 方法换成了 `dispatch`。

## 动态更新模块

在 Vuex 初始化阶段我们构造了模块树，初始化了模块上各个部分。在有一些场景下，我们需要动态去注入一些新的模块，Vuex 提供了模块动态注册功能，在 `store` 上提供了一个 `registerModule` 的 API。

```js
registerModule (path, rawModule, options = {}) {
  if (typeof path === 'string') path = [path]

  if (process.env.NODE_ENV !== 'production') {
    assert(Array.isArray(path), `module path must be a string or an Array.`)
    assert(path.length > 0, 'cannot register the root module by using registerModule.')
  }

  this._modules.register(path, rawModule)
  installModule(this, this.state, path, this._modules.get(path), options.preserveState)
  // reset store to update getters...
  resetStoreVM(this, this.state)
}
```

`registerModule` 支持传入一个 `path` 模块路径 和 `rawModule` 模块定义，首先执行 `register` 方法扩展我们的模块树，接着执行 `installModule` 去安装模块，最后执行 `resetStoreVM` 重新实例化 `store._vm`，并销毁旧的 `store._vm`。

相对的，有动态注册模块的需求就有动态卸载模块的需求，Vuex 提供了模块动态卸载功能，在 `store` 上提供了一个 `unregisterModule` 的 API。

```js
unregisterModule (path) {
  if (typeof path === 'string') path = [path]

  if (process.env.NODE_ENV !== 'production') {
    assert(Array.isArray(path), `module path must be a string or an Array.`)
  }

  this._modules.unregister(path)
  this._withCommit(() => {
    const parentState = getNestedState(this.state, path.slice(0, -1))
    Vue.delete(parentState, path[path.length - 1])
  })
  resetStore(this)
}
```

`unregisterModule` 支持传入一个 `path` 模块路径，首先执行 `unregister` 方法去修剪我们的模块树：

```js
unregister (path) {
  const parent = this.get(path.slice(0, -1))
  const key = path[path.length - 1]
  if (!parent.getChild(key).runtime) return

  parent.removeChild(key)
}
```
注意，这里只会移除我们运行时动态创建的模块。

接着会删除 `state` 在该路径下的引用，最后执行 `resetStore` 方法：

```js
function resetStore (store, hot) {
  store._actions = Object.create(null)
  store._mutations = Object.create(null)
  store._wrappedGetters = Object.create(null)
  store._modulesNamespaceMap = Object.create(null)
  const state = store.state
  // init all modules
  installModule(store, state, [], store._modules.root, true)
  // reset vm
  resetStoreVM(store, state, hot)
}
```

该方法就是把 `store` 下的对应存储的 `_actions`、`_mutations`、`_wrappedGetters` 和 `_modulesNamespaceMap` 都清空，然后重新执行 `installModule` 安装所有模块以及 `resetStoreVM` 重置 `store._vm`。

## 总结

那么至此，Vuex 提供的一些常用 API 我们就分析完了，包括数据的存取、语法糖、模块的动态更新等。要理解 Vuex 提供这些 API 都是方便我们在对 `store` 做各种操作来完成各种能力，尤其是 `mapXXX` 的设计，让我们在使用 API 的时候更加方便，这也是我们今后在设计一些 JavaScript 库的时候，从 API 设计角度中应该学习的方向。
