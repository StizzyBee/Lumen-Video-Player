// Standalone Lumen Together relay.
//
// Reuses the app's own relay and room logic rather than reimplementing it, so
// a self-hosted relay and Lumen's built-in one can never drift apart on the
// rules — who may pause, how a vote is counted, when the room resumes.
//
//   npm run relay          (PORT=7345 by default)

import { TogetherRelay } from '../src/main/together/relay'
import { join } from 'node:path'

const port = Number(process.env.PORT ?? 7345)
const host = process.env.HOST ?? '0.0.0.0'
const registryPath = process.env.LUMEN_INVITE_REGISTRY ?? join(process.cwd(), 'data', 'invite-registry.json')

const relay = new TogetherRelay({ port, host, inviteRegistryPath: registryPath })
const started = await relay.start()

console.log(`Lumen Together relay listening on ${host}:${started.port}`)
console.log('Rooms are created on demand; the same address also routes online Lumen player invitations.')

const shutdown = async (): Promise<void> => {
  console.log('\nShutting down.')
  await relay.flush()
  relay.stop()
  process.exit(0)
}
process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())
