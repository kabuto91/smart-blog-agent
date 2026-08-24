

## vite运行项目报错cannot find module @rollup/rollup-win32-x64-msvc
因为vite引入的rollup版本突然更新，而中心仓里面的rollup版本跨度太大，可能导致最新的rollup版本不兼容当前版本导致，在package.json里面把rollup版本固定即可
![](./images/1713230929248_image.png)
```json
"resolutions": {
    "rollup": "4.9.6"
}
```

## clearInterval不起作用问题
* 查看是否存在重复赋值setInterval的问题，多次赋值可能会导致clearInterval清除不掉的问题，最好在clearInterval以及setInterval前都判断一遍当前定时器的状态
* 如果定时器存放在变量中，需判断下清除定时器以及设置定时器操作的先后顺序，是否存在操作之后组件未刷新的问题，可以把操作放在nextTick之后

## 文件系统监听冲突
eslint报错信息重复打印
原因：Vite 和 ESLint 同时监听了文件变化。
解决方法：

```js
// vite.config.js
export default {
  server: {
    watch: {
      ignored: ['**/.eslintrc/**'], // 忽略 ESLint 配置文件变化
    },
  },
};
```

## Unocss样式失效问题
代码中引入[citation:1][citation:3]导致unocss样式失效
```javascript
// unocss版本：0.39.3
<script setup>

// [citation:][citation:]

</script>
```
翻了下源码发现代码中有涉及内容：
```javascript
const __vite__css = "/* layer: preflights */\n*,::before,::after{--un-rotate:0;--un-rotate-x:0;--un-rotate-y:0;--un-rotate-z:0;--un-scale-x:1;--un-scale-y:1;--un-scale-z:1;--un-skew-x:0;--un-skew-y:0;--un-translate-x:0;--un-translate-y:0;--un-translate-z:0;--un-pan-x:var(--un-empty,/*!*/ /*!*/);--un-pan-y:var(--un-empty,/*!*/ /*!*/);--un-pinch-zoom:var(--un-empty,/*!*/ /*!*/);--un-scroll-snap-strictness:proximity;--un-ordinal:var(--un-empty,/*!*/ /*!*/);--un-slashed-zero:var(--un-empty,/*!*/ /*!*/);--un-numeric-figure:var(--un-empty,/*!*/ /*!*/);--un-numeric-spacing:var(--un-empty,/*!*/ /*!*/);--un-numeric-fraction:var(--un-empty,/*!*/ /*!*/);--un-border-spacing-x:0;--un-border-spacing-y:0;--un-ring-offset-shadow:0 0 #0000;--un-ring-shadow:0 0 #0000;--un-shadow-inset:var(--un-empty,/*!*/ /*!*/);--un-shadow:0 0 #0000;--un-ring-inset:var(--un-empty,/*!*/ /*!*/);--un-ring-offset-width:0px;--un-ring-offset-color:#fff;--un-ring-width:0px;--un-ring-color:rgba(147,197,253,0.5);--un-blur:var(--un-empty,/*!*/ /*!*/);--un-brightness:var(--un-empty,/*!*/ /*!*/);--un-contrast:var(--un-empty,/*!*/ /*!*/);--un-drop-shadow:var(--un-empty,/*!*/ /*!*/);--un-grayscale:var(--un-empty,/*!*/ /*!*/);--un-hue-rotate:var(--un-empty,/*!*/ /*!*/);--un-invert:var(--un-empty,/*!*/ /*!*/);--un-saturate:var(--un-empty,/*!*/ /*!*/);--un-sepia:var(--un-empty,/*!*/ /*!*/);--un-backdrop-blur:var(--un-empty,/*!*/ /*!*/);--un-backdrop-brightness:var(--un-empty,/*!*/ /*!*/);--un-backdrop-contrast:var(--un-empty,/*!*/ /*!*/);--un-backdrop-grayscale:var(--un-empty,/*!*/ /*!*/);--un-backdrop-hue-rotate:var(--un-empty,/*!*/ /*!*/);--un-backdrop-invert:var(--un-empty,/*!*/ /*!*/);--un-backdrop-opacity:var(--un-empty,/*!*/ /*!*/);--un-backdrop-saturate:var(--un-empty,/*!*/ /*!*/);--un-backdrop-sepia:var(--un-empty,/*!*/ /*!*/);}\n/* layer: default */\n.\\[citation\\:\\]\\[citation\\:\\]{citation:][citation:;}\n.text-26px{font-size:26px;}\n.font-bold{font-weight:700;}\n.text-red{--un-text-opacity:1;color:rgba(248,113,113,var(--un-text-opacity));}\n.filter{filter:var(--un-blur) var(--un-brightness) var(--un-contrast) var(--un-drop-shadow) var(--un-grayscale) var(--un-hue-rotate) var(--un-invert) var(--un-saturate) var(--un-sepia);}"
```
其中的`\\[citation\\:\\]\\[citation\\:\\]{citation:][citation:;}`会把[citation:][citation:]的内容转义出来，但是后面的语法看着语法有问题，猜测是解析后面语法的时候报错导致Unocss预设样式没加载出来

解决方法：
1. 删除相关内容


