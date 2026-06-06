import { Bindings } from '../src/types/bindings'

declare module 'cloudflare:test' {
  interface ProvidedEnv extends Bindings {}
}
