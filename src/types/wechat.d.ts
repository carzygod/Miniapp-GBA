declare const WXWebAssembly: {
  instantiate(path: string, imports: WebAssembly.Imports): Promise<WebAssembly.WebAssemblyInstantiatedSource>
}

declare const __MINIGBA_API_BASE_URL__: string

interface WechatCanvasNode {
  width: number
  height: number
  getContext(type: '2d'): WechatCanvasRenderingContext2D
  requestAnimationFrame(callback: (time: number) => void): number
  cancelAnimationFrame(handle: number): void
}

interface WechatCanvasRenderingContext2D {
  imageSmoothingEnabled: boolean
  clearRect(x: number, y: number, width: number, height: number): void
  drawImage(image: unknown, dx: number, dy: number, dWidth: number, dHeight: number): void
  putImageData(imageData: ImageData, dx: number, dy: number): void
  createImageData(width: number, height: number): ImageData
}
