export function withTimeout<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds) })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}
