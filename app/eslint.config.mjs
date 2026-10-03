import js from '@eslint/js'
import prettierConfig from 'eslint-config-prettier'
import pluginVue from 'eslint-plugin-vue'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['out/', 'node_modules/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: { parserOptions: { parser: tseslint.parser } },
    // typescript-eslint 가 .ts 에만 끄는 규칙 — 타입 검사가 같은 일을 한다.
    rules: { 'no-undef': 'off' }
  },
  prettierConfig
)
