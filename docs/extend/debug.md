# debug

当我们开发 Vue 的项目的时候，在开发调试阶段可能经常会遇到一些警告或者提示信息，这些警告和提示往往都是为了帮助我们定位错误，避免出现一些非预期的行为导致我们的应用不正常。

举个例子，当我们在模板中使用了未定义的变量，如图所示：

<img :src="$withBase('/assets/debug.png')">

我们在模板中使用了 `msg`，但是在组件中并没有定义它，那么运行这段代码就会在开发阶段报错，报错信息如下：

<img :src="$withBase('/assets/warn.png')">

这张图我们可以把它拆开看，上半部分是打印了出错信息，描述了错误的原因，下半部分是从根组件开始到出错组件的一个路径，因为组件是可以复用的，这样我们就可以通过路径准确的找到了具体报错组件了。

那么 Vue.js 是如何实现这些警告和提示的呢，下面我们就从源码角度来分析。

警告和提示的实现都在 `src/core/util/debug.js` 中，整个代码也并不多，如下：

```js
/* @flow */

import config from '../config'
import { noop } from 'shared/util'

export let warn = noop
export let tip = noop
export let generateComponentTrace = (noop: any) // work around flow check
export let formatComponentName = (noop: any)

if (process.env.NODE_ENV !== 'production') {
  const hasConsole = typeof console !== 'undefined'
  const classifyRE = /(?:^|[-_])(\w)/g
  const classify = str => str
    .replace(classifyRE, c => c.toUpperCase())
    .replace(/[-_]/g, '')

  warn = (msg, vm) => {
    const trace = vm ? generateComponentTrace(vm) : ''

    if (config.warnHandler) {
      config.warnHandler.call(null, msg, vm, trace)
    } else if (hasConsole && (!config.silent)) {
      console.error(`[Vue warn]: ${msg}${trace}`)
    }
  }

  tip = (msg, vm) => {
    if (hasConsole && (!config.silent)) {
      console.warn(`[Vue tip]: ${msg}` + (
        vm ? generateComponentTrace(vm) : ''
      ))
    }
  }

  formatComponentName = (vm, includeFile) => {
    if (vm.$root === vm) {
      return '<Root>'
    }
    const options = typeof vm === 'function' && vm.cid != null
      ? vm.options
      : vm._isVue
        ? vm.$options || vm.constructor.options
        : vm || {}
    let name = options.name || options._componentTag
    const file = options.__file
    if (!name && file) {
      const match = file.match(/([^/\\]+)\.vue$/)
      name = match && match[1]
    }

    return (
      (name ? `<${classify(name)}>` : `<Anonymous>`) +
      (file && includeFile !== false ? ` at ${file}` : '')
    )
  }

  const repeat = (str, n) => {
    let res = ''
    while (n) {
      if (n % 2 === 1) res += str
      if (n > 1) str += str
      n >>= 1
    }
    return res
  }

  generateComponentTrace = vm => {
    if (vm._isVue && vm.$parent) {
      const tree = []
      let currentRecursiveSequence = 0
      while (vm) {
        if (tree.length > 0) {
          const last = tree[tree.length - 1]
          if (last.constructor === vm.constructor) {
            currentRecursiveSequence++
            vm = vm.$parent
            continue
          } else if (currentRecursiveSequence > 0) {
            tree[tree.length - 1] = [last, currentRecursiveSequence]
            currentRecursiveSequence = 0
          }
        }
        tree.push(vm)
        vm = vm.$parent
      }
      return '\n\nfound in\n\n' + tree
        .map((vm, i) => `${
          i === 0 ? '---> ' : repeat(' ', 5 + i * 2)
        }${
          Array.isArray(vm)
            ? `${formatComponentName(vm[0])}... (${vm[1]} recursive calls)`
            : formatComponentName(vm)
        }`)
        .join('\n')
    } else {
      return `\n\n(found in ${formatComponentName(vm)})`
    }
  }
}
```


主要对外实现了 2 个 API：`warn` 和 `tip`，接下来我们来分别看它们的实现。

## warn

``` js
warn = (msg, vm) => {
  const trace = vm ? generateComponentTrace(vm) : ''

  if (config.warnHandler) {
    config.warnHandler.call(null, msg, vm, trace)
  } else if (hasConsole && (!config.silent)) {
    console.error(`[Vue warn]: ${msg}${trace}`)
  }
}
```

首先它执行 `generateComponentTrace` 去获取当前组件实例到根组件的一个路径：

```js
generateComponentTrace = vm => {
  if (vm._isVue && vm.$parent) {
    const tree = []
    let currentRecursiveSequence = 0
    while (vm) {
      if (tree.length > 0) {
        const last = tree[tree.length - 1]
        if (last.constructor === vm.constructor) {
          currentRecursiveSequence++
          vm = vm.$parent
          continue
        } else if (currentRecursiveSequence > 0) {
          tree[tree.length - 1] = [last, currentRecursiveSequence]
          currentRecursiveSequence = 0
        }
      }
      tree.push(vm)
      vm = vm.$parent
    }
    return '\n\nfound in\n\n' + tree
      .map((vm, i) => `${
        i === 0 ? '---> ' : repeat(' ', 5 + i * 2)
      }${
        Array.isArray(vm)
          ? `${formatComponentName(vm[0])}... (${vm[1]} recursive calls)`
          : formatComponentName(vm)
      }`)
      .join('\n')
  } else {
    return `\n\n(found in ${formatComponentName(vm)})`
  }
}
```

