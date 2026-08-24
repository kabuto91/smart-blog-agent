## AUI form组件validate方法校验无响应

当model里面的值无对应的字段的话，validate没有任何的响应，会一直阻塞当前进程

## 路由检查查看卡死问题
3.0 路由管理-健康检查状态卡死问题分析：
经排查得出，只有多域名路由或者多条上下文根的会报这个问题，在测试环境上能复现出来

![](./images/1685026001868_image.png)

![](./images/1685063038411_image.png)

查看代码发现，Tabs页签在v-for循环时没有赋name属性（标识当前页签），所以可能导致在渲染页签的时候没有发现当前页签从而导致组件会一直渲染下去

**解决方法：**
* 加上name属性即可

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
