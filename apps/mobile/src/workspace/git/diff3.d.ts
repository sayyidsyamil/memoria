declare module 'diff3' {
  type Conflict = { a: string[]; aIndex: number; o: string[]; oIndex: number; b: string[]; bIndex: number }
  export default function diff3(local: string[], base: string[], remote: string[]): ({ ok: string[] } | { conflict: Conflict })[]
}