`generateComponentTrace` 的实现逻辑很简单，从当前的 `vm` 实例开始，不断访问它的 `$parent`，直到早到根 `vm` 实例，得到它的整个组件调用轨迹字符串。在查找的过程中，会把每个组件的 `vm` 实例添加到 `tree` 数组中，用于之后构建路径用，另外对于递归组件，它只会添加一个数组到 `tree` 中，该数组第一个元素是这个递归组件，第二个元素是 `currentRecursiveSequence`，用于记录递归次数。

构造出 tree 以后，就是拼接输出信息了，通过 `tree.map` 遍历拿到每一个 `vm` 和当前遍历的
索引，对于第一个索引输出字符 `--->`，之后会根据索引值拼接缩进的空格。箭头和缩进都会拼接格式化后的组件名，当然对于递归组件，会拼接它的组件名和递归调用的次数。再来看一下 `formatComponentName` 的实现：

```js
formatComponentName = (vm, includeFile) => {
  if (vm.$root === vm) {
    return '<Root>'
  }
  const options = typeof vm === 'function' && vm.cid != null
    ? vm.options
    : vm._isVue
      ? vm.$options || vm.constructor.options
      : vm || {}
  let name = options.name || options._componentTag
  const file = options.__file
  if (!name && file) {
    const match = file.match(/([^/\\]+)\.vue$/)
    name = match && match[1]
  }

  return (
    (name ? `<${classify(name)}>` : `<Anonymous>`) +
    (file && includeFile !== false ? ` at ${file}` : '')
  )
}
```

`formatComponentName` 的实现也很容易，它支持传入一个 Vue 实例或者是构造器，目标是获取一个格式化的组件名。首先尝试去拿 `options`，如果 `vm` 是一个 Vue 构造器，那么就获取 `vm.options`，否则如果是一个 Vue 实例，则获取 `vm.$options`，获取不到则尝试获取 `vm.constructor.options`。然后通过 `options.name`，如果没有则通过 `options._componentTag` 获取 `name`。接着通过 `options.__file` 获取 `file`，如果是通过 webpack 编译 `.vue` 文件生成的组件，则 `options.__file` 可以拿到它的文件名，这样如果没有在组件中定义 `name`，我们也可以通过它的文件名获取到 `name`。

最后判断是否拿到了 `name`，如果拿到了则通过 `classify(name)` 变成类风格首字母大写的字符串，否则就是 `<Anonymous>` 表示一个匿名组件，最后还根据参数 `includeFile` 以及 `file` 判断是否要拼接组件所属的文件名。

经过 `generateComponentTrace(vm)` 后，我们获得了从当前组件实例到根组件的路径，这个就是报错信息的下半部分。

接下来就很简单了，判断是否全局定义了警告处理函数 `config.warnHandler`，如果定义了则执行 `config.warnHandler.call(null, msg, vm, trace)`，把 `msg、vm、trace` 作为参数传入，这样用户就可以自己去处理这些警告了。如果没有定义的话，则判断如果平台支持 console 并且没有全局配置 `config.silent` 的情况通过 `console.error(`[Vue warn]: ${msg}${trace}`)` 输出错误信息。可以看到，报错信息 `msg` 在前半部分，后半部分就是 `trace`。

## tip

```js
tip = (msg, vm) => {
  if (hasConsole && (!config.silent)) {
    console.warn(`[Vue tip]: ${msg}` + (
      vm ? generateComponentTrace(vm) : ''
    ))
  }
}
```

了解了 `warn` 的实现后，`tip` 的实现就非常好理解了，他们的实现是很类似的，不同的是它的输出前缀是 `[Vue tip]` 而非 `[Vue warn]`，并且它是通过 `console.warn` 输出的，在控制台会输出一个感叹号。

## 总结

Vue.js 的源码实现很复杂，提供的功能也很多，很多情况下不正确的使用都会出现一些非预期的行为导致我们的应用不正常。所以 Vue 内部很多地方都通过 `warn` 函数报出一些错误警告，并且会输出详细的错误信息以及组件的调用路径，帮助我们在开发阶段定位和解决这些问题。而 `tip` 相对于 `warn` 来说更轻量，它会提示一些消息，通常并不会影响应用的运行。

`warn` 和 `tip` 都是框架内部在调用，并没有提供公开的 API，尽管你可以通过 `Vue.util.warn` 和 `Vue.util.tip` 访问到它们，但通常不建议使用。

警告和提示的设计是可以应用在我们平时开发的 JS 库中的，当用户不正确的使用我们提供的 JS 库的时候，给予一定的警告和提示。