## 输入框按enter键刷新页面问题
在页面中按enter键会触发刷新页面，后面翻代码发现都是在form中的输入框会有此问题，查阅资料发现在form中按enter键会触发默认的表单提交行为，导致页面刷新

解决方法：
给原生input或者包装input组件的父元素添加keydown事件，阻止原生默认行为，示例：
```javascript
const emitKeyDownEvent = (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
  }
  emit('keydown')
}

onMounted(() => {
  baseCustomInputRef.value.addEventListener('keydown', emitKeyDownEvent);
})
```

## JS迭代器对象第二次引用为空值
根本原因：Map迭代器只能遍历一次
Map的keys()方法返回的是迭代器对象（Iterator），而不是数组。在JavaScript中，迭代器对象只能遍历一次，一旦遍历完成，它就会"耗尽"（即无法再次遍历）。

解决方法：
1. 修改为数组形式
2. 每次遍历重新生成keys()

## Wujie微前端框架嵌入样式错乱问题
根本原因：版型 1.0.82-RELEASE版本在引入的CSS代码（代码1.1）后使用innerText生成CSS样式，导致生成的代码里的换行符会转化成`<br>`，所以生成的样式应该是这个样子的(代码1.2)。然后在wujie源码中会对生成的style标签的进行innerHTML字符串序列化处理，就会将`<br>`标签转换成一个普通字符串常量(代码1.3)影响浏览器样式渲染

> 根据 WHATWG HTML 规范，当你给一个元素设置 innerText 时，浏览器会执行以下算法：
> 1. 按 \n 分割字符串成多行
> 2. 逐行处理：每行创建一个文本节点（Text Node）
> 3. 在行与行之间插入 `<br> `元素


```css
// 代码1.1
.orc-dialog-wrap {
  position: fixed;
  ...
}
...
```

```css
// 代码1.2
<br>
.orc-dialog-wrap {
<br>
  position: fixed;
<br>
  ...
<br>
}
<br>
```

```css
// 代码1.3
<br>.orc-dialog-wrap {<br>position: fixed;<br>...<br>}<br>
```


2. $定义的语法都要进行整改
3. slot="xxx"的语法在Vue3中已经不适用，需修改成`<template #xxx>`
4. 有一些Grid表格data属性直接push进去视图会不更新，需调用一下loadData方法中心加载表格数据
5. Vue3中v-model接收不能使用model+value去接收，使用modelValue去接收
6. 如果子组件未正确声明 click事件，父组件监听click时，会触发两次：把父组件emit删掉
6. filter废弃
<!-- 7. import Vue from 'vue' 修改为import * as Vue3 from 'vue' -->
8. echarts报错（`dataSample.js:104 Uncaught TypeError: Cannot read properties of undefined (reading 'type')`）：

![](./images/1706670195415_image.png)


9. vue-i18n 9.*版本以上Message compilation error: Unbalanced closing brace（会对{、}、@、|等做处理，需加上{'****'}让它原始化）
10. this.$在computed中都会undefined


## webpack转成vite
1. 添加vite依赖
    
```javascript
// package.json
"vite": "^5.0.11",
"@vitejs/plugin-vue": "^4.0.0",
"@vitejs/plugin-vue-jsx": "^1.1.1",
// vite.config.js
import vue from '@vitejs/plugin-vue'
import vueJsx from '@vitejs/plugin-vue-jsx'
export default defineConfig({
    plugins: [vue(), vueJsx(),]
})
```
2. process is not define：在vite.config.js里添加全局环境变量
`define: {
    'process.env': Object.assign({}, process.env)
  }`
3. require is not define：（没啥用，将代码里require转换成import）
    1. 添加vite-plugin-require-transform依赖 
    2. 配置vite.config.js 

    ```js
    import requireTransform from 'vite-plugin-require-transform'
    export default defineConfig({
        plugins: [
            requireTransform({
                fileRegex: /.js$|.vue$/
            })
        ]
    })
    ```
4. Failed to resolve import "@/***" from ****：配置vite.config.js

```javascript
import path, { resolve } from 'path'
export default defineConfig({
    resolve: {
        alias: {
        '@': resolve(__dirname, 'src')
        },
        extensions: ['.js', '.json', '.vue']
    },
})
```
5. 配置https启动项目
    1. 添加@vitejs/plugin-basic-ssl依赖
    2. 配置vite.config.js 

    ```js
    import requireTransform from 'vite-plugin-require-transform'
    export default defineConfig({
        plugins: [
            plugins: [basicSsl()]
        ]
    })
    ```
6. CJS需要转换成ESM模块导入导出（例如将modules.export转化成export default）
7. ![](./images/1705917791159_image.png)
解决方案：
![](./images/1705917890158_image.png)
8. 引入serviceInterceptors报错（Failed to parse source for import analysis because the content contains invalid JS syntax. If you are using JSX, make sure to name the file with the .jsx or .tsx extension.）：解析js里面的jsx语法失败，将serviceInterceptors.js修改为serviceInterceptors.jsx

10. 类似webpack生成sourceMap：在vite.config.js里加上`build.sourcemap: true`
11. **报错**`Sourcemap is likely to be incorrect: a plugin (replaceLoader) was used to transform files, but didn't generate a sourcemap for the transformation. Consult the plugin documentation 
for help`：将插件里面的tranform的返回值加上map: null
![](./images/1706674217098_image.png)
