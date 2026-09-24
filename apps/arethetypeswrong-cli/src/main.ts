#!/usr/bin/env node
import { NodeHttpClient } from '@effect/platform-node'
import { layer as nodeChildProcessSpawnerLayer } from '@effect/platform-node-shared/NodeChildProcessSpawner'
import { layer as nodeFileSystemLayer } from '@effect/platform-node-shared/NodeFileSystem'
import { layer as nodePathLayer } from '@effect/platform-node-shared/NodePath'
import { layer as nodeStdioLayer } from '@effect/platform-node-shared/NodeStdio'
import { layer as nodeTerminalLayer } from '@effect/platform-node-shared/NodeTerminal'
import { runMain } from '@effect/platform-node/NodeRuntime'
import { Effect, Layer } from 'effect'

import { cliVersion } from './cli-version.js'
import { layer as httpRegistryLayer } from './drivers/http-registry.js'
import { layer as nodeFilesystemLayer } from './drivers/node-filesystem.js'
import { layer as nodeTerminalServiceLayer } from './drivers/node-terminal.js'
import { layer as npmPackRunnerLayer } from './drivers/npm-pack-runner.js'
import { runCli } from './run-attw.command.js'

const nodeBase = Layer.mergeAll(nodeFileSystemLayer, nodePathLayer, nodeTerminalLayer, nodeStdioLayer)

const nodeSpawnerLayer = nodeChildProcessSpawnerLayer.pipe(Layer.provide(nodeBase))

const httpClientLayer = NodeHttpClient.layerFetch

const terminalServiceLayer = nodeTerminalServiceLayer()

const filesystemLayer = nodeFilesystemLayer().pipe(Layer.provide(nodeBase))

const packRunnerLayer = npmPackRunnerLayer().pipe(Layer.provide(Layer.mergeAll(nodeBase, nodeSpawnerLayer)))

const registryLayer = httpRegistryLayer().pipe(Layer.provide(httpClientLayer))

const live = Layer.mergeAll(
  nodeBase,
  nodeSpawnerLayer,
  httpClientLayer,
  terminalServiceLayer,
  filesystemLayer,
  packRunnerLayer,
  registryLayer,
)

const main = runCli(process.argv.slice(2), { version: cliVersion })

runMain(main.pipe(Effect.withLogSpan('attw'), Effect.provide(live)))
