/**
 * 浏览器里的 ADB 私钥。
 *
 * 连 adbd 要先认证：客户端拿一把 RSA 私钥签名 token，再把公钥发给手机，
 * 手机弹「允许 USB 调试」记下这把公钥。服务端引擎直接复用 ~/.android/adbkey，
 * 浏览器没有那个目录，只能自己生成一把存在本机（localStorage）。
 *
 * 私钥只在本机浏览器里，不随代码分发；换端口 / 换域名会重新生成一把，
 * 手机上会再弹一次授权（和「另一台电脑插上来」是一个道理）。
 *
 * 只需要 PKCS#8 的 DER 字节 —— Tango 自己用 BigInt 做 RSA 运算，不依赖 WebCrypto 的签名能力。
 */

const STORAGE_KEY = 'autojs6.adbkey.v1'

const RSA_PARAMS = {
  name: 'RSASSA-PKCS1-v1_5',
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: 'SHA-256',
}

/** 分块拼 base64：一次性 apply 上百万参数会爆栈，DER 虽小也按稳妥写法来 */
function toBase64(bytes) {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function fromBase64(text) {
  const binary = atob(text)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i)
  return out
}

/** 公钥备注名：手机上「允许 USB 调试」弹窗里显示的就是它，一眼能认出是哪个页面 */
function keyName() {
  const host = typeof location !== 'undefined' ? location.host || location.protocol : ''
  return `autojs6-web@${host || 'browser'}`.slice(0, 80)
}

function readKey() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
    if (!raw || typeof raw.key !== 'string' || !raw.key) return null
    const buffer = fromBase64(raw.key)
    if (buffer.length < 100) return null
    return { buffer, name: typeof raw.name === 'string' ? raw.name : keyName() }
  } catch {
    return null
  }
}

function writeKey(key) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ key: toBase64(key.buffer), name: key.name, at: Date.now() }),
    )
  } catch {
    // 隐私模式 / 配额满：这一次能用，下次刷新会重新生成并要求手机重新授权
  }
}

export const credentialStore = {
  async generateKey() {
    if (!globalThis.crypto?.subtle) {
      throw new Error('当前环境没有 WebCrypto，无法生成 ADB 私钥（需要 https 或 localhost）')
    }
    const pair = await crypto.subtle.generateKey(RSA_PARAMS, true, ['sign', 'verify'])
    const der = await crypto.subtle.exportKey('pkcs8', pair.privateKey)
    const key = { buffer: new Uint8Array(der), name: keyName() }
    writeKey(key)
    return key
  },

  async *iterateKeys() {
    const key = readKey()
    if (key) yield key
  },
}

/** 「忘记这把钥匙」：认证异常时给用户一个干净重来的入口（下次会重新生成并重新授权） */
export function forgetKey() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {}
}
