# Summary

- 准备
  - [认识 FLow](prepare/flow.md)
  - [Vue.js 源码目录设计](prepare/directory.md)
  - [Vue.js 源码构建](prepare/build.md)
  - [从入口开始](prepare/entrance.md)
  
- [数据驱动](data-driven/index.md)
  - [new Vue 发生了什么](data-driven/new-vue.md)
  - [Vue 实例挂载的实现](data-driven/mounted.md)
  - [render](data-driven/render.md)
  - [Virtual DOM](data-driven/virtual-dom.md)
  - [createElement](data-driven/create-element.md)
  - [update](data-driven/update.md)  
  
- [组件化](components/index.md)
  - [createComponent](components/create-component.md)
  - [patch](components/patch.md)
  - [合并配置](components/merge-option.md)
  - [生命周期](components/lifecycle.md)
  - [组件注册](components/component-register.md)
  - [异步组件](components/async-component.md)
  
- [深入响应式原理](reactive/index.md)
  - [响应式对象](reactive/reactive-object.md)
  - [依赖收集](reactive/getters.md)
  - [派发更新](reactive/setters.md)
  - [nextTick](reactive/next-tick.md)
  - [检测变化的注意事项](reactive/questions.md)
  - [计算属性 VS 侦听属性](reactive/computed-watcher.md)
  - [组件更新](reactive/component-update.md)