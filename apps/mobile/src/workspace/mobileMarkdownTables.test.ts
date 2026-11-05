import { describe, expect, it } from 'vitest'
import {
  mobileMarkdownTableSource,
  readMobileMarkdownTables,
  updateMobileMarkdownTable,
} from './mobileMarkdownTables'

describe('mobile markdown tables', () => {
  it('reads desktop-compatible markdown tables', () => {
    const tables = readMobileMarkdownTables({ markdown: [
      '# Planning',
      '',
      '| Surface | Target |',
      '| --- | --- |',
      '| Editor | Mobile |',
      '| Properties | Inspector |',
      '',
      'Tail',
    ].join('\n') })

    expect(tables).toEqual([{
      alignments: ['default', 'default'],
      endLine: 5,
      headers: ['Surface', 'Target'],
      indent: '',
      key: 'line:2',
      rows: [
        ['Editor', 'Mobile'],
        ['Properties', 'Inspector'],
      ],
      startLine: 2,
    }])
  })

  it('updates one table without rewriting the rest of the note', () => {
    const content = [
      'Intro',
      '',
      '| Surface | Target |',
      '| --- | --- |',
      '| Editor | Mobile |',
      '',
      'Tail',
    ].join('\n')

    const result = updateMobileMarkdownTable({
      markdown: content,
      update: {
        headers: ['Surface', 'Desktop', 'Mobile'],
        key: 'line:2',
        rows: [
          ['Editor', 'BlockNote', 'TenTap'],
          ['Inspector', 'Properties', 'Properties'],
        ],
      },
    })

    expect(result.updated).toBe(true)
    expect(result.markdown).toBe([
      'Intro',
      '',
      '| Surface | Desktop | Mobile |',
      '| --- | --- | --- |',
      '| Editor | BlockNote | TenTap |',
      '| Inspector | Properties | Properties |',
      '',
      'Tail',
    ].join('\n'))
  })

  it('preserves desktop markdown table column alignment when editing cells', () => {
    const content = tableNote({
      divider: '| :--- | :---: | ---: |',
      row: '| Editor | BlockNote | TenTap |',
    })

    const [table] = readMobileMarkdownTables({ markdown: content })
    expect(table?.alignments).toEqual(['left', 'center', 'right'])

    expectUpdatedTable({
      content,
      expectedDivider: '| :--- | :---: | ---: |',
      expectedRow: '| Editor | BlockNote | Native WYSIWYG |',
      update: {
        headers: ['Surface', 'Desktop', 'Mobile'],
        key: 'line:2',
        rows: [['Editor', 'BlockNote', 'Native WYSIWYG']],
      },
    })
  })

  it('updates desktop markdown table column alignment without changing cells', () => {
    const content = tableNote({
      divider: '| --- | :---: | ---: |',
      row: '| Editor | BlockNote | TenTap |',
    })

    expectUpdatedTable({
      content,
      expectedDivider: '| :--- | --- | :---: |',
      expectedRow: '| Editor | BlockNote | TenTap |',
      update: {
        alignments: ['left', 'default', 'center'],
        headers: ['Surface', 'Desktop', 'Mobile'],
        key: 'line:2',
        rows: [['Editor', 'BlockNote', 'TenTap']],
      },
    })
  })

  it('preserves non-code leading spaces when updating desktop markdown tables', () => {
    const content = tableNote({
      divider: '  | --- | --- | --- |',
      indent: '  ',
      row: '  | Editor | BlockNote | TenTap |',
    })

    const [table] = readMobileMarkdownTables({ markdown: content })
    expect(table).toMatchObject({
      headers: ['Surface', 'Desktop', 'Mobile'],
      indent: '  ',
      key: 'line:2',
      rows: [['Editor', 'BlockNote', 'TenTap']],
    })

    expectUpdatedTable({
      content,
      expectedDivider: '  | :--- | --- | :---: |',
      expectedRow: '  | Editor | BlockNote | Native WYSIWYG |',
      indent: '  ',
      update: {
        alignments: ['left', 'default', 'center'],
        headers: ['Surface', 'Desktop', 'Mobile'],
        key: 'line:2',
        rows: [['Editor', 'BlockNote', 'Native WYSIWYG']],
      },
    })
  })

  it('does not read code-indented table-looking text as a desktop markdown table', () => {
    const tables = readMobileMarkdownTables({ markdown: [
      '    | Surface | Target |',
      '    | --- | --- |',
      '    | Literal | Code |',
      '',
      '| Real | Table |',
      '| --- | --- |',
      '| Editor | Mobile |',
    ].join('\n') })

    expect(tables).toHaveLength(1)
    expect(tables[0]).toMatchObject({
      headers: ['Real', 'Table'],
      key: 'line:4',
      rows: [['Editor', 'Mobile']],
    })
  })

  it('serializes new columns with default alignment while preserving existing aligned columns', () => {
    expect(mobileMarkdownTableSource({
      alignments: ['left', 'center'],
      headers: ['Surface', 'Desktop', 'Mobile'],
      rows: [['Editor', 'BlockNote', 'TenTap']],
    })).toBe([
      '| Surface | Desktop | Mobile |',
      '| :--- | :---: | --- |',
      '| Editor | BlockNote | TenTap |',
    ].join('\n'))
  })

  it('round-trips escaped pipes in cells', () => {
    const table = readMobileMarkdownTables({
      markdown: [
        '| Rule | Example |',
        '| --- | --- |',
        '| Escape | A \\| B |',
      ].join('\n'),
    })[0]

    expect(table?.rows[0]).toEqual(['Escape', 'A | B'])
    expect(mobileMarkdownTableSource({
      headers: ['Rule', 'Example'],
      rows: [['Escape', 'A | B']],
    })).toBe([
      '| Rule | Example |',
      '| --- | --- |',
      '| Escape | A \\| B |',
    ].join('\n'))
  })

  it('leaves content unchanged when the target table is missing', () => {
    const content = '# No table\n'

    expect(updateMobileMarkdownTable({
      markdown: content,
      update: {
        headers: ['A'],
        key: 'line:4',
        rows: [],
      },
    })).toEqual({ markdown: content, updated: false })
  })
})

function tableNote({ divider, indent = '', row }: { divider: string; indent?: string; row: string }): string {
  return [
    'Intro',
    '',
    `${indent}| Surface | Desktop | Mobile |`,
    divider,
    row,
    '',
    'Tail',
  ].join('\n')
}

function expectUpdatedTable({
  content,
  expectedDivider,
  expectedRow,
  indent = '',
  update,
}: {
  content: string
  expectedDivider: string
  expectedRow: string
  indent?: string
  update: Parameters<typeof updateMobileMarkdownTable>[0]['update']
}) {
  const result = updateMobileMarkdownTable({ markdown: content, update })

  expect(result.updated).toBe(true)
  expect(result.markdown).toBe(tableNote({
    divider: expectedDivider,
    indent,
    row: expectedRow,
  }))
}
