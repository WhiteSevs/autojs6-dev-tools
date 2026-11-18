/**
 * Element Plus 图标：只注册用到的那些。
 *
 * 原来 main.js 是 `import * as ElementPlusIconsVue` 全量注册（近 300 个图标），
 * 按需引入后没必要为一两个图标付整包的体积。这里列的是当前模板里出现的全部图标，
 * 包括 `<component :is="'DArrowRight'" />` 这种动态写法用到的名字 ——
 * 动态组件按名字查找，所以它们也必须在这里注册，模板里没有标签可让解析器识别。
 *
 * 新增图标时，在下面补一行 + 加进 icons 映射即可（两处都用同一份名单）。
 */
import {
  Aim,
  Camera,
  CircleCheck,
  CircleClose,
  Close,
  Connection,
  CopyDocument,
  Crop,
  DArrowLeft,
  DArrowRight,
  DocumentCopy,
  Download,
  EditPen,
  FullScreen,
  Grid,
  Hide,
  InfoFilled,
  Iphone,
  Loading,
  Location,
  Lock,
  Monitor,
  Odometer,
  Picture,
  PictureFilled,
  Plus,
  Pointer,
  Position,
  Rank,
  Refresh,
  RefreshRight,
  Search,
  Select,
  Setting,
  Unlock,
  Upload,
  VideoCamera,
  VideoPlay,
  View,
  ZoomIn,
  ZoomOut,
} from '@element-plus/icons-vue'

/** 组件名 -> 组件，键名必须和模板里用的标签名一致 */
export const icons = {
  Aim,
  Camera,
  CircleCheck,
  CircleClose,
  Close,
  Connection,
  CopyDocument,
  Crop,
  DArrowLeft,
  DArrowRight,
  DocumentCopy,
  Download,
  EditPen,
  FullScreen,
  Grid,
  Hide,
  InfoFilled,
  Iphone,
  Loading,
  Location,
  Lock,
  Monitor,
  Odometer,
  Picture,
  PictureFilled,
  Plus,
  Pointer,
  Position,
  Rank,
  Refresh,
  RefreshRight,
  Search,
  Select,
  Setting,
  Unlock,
  Upload,
  VideoCamera,
  VideoPlay,
  View,
  ZoomIn,
  ZoomOut,
}

export function registerIcons(app) {
  for (const [name, component] of Object.entries(icons)) {
    app.component(name, component)
  }
}
