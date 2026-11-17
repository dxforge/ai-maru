import { ref } from 'vue'

// `prefers-color-scheme` 은 `nativeTheme.themeSource` 가 `system` 일 때만 OS 모드를 따른다(`shared/theme.ts` 의 `WindowTheme`).
const darkScheme = matchMedia('(prefers-color-scheme: dark)')

export const prefersDark = ref(darkScheme.matches)
darkScheme.addEventListener('change', (e) => (prefersDark.value = e.matches))
