// Standalone Lumen Together relay.
//
// Reuses the app's own relay and room logic rather than reimplementing it, so
// a self-hosted relay and Lumen's built-in one can never drift apart on the
// rules — who may pause, how a vote is counted, when the room resumes.
//
//   npm run relay          (PORT=7345 by default)

import { TogetherRelay } from '../src/main/together/relay'

const port = Number(process.env.PORT ?? 7345)
const host = process.env.HOST ?? '0.0.0.0'

const relay = new TogetherRelay({ port, host })
const started = await relay.start()

console.log(`Lumen Together relay listening on ${host}:${started.port}`)
console.log('Rooms are created on demand; watchers just need the address and a room code.')

const shutdown = (): void => {
  console.log('\nShutting down.')
  relay.stop()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
