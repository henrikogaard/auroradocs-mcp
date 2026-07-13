import { runLiveSmoke } from './auroracloudLiveSmokeCore.js'

runLiveSmoke().catch((error) => {
  console.error(error)
  process.exit(1)
})
