import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

export function atomicWrite(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file + '.tmp', content)
  fs.renameSync(file + '.tmp', file)
}
export function canonical(directory) {
  const absolute = path.resolve(directory)
  if (fs.existsSync(absolute)) return fs.realpathSync(absolute)
  const parent = path.dirname(absolute)
  if (parent === absolute) throw new Error('磁盘不可用：' + absolute)
  return path.join(canonical(parent), path.basename(absolute))
}
function contains(parent, child) {
  const relative = path.relative(parent, child)
  return !relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
}
export function validateDestination(target, forbidden) {
  if (!path.isAbsolute(target)) throw new Error('请选择绝对路径。')
  const resolved = canonical(target)
  if (path.parse(resolved).root === resolved) throw new Error('不能直接使用磁盘根目录。')
  for (const source of forbidden.map(canonical)) {
    if (contains(source, resolved) || contains(resolved, source)) throw new Error('新目录不能与现有数据、程序或启动配置目录重叠。')
  }
  if (fs.existsSync(resolved) && fs.readdirSync(resolved).length) throw new Error('请选择空目录，避免覆盖已有数据。')
  fs.mkdirSync(resolved, { recursive: true })
  const probe = path.join(resolved, '.herness-write-' + crypto.randomUUID())
  fs.writeFileSync(probe, ''); fs.unlinkSync(probe)
  return resolved
}
function fileHash(file) {
  const hash = crypto.createHash('sha256'), buffer = Buffer.alloc(1024 * 1024)
  const fd = fs.openSync(file, 'r')
  try { let size; while ((size = fs.readSync(fd, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, size)) }
  finally { fs.closeSync(fd) }
  return hash.digest('hex')
}
function inventory(directory) {
  const result = {}
  const walk = (base, relative = '') => {
    for (const entry of fs.readdirSync(base, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = path.join(relative, entry.name), file = path.join(base, entry.name)
      const stat = fs.lstatSync(file)
      if (stat.isSymbolicLink()) throw new Error('数据目录包含链接，需先处理后迁移：' + file)
      if (stat.isDirectory()) { result[name] = 'directory'; walk(file, name) }
      else if (stat.isFile()) result[name] = fileHash(file)
      else throw new Error('无法迁移特殊文件：' + file)
    }
  }
  if (!fs.existsSync(directory)) throw new Error('数据目录不可用，未切换位置：' + directory)
  walk(directory)
  return result
}
function copyTree(source, target) {
  fs.mkdirSync(target)
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name), to = path.join(target, entry.name)
    if (entry.isDirectory()) copyTree(from, to)
    else if (entry.isFile()) fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL)
    else throw new Error('不能复制链接或特殊文件：' + from)
  }
}
export function migrateData(plan, locationFile) {
  const target = validateDestination(plan.target, [...plan.sources.map(s => s.from), ...plan.forbidden])
  // The active pointer changes only after both complete trees match their originals.
  const snapshots = plan.sources.map(source => ({ ...source, before: inventory(source.from) }))
  for (const source of snapshots) {
    const destination = path.join(target, source.name)
    copyTree(source.from, destination)
  }
  for (const source of snapshots) {
    const { before } = source
    const destination = path.join(target, source.name)
    if (JSON.stringify(before) !== JSON.stringify(inventory(source.from)) || JSON.stringify(before) !== JSON.stringify(inventory(destination))) {
      throw new Error('数据在复制期间发生变化，未切换目录。请停止其他使用该目录的程序后重试。')
    }
  }
  atomicWrite(locationFile, target)
  return target
}
