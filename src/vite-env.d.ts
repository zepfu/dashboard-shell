/// <reference types="vite/client" />

declare module 'aawm-tap-dashboard/module' {
  import type { ProjectModule } from './shell/types'

  const module: ProjectModule
  export default module
}
