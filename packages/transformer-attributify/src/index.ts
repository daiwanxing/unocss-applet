import MagicString from 'magic-string'
import type { SourceCodeTransformer } from 'unocss'
import { isValidSelector } from 'unocss'
import type { TransformerAttributifyOptions } from './types'

export * from './types'

const splitterRE = /[\s'"`;]+/g
const elementRE = /<\w(?=.*>)[\w:\.$-]*\s(((".*?>?.*?")|.*?)*?)\/?>/gs
const attributeRE = /([\[?a-zA-Z0-9\u00A0-\uFFFF-_:()#%.\]?]+)(?:\s*=\s*((?:'[^']*')|(?:"[^"]*")|\S+))?/g

const defaultIgnoreAttributes = ['placeholder', 'setup', 'lang', 'scoped']

export default function transformerAttributify(options: TransformerAttributifyOptions = {}): SourceCodeTransformer {
  const ignoreAttributes = options?.ignoreAttributes ?? defaultIgnoreAttributes
  const nonValuedAttribute = options?.nonValuedAttribute ?? true
  const prefix = options.prefix ?? 'un-'
  const prefixedOnly = options.prefixedOnly ?? false
  const deleteAttributes = options.deleteClass ?? true

  return {
    name: 'transformer-attributify',
    enforce: 'pre',
    async transform(s, id, { uno }) {
      if (!/\.vue$/.test(id))
        return

      const code = new MagicString(s.toString())

      const elementMatches = code.original.matchAll(elementRE)
      for (const eleMatch of elementMatches) {
        const start = eleMatch.index!
        let matchStrTemp = eleMatch[0]
        let existsClass = ''
        const attrSelectors: string[] = []
        const attributes = Array.from((eleMatch[1] || '').matchAll(attributeRE))

        for (const attribute of attributes) {
          const matchStr = attribute[0]
          const name = attribute[1]
          if (name.startsWith(':'))
            continue

          const content = attribute[2]

          const nonPrefixed = name.replace(prefix, '')
          if (!ignoreAttributes.includes(nonPrefixed)) {
            if (!content) {
              // non-valued attributes
              if (prefixedOnly && prefix && !name.startsWith(prefix))
                continue
              if (isValidSelector(nonPrefixed) && nonValuedAttribute) {
                if (await uno.parseToken(nonPrefixed)) {
                  attrSelectors.push(nonPrefixed)
                  deleteAttributes && (matchStrTemp = matchStrTemp.replace(` ${name}`, ''))
                }
              }
            }
            else {
              // valued attributes
              if (name.includes('hover-class'))
                continue
              if (['class', 'className'].includes(name)) {
                if (!name.includes(':'))
                  existsClass = content.replace(/['"`]/g, '')
              }
              else {
                if (prefixedOnly && prefix && !name.startsWith(prefix))
                  continue

                const attrs = await Promise.all(content.split(splitterRE).filter(Boolean)
                  .map(async (v) => {
                    let token = v
                    // b="~ green dark:(red 2)"
                    if (v === '~') {
                      token = nonPrefixed
                    }
                    else if (v.includes(':')) {
                      const splitV = v.split(':')
                      token = `${splitV[0]}:${splitV[1]}`
                    }
                    else if (v.startsWith('!')) {
                      token = `!${nonPrefixed}-${v.slice(1)}`
                    }
                    else { token = `${nonPrefixed}-${v}` }

                    return [token, !!await uno.parseToken(token)] as const
                  }))
                const result = attrs.filter(([, v]) => v).map(([v]) => v)
                attrSelectors.push(...result)
                result.length && deleteAttributes && (matchStrTemp = matchStrTemp.replace(` ${matchStr}`, ''))
              }
            }
          }
        }
        if (attrSelectors.length) {
          if (!existsClass) {
            const sliceNum = matchStrTemp.endsWith('/>') ? -2 : -1
            matchStrTemp = `${matchStrTemp.slice(0, sliceNum)} class="${attrSelectors.join(' ')}"${matchStrTemp.slice(sliceNum)}`
          }
          else {
            matchStrTemp = matchStrTemp.replace(`"${existsClass}"`, `"${existsClass} ${attrSelectors.join(' ')}"`)
          }
          code.overwrite(start, start + eleMatch[0].length, matchStrTemp)
        }
      }

      s.overwrite(0, s.original.length, code.toString())
    },
  }
}
