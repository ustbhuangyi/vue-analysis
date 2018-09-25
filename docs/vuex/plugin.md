# 插件

Vuex 除了提供的存取能力，还提供了一种插件能力，让我们可以监控 `store` 的变化过程来做一些事情。

Vuex 的 `store` 接受 `plugins` 选项，我们在实例化 `Store` 的时候可以传入插件，它是一个数组，然后在执行 `Store` 构造函数的时候，会执行这些插件：

```js
const {
  plugins = [],
  strict = false
} = options
// apply plugins
plugins.forEach(plugin => plugin(this))
```

在我们实际项目中，我们用到的最多的就是 Vuex 内置的 `Logger` 插件，它能够帮我们追踪 `state` 变化，然后输出一些格式化日志。下面我们就来分析这个插件的实现。

## `Logger` 插件

`Logger` 插件的定义在 `src/plugins/logger.js` 中：

```js
export default function createLogger ({
  collapsed = true,
  filter = (mutation, stateBefore, stateAfter) => true,
  transformer = state => state,
  mutationTransformer = mut => mut,
  logger = console
} = {}) {
  return store => {
    let prevState = deepCopy(store.state)

    store.subscribe((mutation, state) => {
      if (typeof logger === 'undefined') {
        return
      }
      const nextState = deepCopy(state)

      if (filter(mutation, prevState, nextState)) {
        const time = new Date()
        const formattedTime = ` @ ${pad(time.getHours(), 2)}:${pad(time.getMinutes(), 2)}:${pad(time.getSeconds(), 2)}.${pad(time.getMilliseconds(), 3)}`
        const formattedMutation = mutationTransformer(mutation)
        const message = `mutation ${mutation.type}${formattedTime}`
        const startMessage = collapsed
          ? logger.groupCollapsed
          : logger.group

        // render
        try {
          startMessage.call(logger, message)
        } catch (e) {
          console.log(message)
        }

        logger.log('%c prev state', 'color: #9E9E9E; font-weight: bold', transformer(prevState))
        logger.log('%c mutation', 'color: #03A9F4; font-weight: bold', formattedMutation)
        logger.log('%c next state', 'color: #4CAF50; font-weight: bold', transformer(nextState))

        try {
          logger.groupEnd()
        } catch (e) {
          logger.log('—— log end ——')
        }
      }

      prevState = nextState
    })
  }
}

function repeat (str, times) {
  return (new Array(times + 1)).join(str)
}

function pad (num, maxLength) {
  return repeat('0', maxLength - num.toString().length) + num
}
```

插件函数接收的参数是 `store` 实例，它执行了 `store.subscribe` 方法，先来看一下 `subscribe` 的定义：

```js
subscribe (fn) {
  return genericSubscribe(fn, this._subscribers)
}

function genericSubscribe (fn, subs) {
  if (subs.indexOf(fn) < 0) {
    subs.push(fn)
  }
  return () => {
    const i = subs.indexOf(fn)
    if (i > -1) {
      subs.splice(i, 1)
    }
  }
}
```

`subscribe` 的逻辑很简单，就是往 `this._subscribers` 去添加一个函数，并返回一个 `unsubscribe` 的方法。

而我们在执行 `store.commit` 的方法的时候，会遍历 `this._subscribers` 执行它们对应的回调函数：

```js
commit (_type, _payload, _options) {
  const {
    type,
    payload,
    options
  } = unifyObjectStyle(_type, _payload, _options)

  const mutation = { type, payload }
  // ...
  this._subscribers.forEach(sub => sub(mutation, this.state))  
}
```

回到我们的 `Logger` 函数，它相当于订阅了 `mutation` 的提交，它的 `prevState` 表示之前的 `state`，`nextState` 表示提交 `mutation` 后的 `state`，这两个 `state` 都需要执行 `deepCopy` 方法拷贝一份对象的副本，这样对他们的修改就不会影响原始 `store.state`。

接下来就构造一些格式化的消息，打印出一些时间消息 `message`， 之前的状态 `prevState`，对应的 `mutation` 操作 `formattedMutation` 以及下一个状态 `nextState`。

最后更新 `prevState = nextState`，为下一次提交 `mutation` 输出日志做准备。

## 总结

那么至此 Vuex 的插件分析就结束了，Vuex 从设计上支持了插件，让我们很好地从外部追踪 `store` 内部的变化，`Logger` 插件在我们的开发阶段也提供了很好地指引作用。当然我们也可以自己去实现 `Vuex` 的插件，来帮助我们实现一些特定的需求。
