import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { migrateData, validateDestination } from '../storage-core.mjs'

describe('complete user data migration', () => {
  it('preserves both data trees and commits the pointer only after verification', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'herness-migration-'))
    try {
      const home = path.join(root, 'old-home'), desktop = path.join(root, 'old-desktop'), target = path.join(root, 'new 中文')
      fs.mkdirSync(path.join(home, 'skills'), {recursive:true});fs.mkdirSync(desktop)
      fs.writeFileSync(path.join(home,'.env'), 'TEST_SECRET=local-test')
      fs.writeFileSync(path.join(home,'state.db'), Buffer.from([0,1,2,255]))
      fs.writeFileSync(path.join(desktop,'preferences.json'), '{"theme":"dark"}')
      const locator=path.join(root,'location.txt');fs.writeFileSync(locator,'old')
      migrateData({target,sources:[{name:'hermes',from:home},{name:'desktop',from:desktop}],forbidden:[]},locator)
      expect(fs.readFileSync(locator,'utf8')).toBe(target)
      expect(fs.readFileSync(path.join(target,'hermes','state.db'))).toEqual(fs.readFileSync(path.join(home,'state.db')))
      expect(fs.readFileSync(path.join(target,'hermes','.env'),'utf8')).toBe('TEST_SECRET=local-test')
      expect(fs.readFileSync(path.join(target,'desktop','preferences.json'),'utf8')).toBe('{"theme":"dark"}')
      expect(fs.existsSync(path.join(target,'hermes','skills'))).toBe(true)
      expect(()=>migrateData({target,sources:[{name:'hermes',from:home}],forbidden:[]},locator)).toThrow()
      expect(fs.readFileSync(locator,'utf8')).toBe(target)
    } finally {fs.rmSync(root,{recursive:true,force:true})}
  })
  it('rejects nested destinations and leaves the original pointer on copy failure', () => {
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'herness-failure-'))
    try {
      const home=path.join(root,'home');fs.mkdirSync(home)
      expect(()=>validateDestination(path.join(home,'nested'),[home])).toThrow()
      const locator=path.join(root,'location.txt');fs.writeFileSync(locator,'old')
      const blocked=path.join(root,'blocked');fs.writeFileSync(blocked,'file')
      expect(()=>migrateData({target:path.join(root,'new'),sources:[{name:'hermes',from:blocked}],forbidden:[]},locator)).toThrow()
      expect(fs.readFileSync(locator,'utf8')).toBe('old')
      expect(()=>migrateData({target:path.join(root,'missing-target'),sources:[{name:'hermes',from:path.join(root,'missing-source')}],forbidden:[]},locator)).toThrow()
      expect(fs.readFileSync(locator,'utf8')).toBe('old')
    } finally {fs.rmSync(root,{recursive:true,force:true})}
  })
})
