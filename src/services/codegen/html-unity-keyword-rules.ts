export type UnityNodeType =
  | 'div'
  | 'image'
  | 'text'
  | 'button'
  | 'input'
  | 'scroll'
  | 'toggle'
  | 'slider'
  | 'dropdown'

export interface ValuePatternRule<T extends string> {
  value: T
  patterns: readonly RegExp[]
}

export const ROLE_TYPE_RULES: readonly ValuePatternRule<UnityNodeType>[] = [
  { value: 'button', patterns: [/^button$/i, /^icon-button$/i] },
  { value: 'input', patterns: [/^input$/i, /^form-input$/i, /^search-bar$/i] },
  { value: 'dropdown', patterns: [/^dropdown$/i] },
  { value: 'toggle', patterns: [/^toggle$/i] },
  { value: 'slider', patterns: [/^slider$/i] },
  { value: 'scroll', patterns: [/^scroll$/i] },
  { value: 'image', patterns: [/^avatar$/i, /^icon$/i] },
] as const

export const HINT_TYPE_RULES: readonly ValuePatternRule<UnityNodeType>[] = [
  { value: 'dropdown', patterns: [/dropdown/i, /select/i, /picker/i] },
  { value: 'toggle', patterns: [/toggle/i, /switch/i, /checkbox/i, /\bcheck\b/i] },
  { value: 'slider', patterns: [/slider/i, /range/i, /progress/i] },
  { value: 'scroll', patterns: [/scroll/i, /scroller/i, /carousel/i, /\blist\b/i] },
  { value: 'input', patterns: [/input/i, /field/i, /search/i, /password/i, /email/i, /username/i] },
  { value: 'button', patterns: [/button/i, /\bbtn\b/i, /\bcta\b/i] },
] as const

export const INPUT_TYPE_RULES: readonly ValuePatternRule<string>[] = [
  { value: 'password', patterns: [/password/i, /\bpwd\b/i] },
  { value: 'email', patterns: [/email/i, /mail/i] },
  { value: 'search', patterns: [/search/i] },
  { value: 'tel', patterns: [/phone/i, /mobile/i, /\btel\b/i] },
] as const

export const INPUT_PLACEHOLDER_RULES: readonly ValuePatternRule<string>[] = [
  { value: 'Password', patterns: [/password/i, /\bpwd\b/i] },
  { value: 'Email', patterns: [/email/i, /mail/i] },
  { value: 'Search', patterns: [/search/i] },
  { value: 'Phone', patterns: [/phone/i, /mobile/i, /\btel\b/i] },
  { value: 'Username', patterns: [/username/i, /account/i, /\buser\b/i, /login/i] },
] as const

export const TOGGLE_TRUE_HINT_PATTERNS: readonly RegExp[] = [
  /checked/i,
  /selected/i,
  /enabled/i,
  /active/i,
  /\bon\b/i,
  /open/i,
] as const

export const TOGGLE_FALSE_HINT_PATTERNS: readonly RegExp[] = [
  /unchecked/i,
  /disabled/i,
  /inactive/i,
  /\boff\b/i,
  /closed/i,
] as const

export const SCROLL_DIRECTION_RULES: readonly ValuePatternRule<'h' | 'v'>[] = [
  { value: 'h', patterns: [/horizontal/i, /carousel/i, /swiper/i, /tabbar/i] },
  { value: 'v', patterns: [/vertical/i, /feed/i, /timeline/i] },
] as const

export const DROPDOWN_OPTION_TEXT_CLEANUPS: readonly RegExp[] = [
  /\((?:default|selected)\)/gi,
  /(?:default|selected)\s*[:：-]?\s*/gi,
] as const
