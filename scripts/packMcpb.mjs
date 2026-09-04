#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { cp, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const staging = path.join(root, '.mcpb-staging')
const output = path.join(root, 'auroradocs.mcpb')

await rm(staging, { recursive: true, force: true })
await mkdir(staging, { recursive: true })

execFileSync('pnpm', ['build'], { cwd: root, stdio: 'inherit' })
await cp(path.join(root, 'mcpb/manifest.json'), path.join(staging, 'manifest.json'))
await cp(path.join(root, 'package.json'), path.join(staging, 'package.json'))
await cp(path.join(root, 'pnpm-lock.yaml'), path.join(staging, 'pnpm-lock.yaml'))
await cp(path.join(root, 'LICENSE'), path.join(staging, 'LICENSE'))
await cp(path.join(root, 'NOTICE'), path.join(staging, 'NOTICE'))
await cp(path.join(root, 'dist'), path.join(staging, 'dist'), { recursive: true })

execFileSync('pnpm', ['install', '--prod', '--frozen-lockfile', '--ignore-scripts'], {
  cwd: staging,
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'production' },
})

await rm(output, { force: true })
execFileSync('zip', ['-r', '-q', output, '.'], { cwd: staging, stdio: 'inherit' })
await rm(staging, { recursive: true, force: true })
process.stderr.write(`Wrote ${output}\n`)
