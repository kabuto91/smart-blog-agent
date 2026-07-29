export interface TextField {
  type: "text"
  label: string
  value: string
  source?: "theme" | "global" | "readonly"
  globalKey?: string
}

export type DynamicFieldType = "dynamic-articles" | "dynamic-categories" | "dynamic-tags"

export interface DynamicField {
  type: DynamicFieldType
  label: string
  itemTemplate: string
  fieldMapping: Record<string, string>
}

export interface NavItem {
  label: string
  href: string
}

export interface NavField {
  type: "nav-list"
  label: string
  items: NavItem[]
  itemTemplate: string
}

export type ContentField = TextField | DynamicField | NavField

export interface ContentConfig {
  [key: string]: ContentField
}
