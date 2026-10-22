import test from 'node:test'
import assert from 'node:assert/strict'

let captured
globalThis.window = {
  __ModuleLoader__: {
    load(definition) {
      captured = definition
    },
  },
}

await import('../lib/client.js')

const reactStub = {
  createElement: (...args) => ({ args }),
  useState: (initial) => [initial, () => {}],
  useEffect: () => {},
}

test('client bundle registers under the package id', () => {
  assert.equal(captured.id, 'dsh-bot-sandbox')
  assert.equal(typeof captured.factory, 'function')
})

test('client exports apply/inject/name and registers both UI seats', () => {
  const exportsObject = captured.factory((request) => {
    if (request === 'react') return reactStub
    throw new Error(`unexpected require: ${request}`)
  })
  assert.equal(exportsObject.name, 'bot-sandbox')
  assert.deepEqual(exportsObject.inject, ['slots'])
  assert.equal(typeof exportsObject.apply, 'function')

  const registered = []
  let disposed = false
  const ctx = {
    slots: {
      inject(_name, callback) {
        callback()
        return () => {
          disposed = true
        }
      },
      register(meta, component) {
        registered.push({ meta, component })
        return () => {}
      },
    },
    effect(callback) {
      return callback()
    },
  }
  exportsObject.apply(ctx)
  assert.equal(registered.length, 2)
  const settings = registered.find((entry) => entry.meta.name === 'settings.section')
  const footer = registered.find((entry) => entry.meta.name === 'sidebar.footer.action')
  assert.ok(settings)
  assert.ok(footer)
  assert.equal(settings.meta.id, 'bot-sandbox')
  assert.equal(settings.meta.label, '机器人沙箱')
  assert.equal(typeof settings.component, 'function')
  assert.equal(footer.meta.id, 'bot-sandbox')
  assert.equal(typeof footer.component, 'function')
  assert.equal(disposed, false)
})
