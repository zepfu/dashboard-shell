/// <reference types="vite/client" />

type ProjectModule = import('./shell/types').ProjectModule

declare module 'aawm-tap-dashboard/module' {
  const module: ProjectModule
  export default module
}

declare module 'aawm-dashboard/module' {
  const module: ProjectModule
  export default module
}

declare module 'aawm-observe-dashboard/module' {
  const module: ProjectModule
  export default module
}

declare module 'aegis-dashboard/module' {
  const module: ProjectModule
  export default module
}

declare module 'sluice/module' {
  const module: ProjectModule
  export default module
}
