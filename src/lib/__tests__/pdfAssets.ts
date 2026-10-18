import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PdfAssets } from '../pdf'

const read = (p: string) => new Uint8Array(readFileSync(join('public', p)))

/** The bundled fonts and colour profile, read from disk instead of fetched. */
export const testAssets: PdfAssets = {
  regular: read('fonts/LiberationSans-Regular.ttf'),
  bold: read('fonts/LiberationSans-Bold.ttf'),
  serif: read('fonts/LiberationSerif-Regular.ttf'),
  icc: read('color/sRGB.icc'),
}
