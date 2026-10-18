import type { Logo } from './types'

const ALLOWED = ['image/png', 'image/jpeg', 'image/svg+xml']
const MAX_BYTES = 2 * 1024 * 1024

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Das Bild konnte nicht gelesen werden.'))
    img.src = src
  })
}

function rasterize(img: HTMLImageElement, width: number, height: number, maxSide = 1200): string {
  const ratio = Math.min(1, maxSide / Math.max(width, height)) || 1
  const scale = width < 600 ? 600 / width : ratio
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * scale)
  canvas.height = Math.round(height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas wird nicht unterstützt.')
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/png')
}

export async function readLogo(file: File): Promise<Logo> {
  const mime = file.type || (file.name.endsWith('.svg') ? 'image/svg+xml' : '')
  if (!ALLOWED.includes(mime)) throw new Error('Bitte ein PNG-, JPG- oder SVG-Bild wählen.')
  if (file.size > MAX_BYTES) throw new Error('Das Logo ist größer als 2 MB. Bitte eine kleinere Datei wählen.')

  let dataUrl = await readAsDataUrl(file)
  if (mime === 'image/svg+xml') {
    // Re-encode so the data URL carries the right MIME type, even if the browser left it empty.
    dataUrl = `data:image/svg+xml;base64,${dataUrl.split(',')[1]}`
  }
  const img = await loadImage(dataUrl)
  let width = img.naturalWidth
  let height = img.naturalHeight
  if (mime === 'image/svg+xml' && (!width || !height)) {
    width = 600
    height = 200
  }
  const logo: Logo = { dataUrl, mime, width, height }
  if (mime === 'image/svg+xml') logo.pngDataUrl = rasterize(img, width, height)
  return logo
}
