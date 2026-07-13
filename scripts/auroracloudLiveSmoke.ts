import { runLiveSmoke } from './auroracloudLiveSmokeCore.ts'

runLiveSmoke().catch((error) => {
  console.error(error)
  process.exit(1)
})
