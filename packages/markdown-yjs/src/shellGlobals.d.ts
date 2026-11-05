/**
 * The markdown pipeline in `src/utils` reaches `src/mock-tauri`, which reads two window
 * fields that `src/App.tsx` declares. The app shell is not part of this program, so the
 * declarations are repeated here.
 */
export {}

declare global {
  interface Window {
    __mockContent?: Record<string, string>
    __mockHandlers?: Record<string, (args?: unknown) => unknown>
  }
}
